package services

import (
	"encoding/json"
	"sort"
)

// ColumnMappingConfig is the user-defined column mapping for a lab report.
// Saved as JSON in lab_reports.column_mapping_json.
type ColumnMappingConfig struct {
	TableRegion  TableRegion `json:"table_region"`
	HeaderRowY   int         `json:"header_row_y"`    // center-Y of first header row in OCR coords
	HeaderRowYs  []int       `json:"header_row_ys"`   // Y coords of all header rows (multi-group support)
	Columns      []ColumnDef `json:"columns"`
	SampleDate   string      `json:"sample_date,omitempty"`
}

// TableRegion is a rectangular selection in OCR coordinate space.
// X, Y are top-left corner; W, H are width and height.
// Page is 0-based page index; -1 means all pages.
type TableRegion struct {
	X    int `json:"x"`
	Y    int `json:"y"`
	W    int `json:"w"`
	H    int `json:"h"`
	Page int `json:"page"`
}

// ColumnDef maps one detected table column to a semantic field role.
type ColumnDef struct {
	ColIndex    int    `json:"col_index"`
	HeaderText  string `json:"header_text"`
	MappedField string `json:"mapped_field"` // "name"|"value"|"unit"|"range"|"category"|"notes"|"ignore"
	XMin        int    `json:"x_min"`        // left boundary in OCR coords
	XMax        int    `json:"x_max"`        // right boundary in OCR coords
	Group       int    `json:"group"`        // group index (0-based), for multi-group (multi-column) layouts
}

// AutoDetectTableRegion infers the likely table bounding box from OCR block positions.
// Returns the convex hull of all blocks with a small margin.
//
// Handles both coordinate formats:
//   - New format (HasPosition=true): Left/Top = top-left corner, use directly
//   - Legacy format (HasPosition=false): Left/Top = center, apply center→edge compensation
func AutoDetectTableRegion(blocks []OCRResult) TableRegion {
	if len(blocks) == 0 {
		return TableRegion{Page: -1}
	}

	// Detect coordinate format from first block
	newFormat := blocks[0].HasPosition

	// Helper: compute block edges based on coordinate format
	getX1 := func(b OCRResult) int {
		if newFormat {
			return b.Left
		}
		return b.Left - b.Width/2
	}
	getY1 := func(b OCRResult) int {
		if newFormat {
			return b.Top
		}
		return b.Top - b.Height/2
	}
	getX2 := func(b OCRResult) int {
		if newFormat {
			return b.Left + b.Width
		}
		return b.Left + b.Width/2
	}
	getY2 := func(b OCRResult) int {
		if newFormat {
			return b.Top + b.Height
		}
		return b.Top + b.Height/2
	}

	minX := getX1(blocks[0])
	minY := getY1(blocks[0])
	maxX := getX2(blocks[0])
	maxY := getY2(blocks[0])
	for _, b := range blocks[1:] {
		lx := getX1(b)
		ly := getY1(b)
		rx := getX2(b)
		ry := getY2(b)
		if lx < minX {
			minX = lx
		}
		if ly < minY {
			minY = ly
		}
		if rx > maxX {
			maxX = rx
		}
		if ry > maxY {
			maxY = ry
		}
	}
	const margin = 40
	x := minX - margin
	if x < 0 {
		x = 0
	}
	y := minY - margin
	if y < 0 {
		y = 0
	}
	return TableRegion{
		X:    x,
		Y:    y,
		W:    maxX - minX + 2*margin,
		H:    maxY - minY + 2*margin,
		Page: -1,
	}
}

