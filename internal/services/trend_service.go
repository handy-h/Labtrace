package services

import (
	"database/sql"
	"strconv"
	"time"

	"labtrace/internal/database"
)

// TrendDataPoint represents a single data point in a trend chart.
type TrendDataPoint struct {
	ReportItemID   int64    `json:"report_item_id"`
	TestItemID     int64    `json:"test_item_id"`
	TestItemName   string   `json:"test_item_name"`
	SampleDate     string   `json:"sample_date"`
	HospitalName   string   `json:"hospital_name"`
	OriginalValue  string   `json:"original_value"`
	ConvertedValue float64  `json:"converted_value"`
	Unit           string   `json:"unit"`
	Confidence     int      `json:"confidence"`
	Flag           string   `json:"flag"`
	RefMin         *float64 `json:"ref_min,omitempty"`
	RefMax         *float64 `json:"ref_max,omitempty"`
	AgeAtSample    float64  `json:"age_at_sample"`
}

// GetTrendData retrieves trend data for a subject and test item across all reports.
// If testItemID is 0, returns all test items for the subject.
func GetTrendData(subjectID, testItemID int64, dateFrom, dateTo string) ([]TrendDataPoint, error) {
	query := `
		SELECT ri.id, COALESCE(ri.test_item_id, 0), COALESCE(ri.test_item_name, ti.standard_name, ''),
			lr.sample_date, COALESCE(h.name, ''),
			ri.original_value, ri.normalized_value, COALESCE(ri.normalized_unit, ri.original_unit),
			ri.confidence, ri.flag,
			ri.ref_interval_id,
			s.birth_date
		FROM report_items ri
		JOIN lab_reports lr ON lr.id = ri.report_id
		LEFT JOIN hospitals h ON h.id = lr.hospital_id
		JOIN subjects s ON s.id = lr.subject_id
		LEFT JOIN test_items ti ON ti.id = ri.test_item_id
		WHERE lr.subject_id = ? AND lr.ocr_status = 'imported'
	`
	args := []interface{}{subjectID}

	if testItemID > 0 {
		query += ` AND ri.test_item_id = ?`
		args = append(args, testItemID)
	}

	if dateFrom != "" {
		query += ` AND lr.sample_date >= ?`
		args = append(args, dateFrom)
	}
	if dateTo != "" {
		query += ` AND lr.sample_date <= ?`
		args = append(args, dateTo)
	}

	query += ` ORDER BY lr.sample_date ASC, ri.test_item_id ASC`

	rows, err := database.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var points []TrendDataPoint
	for rows.Next() {
		var p TrendDataPoint
		var normValue sql.NullFloat64
		var refID sql.NullInt64
		var birthDate string

		if err := rows.Scan(&p.ReportItemID, &p.TestItemID, &p.TestItemName,
			&p.SampleDate, &p.HospitalName,
			&p.OriginalValue, &normValue, &p.Unit,
			&p.Confidence, &p.Flag, &refID, &birthDate); err != nil {
			continue
		}

		if normValue.Valid {
			p.ConvertedValue = normValue.Float64
		} else {
			if v, err := strconv.ParseFloat(p.OriginalValue, 64); err == nil {
				p.ConvertedValue = v
			}
		}

		p.AgeAtSample = calcAgeYears(birthDate, p.SampleDate)

		if refID.Valid {
			var refMin, refMax sql.NullFloat64
			database.DB.QueryRow(
				`SELECT value_min, value_max FROM reference_intervals WHERE id = ?`, refID.Int64,
			).Scan(&refMin, &refMax)
			if refMin.Valid {
				p.RefMin = &refMin.Float64
			}
			if refMax.Valid {
				p.RefMax = &refMax.Float64
			}
		}

		points = append(points, p)
	}

	return points, nil
}

func calcAgeYears(birthDate, sampleDate string) float64 {
	birth, err1 := time.Parse("2006-01-02", birthDate)
	sample, err2 := time.Parse("2006-01-02", sampleDate)
	if err1 != nil || err2 != nil {
		return 0
	}
	years := sample.Sub(birth).Hours() / (365.25 * 24)
	if years < 0 {
		return 0
	}
	return years
}
