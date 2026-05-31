package services

import (
	"fmt"
	"regexp"
	"strconv"
)

var (
	reUnitExpr1 = regexp.MustCompile(`^x\s*([*/+\-])\s*([0-9.]+)$`)
	reUnitExpr2 = regexp.MustCompile(`^([0-9.]+)\s*([*/])\s*x$`)
)

// EvalSimpleExpr evaluates a simple formula like "x*18.0", "x/18.0", "x+5", "x-3"
func EvalSimpleExpr(formula string, x float64) (float64, error) {
	if m := reUnitExpr1.FindStringSubmatch(formula); m != nil {
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

	if m := reUnitExpr2.FindStringSubmatch(formula); m != nil {
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
