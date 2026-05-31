package services

import (
	"fmt"
	"strings"

	"labtrace/internal/database"
	"labtrace/internal/models"
)

// MatchReference finds the best matching reference interval for a test item
// given the subject's gender and age at sample time.
func MatchReference(testItemID int64, gender string, ageAtSample float64) (*models.ReferenceInterval, error) {
	rows, err := database.DB.Query(
		`SELECT id, test_item_id, gender, age_min, age_max, age_unit, value_min, value_max, value_type, qualitative_value, created_at
		FROM reference_intervals WHERE test_item_id = ?`, testItemID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var best *models.ReferenceInterval
	bestScore := -1

	for rows.Next() {
		var ri models.ReferenceInterval
		var ageMin, ageMax, valMin, valMax interface{}
		if err := rows.Scan(&ri.ID, &ri.TestItemID, &ri.Gender, &ageMin, &ageMax, &ri.AgeUnit, &valMin, &valMax, &ri.ValueType, &ri.QualitativeValue, &ri.CreatedAt); err != nil {
			return nil, err
		}
		ri.AgeMin = float64Ptr(ageMin)
		ri.AgeMax = float64Ptr(ageMax)
		ri.ValueMin = float64Ptr(valMin)
		ri.ValueMax = float64Ptr(valMax)

		score, ok := scoreRefInterval(&ri, gender, ageAtSample)
		if ok && score > bestScore {
			bestScore = score
			best = &ri
		}
	}

	return best, nil
}

// LoadReferenceIntervals 批量加载多个 test_item 的参考区间，返回按 test_item_id 分组的 map。
func LoadReferenceIntervals(testItemIDs []int64) (map[int64][]models.ReferenceInterval, error) {
	result := make(map[int64][]models.ReferenceInterval, len(testItemIDs))
	if len(testItemIDs) == 0 {
		return result, nil
	}

	placeholders := strings.Repeat("?,", len(testItemIDs))
	placeholders = placeholders[:len(placeholders)-1]
	args := make([]interface{}, len(testItemIDs))
	for i, id := range testItemIDs {
		args[i] = id
	}

	rows, err := database.DB.Query(
		fmt.Sprintf(
			`SELECT id, test_item_id, gender, age_min, age_max, age_unit, value_min, value_max, value_type, qualitative_value, created_at
			FROM reference_intervals WHERE test_item_id IN (%s)`, placeholders,
		), args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var ri models.ReferenceInterval
		var ageMin, ageMax, valMin, valMax interface{}
		if err := rows.Scan(&ri.ID, &ri.TestItemID, &ri.Gender, &ageMin, &ageMax, &ri.AgeUnit, &valMin, &valMax, &ri.ValueType, &ri.QualitativeValue, &ri.CreatedAt); err != nil {
			return nil, err
		}
		ri.AgeMin = float64Ptr(ageMin)
		ri.AgeMax = float64Ptr(ageMax)
		ri.ValueMin = float64Ptr(valMin)
		ri.ValueMax = float64Ptr(valMax)
		result[ri.TestItemID] = append(result[ri.TestItemID], ri)
	}
	return result, nil
}

// MatchBestRef 从已加载的候选列表中选出最佳参考区间（内存操作，不查 DB）。
func MatchBestRef(candidates []models.ReferenceInterval, gender string, ageAtSample float64) *models.ReferenceInterval {
	var best *models.ReferenceInterval
	bestScore := -1
	for i := range candidates {
		score, ok := scoreRefInterval(&candidates[i], gender, ageAtSample)
		if ok && score > bestScore {
			bestScore = score
			best = &candidates[i]
		}
	}
	return best
}

func scoreRefInterval(ri *models.ReferenceInterval, gender string, ageAtSample float64) (int, bool) {
	score := 0
	if ri.Gender == gender {
		score += 10
	} else if ri.Gender == "不限" {
		score += 5
	} else {
		return 0, false
	}
	if ri.AgeMin != nil && ri.AgeMax != nil {
		if ageAtSample >= *ri.AgeMin && ageAtSample <= *ri.AgeMax {
			score += 10
		} else {
			return 0, false
		}
	} else {
		score += 2
	}
	return score, true
}

func float64Ptr(v interface{}) *float64 {
	if v == nil {
		return nil
	}
	switch val := v.(type) {
	case float64:
		return &val
	case int64:
		f := float64(val)
		return &f
	default:
		return nil
	}
}
