package services

import (
	"encoding/json"
	"fmt"

	"labtrace/internal/database"
	"labtrace/internal/models"
)

// ColumnMapping defines the column position mapping for a hospital rule.
type ColumnMapping struct {
	ItemNameCol int `json:"item_name_col"`
	ResultCol   int `json:"result_col"`
	UnitCol     int `json:"unit_col"`
	RefCol      int `json:"reference_col"`
	NotesCol    int `json:"notes_col"`
	RowStart    int `json:"row_start"`
	RowEnd      int `json:"row_end"`
}

// ApplyRule applies a hospital rule to OCR results, producing report items.
func ApplyRule(hospitalID int64, ocrResults []OCRResult) ([]models.ReportItem, error) {
	// Find the rule for this hospital
	var rule models.HospitalRule
	err := database.DB.QueryRow(
		`SELECT id, hospital_id, rule_name, column_mappings, created_at, updated_at
		FROM hospital_rules WHERE hospital_id = ? ORDER BY updated_at DESC LIMIT 1`, hospitalID,
	).Scan(&rule.ID, &rule.HospitalID, &rule.RuleName, &rule.ColumnMappings, &rule.CreatedAt, &rule.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("no rule found for hospital %d", hospitalID)
	}

	var mapping ColumnMapping
	if err := json.Unmarshal([]byte(rule.ColumnMappings), &mapping); err != nil {
		return nil, fmt.Errorf("invalid column mapping: %w", err)
	}

	// Group OCR results by row
	rowMap := groupByRow(ocrResults)

	var items []models.ReportItem
	for row := mapping.RowStart; row <= mapping.RowEnd; row++ {
		cols, ok := rowMap[row]
		if !ok {
			continue
		}

		item := models.ReportItem{
			Confidence: 100,
		}

		if mapping.ItemNameCol < len(cols) {
			item.TestItemName = cols[mapping.ItemNameCol].Text
			item.Confidence = minInt(item.Confidence, int(cols[mapping.ItemNameCol].Confidence))
		}
		if mapping.ResultCol < len(cols) {
			item.OriginalValue = cols[mapping.ResultCol].Text
			item.Confidence = minInt(item.Confidence, int(cols[mapping.ResultCol].Confidence))
		}
		if mapping.UnitCol < len(cols) {
			item.OriginalUnit = cols[mapping.UnitCol].Text
		}
		if mapping.NotesCol < len(cols) {
			item.RowNotes = cols[mapping.NotesCol].Text
		}

		if item.OriginalValue != "" {
			items = append(items, item)
		}
	}

	return items, nil
}

// groupByRow groups OCR results by their row number.
func groupByRow(results []OCRResult) map[int][]OCRResult {
	m := make(map[int][]OCRResult)
	for _, r := range results {
		m[r.Row] = append(m[r.Row], r)
	}
	return m
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
