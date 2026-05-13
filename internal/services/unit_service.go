package services

import (
	"fmt"
	"regexp"
	"strconv"
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
