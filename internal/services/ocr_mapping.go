package services

import (
	"encoding/json"
	"sort"
)

// ColumnMappingConfig is the user-defined column mapping for a lab report.
// Saved as JSON in lab_reports.column_mapping_json.
type ColumnMappingConfig struct {
	TableRegion TableRegion `json:"table_region"`
	HeaderRowY  int         `json:"header_row_y"` // center-Y of header row in OCR coords
	Columns     []ColumnDef `json:"columns"`
	SampleDate  string      `json:"sample_date,omitempty"`
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
	MappedField string `json:"mapped_field"` // "name"|"value"|"unit"|"range"|"notes"|"ignore"
	XMin        int    `json:"x_min"`        // left boundary in OCR coords
	XMax        int    `json:"x_max"`        // right boundary in OCR coords
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
	const margin = 20
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
	const headerTolerance = 15
	var dataBlocks []OCRResult
	for _, b := range filtered {
		if absInt(b.Top-cfg.HeaderRowY) > headerTolerance {
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
	var items []ParsedLabItem
	for _, rowIdx := range rowOrder {
		rowBlocks := rowMap[rowIdx]
		if len(rowBlocks) == 0 {
			continue
		}
		sortByX(rowBlocks)

		colTexts := make(map[string]string)
		var bboxStr string
		var topConf float64

		for _, b := range rowBlocks {
			col := findColumnByX(b.Left, activeCols)
			if col == nil {
				continue
			}
			if existing, ok := colTexts[col.MappedField]; ok {
				colTexts[col.MappedField] = existing + " " + b.Text
			} else {
				colTexts[col.MappedField] = b.Text
			}
			if bboxStr == "" {
				bboxStr = bboxJSON(b.Left, b.Top, b.Width, b.Height, b.PageIndex)
			}
			if b.Confidence > topConf {
				topConf = b.Confidence
			}
		}

		name := colTexts["name"]
		value := colTexts["value"]
		// Require at least a name; value may be empty (OCR may miss value blocks
		// for some items — user can fill in the value during Step 3 cell editing).
		if name == "" {
			continue
		}

		items = append(items, ParsedLabItem{
			Name:       name,
			Value:      NormalizeQualitative(value),
			Unit:       colTexts["unit"],
			Range:      colTexts["range"],
			Confidence: int(topConf),
			BBox:       bboxStr,
			RowText:    colTexts["notes"], // notes stored temporarily in RowText
		})
	}

	return items
}

// filterByRegion returns blocks whose center lies within the region rectangle.
//
// Handles both coordinate formats:
//   - New format (HasPosition=true): Left/Top = top-left, center = Left + Width/2, Top + Height/2
//   - Legacy format (HasPosition=false): Left/Top = center, used directly
func filterByRegion(blocks []OCRResult, r TableRegion) []OCRResult {
	newFormat := len(blocks) > 0 && blocks[0].HasPosition
	var out []OCRResult
	for _, b := range blocks {
		if r.Page >= 0 && b.PageIndex != r.Page {
			continue
		}
		cx, cy := b.Left, b.Top
		if newFormat {
			cx = b.Left + b.Width/2
			cy = b.Top + b.Height/2
		}
		if cx >= r.X && cx <= r.X+r.W && cy >= r.Y && cy <= r.Y+r.H {
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
