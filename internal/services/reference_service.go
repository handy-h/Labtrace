package services

import (
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

		// Score: higher is better match
		score := 0

		// Gender match
		if ri.Gender == gender {
			score += 10 // exact gender match
		} else if ri.Gender == "不限" {
			score += 5 // fallback
		} else {
			continue // gender doesn't match at all
		}

		// Age range match
		if ri.AgeMin != nil && ri.AgeMax != nil {
			if ageAtSample >= *ri.AgeMin && ageAtSample <= *ri.AgeMax {
				score += 10 // within range
			} else {
				continue // out of age range
			}
		} else {
			score += 2 // no age restriction (lower priority)
		}

		if score > bestScore {
			bestScore = score
			best = &ri
		}
	}

	return best, nil
}

func float64Ptr(v interface{}) *float64 {
	if v == nil {
		return nil
	}
	switch val := v.(type) {
	case float64:
		return &val
	default:
		return nil
	}
}
