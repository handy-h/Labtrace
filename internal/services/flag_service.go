package services

import (
	"labtrace/internal/models"
	"strconv"
)

// CalculateFlag determines the flag (H/L/normal) for a numeric value against a reference interval.
func CalculateFlag(valueStr string, ri *models.ReferenceInterval) string {
	if ri == nil || ri.ValueType != "numeric" {
		return ""
	}

	value, err := strconv.ParseFloat(valueStr, 64)
	if err != nil {
		// Non-numeric value, check qualitative
		return checkQualitative(valueStr, ri)
	}

	if ri.ValueMin != nil && value < *ri.ValueMin {
		return "L"
	}
	if ri.ValueMax != nil && value > *ri.ValueMax {
		return "H"
	}
	return "normal"
}

func checkQualitative(value string, ri *models.ReferenceInterval) string {
	if ri.QualitativeValue == "" {
		return ""
	}
	// Simple qualitative matching
	normalValues := map[string]bool{
		"阴性(-)": true, "阴性": true, "(-)": true, "Neg": true, "neg": true, "Negative": true,
	}
	abnormalValues := map[string]bool{
		"阳性(+)": true, "阳性": true, "(+)": true, "Pos": true, "pos": true, "Positive": true,
		"1+": true, "2+": true, "3+": true, "4+": true,
	}

	if normalValues[ri.QualitativeValue] {
		if abnormalValues[value] {
			return "阳性"
		}
		return "阴性"
	}
	if abnormalValues[ri.QualitativeValue] {
		if normalValues[value] {
			return "阴性"
		}
	}
	return ""
}
