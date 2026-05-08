package services

import (
	"fmt"
	"sort"
	"strings"

	openapi "github.com/alibabacloud-go/darabonba-openapi/v2/client"
	ocr_api "github.com/alibabacloud-go/ocr-api-20210707/v3/client"
	"github.com/alibabacloud-go/tea/tea"

	"labtrace/internal/config"
)

// OCRResult represents a single recognized text block from OCR.
// Fields match the legacy interface for backward compatibility with handlers/ocr.go and rule_service.go.
//
// Coordinate semantics (since PDF coordinate support):
//   - Left, Top are top-left corner of the block (previously stored CenterX/CenterY).
//   - HasPosition distinguishes new-format data (has_position=true) from legacy data.
//   - Old data (pre-2026-05) stored CenterX/CenterY in Left/Top; downstream code detects
//     this via HasPosition=false and applies center→edge compensation.
type OCRResult struct {
	Text        string  `json:"text"`
	Confidence  float64 `json:"confidence"`
	Left        int     `json:"left"`        // top-left X (new format) or CenterX (legacy)
	Top         int     `json:"top"`         // top-left Y (new format) or CenterY (legacy)
	Width       int     `json:"width"`
	Height      int     `json:"height"`
	Row         int     `json:"row"`
	PageIndex   int     `json:"page_index"` // 0-based page index in multi-page PDF
	// --- New fields for PDF coordinate support ---
	HasPosition bool `json:"has_position"` // true when valid OCR block coordinates are available
	ColIndex    int  `json:"col_index"`    // table column index (-1 = non-table block)
	RowStart    int  `json:"row_start"`    // CellDetails.RowStart (-1 = non-table block)
	RowEnd      int  `json:"row_end"`      // CellDetails.RowEnd
	ColStart    int  `json:"col_start"`    // CellDetails.ColumnStart
	ColEnd      int  `json:"col_end"`      // CellDetails.ColumnEnd
}

// Recognize calls Aliyun OCR RecognizeAllText API via SDK v3.
// Supports both images and PDF files (multi-page via SubImages).
func Recognize(fileBytes []byte, cfg *config.Config) ([]OCRResult, error) {
	if cfg.AliAccessKeyID == "" || cfg.AliAccessSecret == "" {
		return nil, fmt.Errorf("Aliyun OCR credentials not configured")
	}

	// Create SDK client
	client, err := ocr_api.NewClient(&openapi.Config{
		AccessKeyId:     tea.String(cfg.AliAccessKeyID),
		AccessKeySecret: tea.String(cfg.AliAccessSecret),
		RegionId:        tea.String("cn-hangzhou"),
		Endpoint:        tea.String("ocr-api.cn-hangzhou.aliyuncs.com"),
	})
	if err != nil {
		return nil, fmt.Errorf("create OCR client: %w", err)
	}

	// Build request — RecognizeAllText with Type=Advanced (high precision general text recognition)
	// OutputCoordinate=rectangle enables PDF coordinate return (previously PDF had no BlockRect)
	// OutputOricoord=true returns coordinates in original image space (critical for PDF page mapping)
	// OutputTable=true returns structured TableInfo with CellDetails (column/row indices)
	// OutputRow=true returns RowInfo for row-level grouping validation
	request := &ocr_api.RecognizeAllTextRequest{
		Body:             strings.NewReader(string(fileBytes)),
		Type:             tea.String("Advanced"),
		OutputCoordinate: tea.String("rectangle"),
		OutputOricoord:   tea.Bool(true),
		AdvancedConfig: &ocr_api.RecognizeAllTextRequestAdvancedConfig{
			OutputTable: tea.Bool(true),
			OutputRow:   tea.Bool(true),
		},
	}

	response, err := client.RecognizeAllText(request)
	if err != nil {
		return nil, fmt.Errorf("OCR request failed: %w", err)
	}

	// Check business error
	if response.Body.Code != nil && *response.Body.Code != "" {
		msg := ""
		if response.Body.Message != nil {
			msg = *response.Body.Message
		}
		return nil, fmt.Errorf("OCR error: %s - %s", *response.Body.Code, msg)
	}

	return parseOCRResponse(response)
}