// ParseLabResultsWithMapping is Path 4 of the OCR parsing pipeline.
// It uses a user-defined column mapping configuration instead of auto-classification.
// Supports multi-group (multi-column) layouts: each group has its own set of
// header columns (e.g., left and right columns of a hospital lab report).
func ParseLabResultsWithMapping(blocks []OCRResult, cfg ColumnMappingConfig) []ParsedLabItem {
	if len(blocks) == 0 || len(cfg.Columns) == 0 {
		return nil
	}

	// Build active column list (exclude "ignore")
	var activeCols []ColumnDef
	for _, col := range cfg.Columns {
		if col.MappedField != "ignore" {
			activeCols = append(activeCols, col)
		}
	}
	if len(activeCols) == 0 {
		return nil
	}

	// Step 1: Filter blocks to the selected table region
	filtered := blocks
	r := cfg.TableRegion
	if r.W > 0 && r.H > 0 {
		filtered = filterByRegion(blocks, r)
	}

	// Step 2: Remove header row blocks
	// Support multiple header rows (multi-group): use HeaderRowYs if available,
	// otherwise fall back to single HeaderRowY
	headerYs := cfg.HeaderRowYs
	if len(headerYs) == 0 && cfg.HeaderRowY != 0 {
		headerYs = []int{cfg.HeaderRowY}
	}
	const headerTolerance = 15
	var dataBlocks []OCRResult
	for _, b := range filtered {
		isHeader := false
		for _, hy := range headerYs {
			if absInt(b.Top-hy) <= headerTolerance {
				isHeader = true
				break
			}
		}
		if !isHeader {
			dataBlocks = append(dataBlocks, b)
		}
	}

	// Step 3: Group data blocks by row
	rowMap := make(map[int][]OCRResult)
	var rowOrder []int
	for _, b := range dataBlocks {
		if _, exists := rowMap[b.Row]; !exists {
			rowOrder = append(rowOrder, b.Row)
		}
		rowMap[b.Row] = append(rowMap[b.Row], b)
	}
	sort.Ints(rowOrder)

	// Step 4: For each row, assign blocks to columns and assemble items
	// In multi-group mode, we first collect items per group per row,
	// then output all items for group 0 (left column), then group 1, etc.
	// This ensures the left column's items appear first, followed by the right column's.

	// Collect items grouped by group index, preserving row order within each group
	type groupItem struct {
		group int
		item  ParsedLabItem
	}
	var groupedItems []groupItem

	// Track all group indices we encounter
	groupSet := make(map[int]bool)

	for _, rowIdx := range rowOrder {
		rowBlocks := rowMap[rowIdx]
		if len(rowBlocks) == 0 {
			continue
		}
		sortByX(rowBlocks)

		// Group blocks by their column group assignment
		type groupTexts struct {
			colTexts map[string]string
			bboxStr  string
			topConf  float64
		}
		groupMap := make(map[int]*groupTexts)

		for _, b := range rowBlocks {
			blockCenterX := b.Left + b.Width/2
			col := findColumnByX(blockCenterX, activeCols)
			if col == nil {
				continue
			}
			g := col.Group
			groupSet[g] = true
			gt, ok := groupMap[g]
			if !ok {
				gt = &groupTexts{colTexts: make(map[string]string)}
				groupMap[g] = gt
			}
			if existing, ok := gt.colTexts[col.MappedField]; ok {
				gt.colTexts[col.MappedField] = existing + " " + b.Text
			} else {
				gt.colTexts[col.MappedField] = b.Text
			}
			if gt.bboxStr == "" {
				gt.bboxStr = bboxJSON(b.Left, b.Top, b.Width, b.Height, b.PageIndex)
			}
			if b.Confidence > gt.topConf {
				gt.topConf = b.Confidence
			}
		}

		// For each group in this row, produce a ParsedLabItem
		var rowGroupKeys []int
		for g := range groupMap {
			rowGroupKeys = append(rowGroupKeys, g)
		}
		sort.Ints(rowGroupKeys)
		for _, g := range rowGroupKeys {
			gt := groupMap[g]
			name := gt.colTexts["name"]
			value := gt.colTexts["value"]
			if name == "" {
				continue
			}
			groupedItems = append(groupedItems, groupItem{
				group: g,
				item: ParsedLabItem{
					Name:       name,
					Value:      NormalizeQualitative(value),
					Unit:       gt.colTexts["unit"],
					Range:      gt.colTexts["range"],
					Category:   gt.colTexts["category"],
					Confidence: int(gt.topConf),
					BBox:       gt.bboxStr,
					RowText:    gt.colTexts["notes"],
				},
			})
		}
	}

	// Output items by group order: all of group 0 first, then group 1, etc.
	// This ensures left column items come before right column items.
	var sortedGroupKeys []int
	for g := range groupSet {
		sortedGroupKeys = append(sortedGroupKeys, g)
	}
	sort.Ints(sortedGroupKeys)

	var items []ParsedLabItem
	for _, g := range sortedGroupKeys {
		for _, gi := range groupedItems {
			if gi.group == g {
				items = append(items, gi.item)
			}
		}
	}

	return items
}

// filterByRegion returns blocks that overlap with the region rectangle.
//
// Uses bounding-box overlap test instead of center-point hit test, so blocks
// whose center is slightly outside the region but whose body overlaps are still
// included. This prevents edge-row items (e.g. result columns of the last few
// rows) from being filtered out.
//
// Handles both coordinate formats:
//   - New format (HasPosition=true): Left/Top = top-left corner
//   - Legacy format (HasPosition=false): Left/Top = center, apply center→edge compensation
func filterByRegion(blocks []OCRResult, r TableRegion) []OCRResult {
	newFormat := len(blocks) > 0 && blocks[0].HasPosition
	var out []OCRResult
	rx2 := r.X + r.W
	ry2 := r.Y + r.H
	for _, b := range blocks {
		if r.Page >= 0 && b.PageIndex != r.Page {
			continue
		}
		// Compute block bounding box edges
		var bx1, by1, bx2, by2 int
		if newFormat {
			bx1 = b.Left
			by1 = b.Top
			bx2 = b.Left + b.Width
			by2 = b.Top + b.Height
		} else {
			bx1 = b.Left - b.Width/2
			by1 = b.Top - b.Height/2
			bx2 = b.Left + b.Width/2
			by2 = b.Top + b.Height/2
		}
		// Bounding-box overlap test: two rectangles overlap iff
		// their projections overlap on both axes.
		if bx1 < rx2 && bx2 > r.X && by1 < ry2 && by2 > r.Y {
			out = append(out, b)
		}
	}
	return out
}

// findColumnByX returns the ColumnDef whose X range contains the given X coordinate.
// Falls back to the nearest column by center distance if no exact match.
func findColumnByX(x int, cols []ColumnDef) *ColumnDef {
	for i := range cols {
		if x >= cols[i].XMin && x <= cols[i].XMax {
			return &cols[i]
		}
	}
	best := -1
	bestDist := int(^uint(0) >> 1)
	for i, col := range cols {
		mid := (col.XMin + col.XMax) / 2
		d := absInt(x - mid)
		if d < bestDist {
			bestDist = d
			best = i
		}
	}
	if best >= 0 {
		return &cols[best]
	}
	return nil
}

func absInt(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

// MarshalColumnMappingConfig serializes a ColumnMappingConfig to a JSON string.
func MarshalColumnMappingConfig(cfg ColumnMappingConfig) (string, error) {
	b, err := json.Marshal(cfg)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// UnmarshalColumnMappingConfig deserializes a JSON string to ColumnMappingConfig.
func UnmarshalColumnMappingConfig(s string) (ColumnMappingConfig, error) {
	var cfg ColumnMappingConfig
	if s == "" {
		return cfg, nil
	}
	err := json.Unmarshal([]byte(s), &cfg)
	return cfg, err
}
