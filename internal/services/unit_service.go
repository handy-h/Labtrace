package services

import (
	"fmt"
	"math"
	"regexp"
	"strconv"

	"labtrace/internal/database"
	"labtrace/internal/models"
)

// EvalSimpleExpr evaluates a simple formula like "x*18.0", "x/18.0", "x+5", "x-3"
func EvalSimpleExpr(formula string, x float64) (float64, error) {
	// Pattern: x <op> <number> or <number> <op> x
	re1 := regexp.MustCompile(`^x\s*([*/+\-])\s*([0-9.]+)$`)
	if m := re1.FindStringSubmatch(formula); m != nil {
		op := m[1]
		num, err := strconv.ParseFloat(m[2], 64)
		if err != nil {
			return 0, fmt.Errorf("invalid number: %s", m[2])
		}
		switch op {
		case "*":
			return x * num, nil
		case "/":
			if num == 0 {
				return 0, fmt.Errorf("division by zero")
			}
			return x / num, nil
		case "+":
			return x + num, nil
		case "-":
			return x - num, nil
		}
	}

	re2 := regexp.MustCompile(`^([0-9.]+)\s*([*/])\s*x$`)
	if m := re2.FindStringSubmatch(formula); m != nil {
		op := m[2]
		num, err := strconv.ParseFloat(m[1], 64)
		if err != nil {
			return 0, fmt.Errorf("invalid number: %s", m[1])
		}
		switch op {
		case "*":
			return num * x, nil
		case "/":
			if x == 0 {
				return 0, fmt.Errorf("division by zero")
			}
			return num / x, nil
		}
	}

	return 0, fmt.Errorf("unsupported formula format: %s (supported: x*coeff, x/coeff, coeff*x)", formula)
}

// ConvertValue converts a value from source unit to target unit for a given test item
func ConvertValue(testItemID int64, sourceUnit, targetUnit string, value float64) (float64, error) {
	var uc models.UnitConversion
	err := database.DB.QueryRow(
		`SELECT id, test_item_id, source_unit, target_unit, formula, example_input, example_output, created_at
		FROM unit_conversions WHERE test_item_id = ? AND source_unit = ? AND target_unit = ?`,
		testItemID, sourceUnit, targetUnit,
	).Scan(&uc.ID, &uc.TestItemID, &uc.SourceUnit, &uc.TargetUnit, &uc.Formula, &uc.ExampleInput, &uc.ExampleOutput, &uc.CreatedAt)
	if err != nil {
		return 0, fmt.Errorf("no conversion rule found for item %d: %s → %s", testItemID, sourceUnit, targetUnit)
	}

	result, err := EvalSimpleExpr(uc.Formula, value)
	if err != nil {
		return 0, fmt.Errorf("formula eval error: %w", err)
	}

	// Magnitude safety check
	if value != 0 && math.Abs(result/value) > 100 {
		return result, fmt.Errorf("WARNING: magnitude deviation >100x")
	}

	return result, nil
}