// parseOCRResponse extracts OCRResult slice from the SDK response.
func parseOCRResponse(response *ocr_api.RecognizeAllTextResponse) ([]OCRResult, error) {
	var results []OCRResult

	// Per-page text blocks from SubImages (available for PDF multi-page recognition)
	if response.Body.Data != nil && len(response.Body.Data.SubImages) > 0 {
		for pageIdx, subImage := range response.Body.Data.SubImages {
			if subImage.BlockInfo == nil || len(subImage.BlockInfo.BlockDetails) == 0 {
				continue
			}

			// Group blocks by Y coordinate to assign Row numbers
			blocks := subImage.BlockInfo.BlockDetails
			assignRowNumbers(blocks)

			for _, bd := range blocks {
				if bd.BlockContent == nil || *bd.BlockContent == "" {
					continue
				}
				r := OCRResult{
					Text:      strings.TrimSpace(*bd.BlockContent),
					PageIndex: pageIdx,
				}

				if bd.BlockConfidence != nil {
					r.Confidence = float64(*bd.BlockConfidence)
				} else {
					r.Confidence = 80 // default
				}

				if bd.BlockRect != nil && bd.BlockRect.Width != nil && *bd.BlockRect.Width > 0 {
					// Valid coordinate block: convert from center-based to top-left semantics.
					// This fixes PDF coordinate support — previously PDF returned empty BlockRect.
					w := int(*bd.BlockRect.Width)
					h := int(*bd.BlockRect.Height)
					r.Width = w
					r.Height = h
					r.HasPosition = true

					cx := int32(0)
					cy := int32(0)
					if bd.BlockRect.CenterX != nil {
						cx = *bd.BlockRect.CenterX
					}
					if bd.BlockRect.CenterY != nil {
						cy = *bd.BlockRect.CenterY
					}
					// Convert center to top-left: Left = CenterX - Width/2, Top = CenterY - Height/2
					r.Left = int(cx) - w/2
					r.Top = int(cy) - h/2
				} else if bd.BlockRect != nil {
					// Legacy fallback: BlockRect present but zero-sized (old data without OutputCoordinate)
					// Keep old center-based semantics for backward compat (HasPosition=false)
					if bd.BlockRect.CenterX != nil {
						r.Left = int(*bd.BlockRect.CenterX)
					}
					if bd.BlockRect.CenterY != nil {
						r.Top = int(*bd.BlockRect.CenterY)
					}
					if bd.BlockRect.Width != nil {
						r.Width = int(*bd.BlockRect.Width)
					}
					if bd.BlockRect.Height != nil {
						r.Height = int(*bd.BlockRect.Height)
					}
				}

				if bd.BlockId != nil {
					// BlockId is used as row index after grouping; store temporary
					r.Row = int(*bd.BlockId)
				}

				results = append(results, r)
			}
		}

		// Assign global row numbers across pages (for rule_service grouping)
		reassignRowsFromY(results)

		return results, nil
	}

	// Fallback: parse Data.Content as plain text lines (no structured blocks available)
	if response.Body.Data != nil && response.Body.Data.Content != nil && *response.Body.Data.Content != "" {
		lines := strings.Fields(*response.Body.Data.Content)
		for i, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			results = append(results, OCRResult{
				Text:       line,
				Confidence: 80,
				Row:        i,
			})
		}
		return results, nil
	}

	// No content at all
	return nil, nil
}

// assignRowNumbers groups blocks from a single page by their Y coordinate and assigns Row numbers.
// Blocks with CenterY within yTolerance pixels are considered on the same row.
func assignRowNumbers(blocks []*ocr_api.RecognizeAllTextResponseBodyDataSubImagesBlockInfoBlockDetails) {
	const yTolerance = 10

	type blockWithY struct {
		block  *ocr_api.RecognizeAllTextResponseBodyDataSubImagesBlockInfoBlockDetails
		centerY int
	}

	blockList := make([]blockWithY, 0, len(blocks))
	for _, b := range blocks {
		cy := 0
		if b.BlockRect != nil && b.BlockRect.CenterY != nil {
			cy = int(*b.BlockRect.CenterY)
		}
		blockList = append(blockList, blockWithY{block: b, centerY: cy})
	}

	// Sort by CenterY, then CenterX
	sort.Slice(blockList, func(i, j int) bool {
		if blockList[i].centerY != blockList[j].centerY {
			return blockList[i].centerY < blockList[j].centerY
		}
		ix := 0
		if blockList[i].block.BlockRect != nil && blockList[i].block.BlockRect.CenterX != nil {
			ix = int(*blockList[i].block.BlockRect.CenterX)
		}
		jx := 0
		if blockList[j].block.BlockRect != nil && blockList[j].block.BlockRect.CenterX != nil {
			jx = int(*blockList[j].block.BlockRect.CenterX)
		}
		return ix < jx
	})

	// Assign row numbers based on Y gaps
	rowNum := 0
	lastY := blockList[0].centerY
	for i := range blockList {
		if i > 0 && blockList[i].centerY-lastY > yTolerance {
			rowNum++
		}
		lastY = blockList[i].centerY
		// Temporarily store row in BlockId
		row := int32(rowNum)
		blockList[i].block.BlockId = &row
	}
}

// reassignRowsFromY updates Row fields in results based on Y-position grouping across all pages.
// This ensures consecutive row numbers for rule_service groupByRow.
func reassignRowsFromY(results []OCRResult) {
	if len(results) == 0 {
		return
	}

	// Sort by PageIndex, then by Top
	sort.Slice(results, func(i, j int) bool {
		if results[i].PageIndex != results[j].PageIndex {
			return results[i].PageIndex < results[j].PageIndex
		}
		return results[i].Top < results[j].Top
	})

	const yTolerance = 10
	rowNum := 0
	lastY := results[0].Top
	for i := range results {
		if i > 0 {
			// New page always starts a new row
			if results[i].PageIndex != results[i-1].PageIndex {
				rowNum++
			} else if results[i].Top-lastY > yTolerance {
				rowNum++
			}
		}
		lastY = results[i].Top
		results[i].Row = rowNum
	}
}
