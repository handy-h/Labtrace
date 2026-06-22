package services

import (
	"fmt"
	"strconv"
	"strings"

	"labtrace/internal/database"
	"labtrace/internal/models"
)

// CalcWarning represents a calculation validation warning.
type CalcWarning struct {
	RuleName string  `json:"rule_name"`
	Formula  string  `json:"formula"`
	Expected float64 `json:"expected"`
	Actual   float64 `json:"actual"`
	Deviation float64 `json:"deviation"`
	Threshold float64 `json:"threshold"`
}

// ValidateCalculations checks all calculation rules against the given report items.
// Returns warnings for rules where deviation exceeds threshold.
func ValidateCalculations(items []models.ReportItem) ([]CalcWarning, error) {
	rows, err := database.DB.Query(`SELECT id, name, formula, threshold, test_item_ids FROM calculation_rules`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var warnings []CalcWarning

	for rows.Next() {
		var rule models.CalculationRule
		if err := rows.Scan(&rule.ID, &rule.Name, &rule.Formula, &rule.Threshold, &rule.TestItemIDs); err != nil {
			return nil, err
		}

		warning, err := checkRule(rule, items)
		if err != nil {
			continue // skip rules that can't be evaluated
		}
		if warning != nil {
			warnings = append(warnings, *warning)
		}
	}

	return warnings, nil
}

// checkRule evaluates a single calculation rule against report items.
// Supported format: "LHS=RHS" where RHS is a sum of item codes (e.g., "TP=ALB+GLOB")
func checkRule(rule models.CalculationRule, items []models.ReportItem) (*CalcWarning, error) {
	// Safety: limit formula length
	if len(rule.Formula) > 500 {
		return nil, fmt.Errorf("formula too long: %d characters", len(rule.Formula))
	}

	parts := strings.SplitN(rule.Formula, "=", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid formula: %s", rule.Formula)
	}

	lhsCode := strings.TrimSpace(parts[0])
	rhsExpr := strings.TrimSpace(parts[1])

	// Safety: limit LHS and RHS lengths
	if len(lhsCode) > 100 || len(rhsExpr) > 100 {
		return nil, fmt.Errorf("formula operand too long")
	}

	// Reject dangerous patterns
	for _, ch := range lhsCode {
		if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '-') {
			return nil, fmt.Errorf("invalid character in formula LHS: %c", ch)
		}
	}
	for _, ch := range rhsExpr {
		if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '-' || ch == '+') {
			return nil, fmt.Errorf("invalid character in formula RHS: %c", ch)
		}
	}

	// Find LHS value
	lhsValue, err := findItemValue(lhsCode, items)
	if err != nil {
		return nil, err
	}

	// Evaluate RHS (simple sum of item codes)
	rhsValue, err := evalSumExpr(rhsExpr, items)
	if err != nil {
		return nil, err
	}

	deviation := lhsValue - rhsValue
	if deviation < 0 {
		deviation = -deviation
	}

	if deviation > rule.Threshold {
		return &CalcWarning{
			RuleName:  rule.Name,
			Formula:   rule.Formula,
			Expected:  rhsValue,
			Actual:    lhsValue,
			Deviation: deviation,
			Threshold: rule.Threshold,
		}, nil
	}

	return nil, nil
}

// findItemValue finds a report item value by test item code.
func findItemValue(code string, items []models.ReportItem) (float64, error) {
	for _, item := range items {
		if item.TestItemName == code {
			if item.NormalizedValue != nil {
				return *item.NormalizedValue, nil
			}
			return strconv.ParseFloat(item.OriginalValue, 64)
		}
	}

	return 0, fmt.Errorf("item %s not found", code)
}

// evalSumExpr evaluates a simple sum expression like "ALB+GLOB" or "ALB+GLOB+XXX"
func evalSumExpr(expr string, items []models.ReportItem) (float64, error) {
	terms := strings.Split(expr, "+")
	if len(terms) > 10 {
		return 0, fmt.Errorf("too many terms in sum expression: %d", len(terms))
	}
	total := 0.0
	for _, term := range terms {
		term = strings.TrimSpace(term)
		if term == "" {
			continue
		}
		val, err := findItemValue(term, items)
		if err != nil {
			return 0, err
		}
		total += val
	}
	return total, nil
}
