package services

import (
	"database/sql"
	"strconv"
	"strings"
	"time"

	"labtrace/internal/database"
)

// TrendDataPoint represents a single data point in a trend chart.
type TrendDataPoint struct {
	ReportItemID    int64    `json:"report_item_id"`
	TestItemID      int64    `json:"test_item_id"`
	TestItemName    string   `json:"test_item_name"`
	SampleDate      string   `json:"sample_date"`
	HospitalName    string   `json:"hospital_name"`
	OriginalValue   string   `json:"original_value"`
	ConvertedValue  float64  `json:"converted_value"`
	Unit            string   `json:"unit"`
	Flag            string   `json:"flag"`
	RefMin          *float64 `json:"ref_min,omitempty"`
	RefMax          *float64 `json:"ref_max,omitempty"`
	RefIntervalText string   `json:"ref_interval_text"`
	AgeAtSample     float64  `json:"age_at_sample"`
}

// GetTrendData retrieves trend data for a subject and test item across all reports.
// If testItemID is 0, returns all test items for the subject.
func GetTrendData(subjectID, testItemID int64, dateFrom, dateTo string) ([]TrendDataPoint, error) {
	query := `
		SELECT ri.id, COALESCE(ri.test_item_id, 0), COALESCE(ri.test_item_name, ti.standard_name, ''),
			lr.sample_date, COALESCE(h.name, ''),
			ri.original_value, ri.normalized_value,
			COALESCE(NULLIF(ri.normalized_unit, ''), NULLIF(ri.original_unit, ''), ti.default_unit, ''),
			ri.flag,
			ri.ref_interval_id, ri.ref_interval_text,
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

	// 第一遍：收集所有数据点和需要查询的 ref_interval_id
	var points []TrendDataPoint
	var pointRefIDs []sql.NullInt64 // 与 points 一一对应，存储每个点的 refID
	refIDs := make(map[int64]bool)

	for rows.Next() {
		var p TrendDataPoint
		var normValue sql.NullFloat64
		var refID sql.NullInt64
		var birthDate string

		if err := rows.Scan(&p.ReportItemID, &p.TestItemID, &p.TestItemName,
			&p.SampleDate, &p.HospitalName,
			&p.OriginalValue, &normValue, &p.Unit,
			&p.Flag, &refID, &p.RefIntervalText, &birthDate); err != nil {
			continue
		}

		if normValue.Valid {
			p.ConvertedValue = normValue.Float64
		} else {
			valStr := strings.TrimLeft(p.OriginalValue, "<>≤≥")
			valStr = strings.TrimSpace(valStr)
			if v, err := strconv.ParseFloat(valStr, 64); err == nil {
				p.ConvertedValue = v
			}
		}

		p.Unit = strings.TrimRight(p.Unit, "/")
		p.AgeAtSample = calcAgeYears(birthDate, p.SampleDate)

		if refID.Valid {
			refIDs[refID.Int64] = true
		}
		pointRefIDs = append(pointRefIDs, refID)

		points = append(points, p)
	}

	// 批量查询所有需要的参考区间（消除 N+1）
	refMap := make(map[int64][2]*float64) // id -> [min, max]
	if len(refIDs) > 0 {
		ids := make([]interface{}, 0, len(refIDs))
		placeholders := make([]string, 0, len(refIDs))
		for id := range refIDs {
			ids = append(ids, id)
			placeholders = append(placeholders, "?")
		}
		refQuery := `SELECT id, value_min, value_max FROM reference_intervals WHERE id IN (` +
			strings.Join(placeholders, ",") + `)`
		refRows, err := database.DB.Query(refQuery, ids...)
		if err == nil {
			defer refRows.Close()
			for refRows.Next() {
				var id int64
				var refMin, refMax sql.NullFloat64
				if refRows.Scan(&id, &refMin, &refMax) == nil {
					var pair [2]*float64
					if refMin.Valid {
						pair[0] = &refMin.Float64
					}
					if refMax.Valid {
						pair[1] = &refMax.Float64
					}
					refMap[id] = pair
				}
			}
		}
	}

	// 第二遍：填充参考区间并计算 flag
	for i := range points {
		p := &points[i]

		// 解析 ref_interval_text（优先级最高）
		if p.RefIntervalText != "" {
			if min, max, ok := parseRefRange(p.RefIntervalText); ok {
				p.RefMin = &min
				p.RefMax = &max
			}
		}

		// 如果 ref_interval_text 没有解析出结果，尝试从批量查询的 refMap 中获取
		if p.RefMin == nil && i < len(pointRefIDs) && pointRefIDs[i].Valid {
			if pair, ok := refMap[pointRefIDs[i].Int64]; ok {
				if pair[0] != nil {
					p.RefMin = pair[0]
				}
				if pair[1] != nil {
					p.RefMax = pair[1]
				}
			}
		}

		// 根据参考区间计算 flag（如果尚未设置）
		if p.Flag == "" && p.RefMin != nil && p.RefMax != nil && p.ConvertedValue != 0 {
			if p.ConvertedValue < *p.RefMin {
				p.Flag = "L"
			} else if p.ConvertedValue > *p.RefMax {
				p.Flag = "H"
			} else {
				p.Flag = "normal"
			}
		}
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

// parseRefRange parses a reference range string like "15-40" into min and max values.
func parseRefRange(s string) (min, max float64, ok bool) {
	s = strings.TrimSpace(s)
	// Try "-" separator
	if parts := strings.SplitN(s, "-", 2); len(parts) == 2 {
		if a, err := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64); err == nil {
			if b, err := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64); err == nil {
				return a, b, true
			}
		}
	}
	// Try "～" separator (Chinese tilde)
	if parts := strings.SplitN(s, "～", 2); len(parts) == 2 {
		if a, err := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64); err == nil {
			if b, err := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64); err == nil {
				return a, b, true
			}
		}
	}
	return 0, 0, false
}
