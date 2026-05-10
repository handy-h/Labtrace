package handlers

import (
	"database/sql"
	"net/http"
	"time"

	"labtrace/internal/database"
	"labtrace/internal/models"
	"labtrace/internal/services"

	"github.com/gin-gonic/gin"
)

// --- LabReport CRUD ---

func ListReports(c *gin.Context) {
	subjectID := c.Query("subject_id")
	hospitalID := c.Query("hospital_id")
	ocrStatus := c.Query("ocr_status")

	query := `SELECT lr.id, lr.subject_id, lr.hospital_id, lr.sample_date, lr.file_path, lr.file_md5, lr.ocr_status, lr.ocr_raw_json, lr.whole_report_notes, lr.created_at,
		h.name as hospital_name
		FROM lab_reports lr
		LEFT JOIN hospitals h ON h.id = lr.hospital_id`
	args := []interface{}{}
	conditions := []string{}

	if subjectID != "" {
		conditions = append(conditions, "lr.subject_id = ?")
		args = append(args, subjectID)
	}
	if hospitalID != "" {
		conditions = append(conditions, "lr.hospital_id = ?")
		args = append(args, hospitalID)
	}
	if ocrStatus != "" {
		conditions = append(conditions, "lr.ocr_status = ?")
		args = append(args, ocrStatus)
	}

	if len(conditions) > 0 {
		query += " WHERE " + conditions[0]
		for i := 1; i < len(conditions); i++ {
			query += " AND " + conditions[i]
		}
	}
	query += ` ORDER BY lr.created_at DESC`

	rows, err := database.DB.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	defer rows.Close()

	reports := []models.LabReport{}
	for rows.Next() {
		var r models.LabReport
		var hospID sql.NullInt64
		var hospName sql.NullString
		if err := rows.Scan(&r.ID, &r.SubjectID, &hospID, &r.SampleDate, &r.FilePath, &r.FileMD5, &r.OCRStatus, &r.OCRRawJSON, &r.WholeReportNotes, &r.CreatedAt, &hospName); err != nil {
			c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
			return
		}
		if hospID.Valid {
			r.HospitalID = &hospID.Int64
		}
		if hospName.Valid {
			r.HospitalName = hospName.String
		}
		reports = append(reports, r)
	}
	c.JSON(http.StatusOK, models.Success(reports))
}

func GetReport(c *gin.Context) {
	id := c.Param("id")

	var r models.LabReport
	var hospID sql.NullInt64
	var hospName sql.NullString
	err := database.DB.QueryRow(
		`SELECT lr.id, lr.subject_id, lr.hospital_id, lr.sample_date, lr.file_path, lr.file_md5, lr.ocr_status, lr.ocr_raw_json, lr.whole_report_notes, lr.created_at,
		h.name as hospital_name
		FROM lab_reports lr
		LEFT JOIN hospitals h ON h.id = lr.hospital_id
		WHERE lr.id = ?`, id,
	).Scan(&r.ID, &r.SubjectID, &hospID, &r.SampleDate, &r.FilePath, &r.FileMD5, &r.OCRStatus, &r.OCRRawJSON, &r.WholeReportNotes, &r.CreatedAt, &hospName)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.Error("报告未找到"))
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	if hospID.Valid {
		r.HospitalID = &hospID.Int64
	}
	if hospName.Valid {
		r.HospitalName = hospName.String
	}

	// Load report items
	r.Items = loadReportItems(id)

	c.JSON(http.StatusOK, models.Success(r))
}

func loadReportItems(reportID string) []models.ReportItem {
	rows, err := database.DB.Query(
		`SELECT ri.id, ri.report_id, ri.test_item_id, ri.original_value, ri.normalized_value, ri.original_unit, ri.normalized_unit,
		ri.confidence, ri.ref_interval_id, ri.flag, ri.row_notes, ri.ocr_bbox, ri.created_at,
		COALESCE(ri.test_item_name, ti.standard_name, '') as test_item_name,
		COALESCE(
			ri.ref_interval_text,
			CASE WHEN ri.ref_interval_id IS NOT NULL THEN
				(SELECT CAST(value_min AS TEXT) || '-' || CAST(value_max AS TEXT) FROM reference_intervals WHERE id = ri.ref_interval_id)
			ELSE ''
			END, ''
		) as ref_interval_text
		FROM report_items ri
		LEFT JOIN test_items ti ON ti.id = ri.test_item_id
		WHERE ri.report_id = ? ORDER BY ri.id`, reportID,
	)
	if err != nil {
		return nil
	}
	defer rows.Close()

	items := []models.ReportItem{}
	for rows.Next() {
		var item models.ReportItem
		var testItemID sql.NullInt64
		var refID sql.NullInt64
		var normValue sql.NullFloat64
		if err := rows.Scan(&item.ID, &item.ReportID, &testItemID, &item.OriginalValue, &normValue, &item.OriginalUnit, &item.NormalizedUnit,
			&item.Confidence, &refID, &item.Flag, &item.RowNotes, &item.OCRBBox, &item.CreatedAt,
			&item.TestItemName, &item.RefIntervalText); err != nil {
			continue
		}
		if testItemID.Valid {
			item.TestItemID = &testItemID.Int64
		}
		if refID.Valid {
			item.RefIntervalID = &refID.Int64
		}
		if normValue.Valid {
			item.NormalizedValue = &normValue.Float64
		}
		items = append(items, item)
	}
	return items
}

// UpdateReportItem updates a single report item (for manual correction during review).
func UpdateReportItem(c *gin.Context) {
	reportID := c.Param("id")
	itemID := c.Param("itemId")

	var item models.ReportItem
	if err := c.ShouldBindJSON(&item); err != nil {
		c.JSON(http.StatusBadRequest, models.Error(err.Error()))
		return
	}

	_, err := database.DB.Exec(
		`UPDATE report_items SET test_item_name=?, original_value=?, original_unit=?, ref_interval_text=?, flag=?, confidence=?, row_notes=? WHERE id=? AND report_id=?`,
		item.TestItemName, item.OriginalValue, item.OriginalUnit, item.RefIntervalText, item.Flag, item.Confidence, item.RowNotes, itemID, reportID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	c.JSON(http.StatusOK, models.Success(nil))
}

// ConfirmReport marks all items in a report as confirmed (reviewed).
func ConfirmReport(c *gin.Context) {
	id := c.Param("id")
	_, err := database.DB.Exec(`UPDATE report_items SET confidence = 100 WHERE report_id = ?`, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	c.JSON(http.StatusOK, models.Success(nil))
}

// ImportReport imports a report into the database (final step after review).
func ImportReport(c *gin.Context) {
	id := c.Param("id")

	// Get report info
	var subjectID int64
	var sampleDate string
	err := database.DB.QueryRow(
		`SELECT lr.subject_id, lr.sample_date FROM lab_reports lr WHERE lr.id = ?`, id,
	).Scan(&subjectID, &sampleDate)
	if err != nil {
		c.JSON(http.StatusNotFound, models.Error("报告未找到"))
		return
	}

	// Get subject info
	var gender, birthDate string
	err = database.DB.QueryRow(
		`SELECT gender, birth_date FROM subjects WHERE id = ?`, subjectID,
	).Scan(&gender, &birthDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.Error("受检者信息未找到"))
		return
	}

	// Calculate age at sample date
	ageAtSample := calculateAgeYears(birthDate, sampleDate)

	// Get all report items for processing
	rows, err := database.DB.Query(
		`SELECT ri.id, ri.test_item_id, ri.original_value, ri.original_unit
		FROM report_items ri WHERE ri.report_id = ?`, id,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}

	type itemInfo struct {
		ID         int64
		TestItemID *int64
		OrigValue  string
		OrigUnit   string
	}
	var items []itemInfo
	for rows.Next() {
		var it itemInfo
		if err := rows.Scan(&it.ID, &it.TestItemID, &it.OrigValue, &it.OrigUnit); err != nil {
			continue
		}
		items = append(items, it)
	}
	rows.Close() // 释放连接，避免后续 DB 调用死锁（SetMaxOpenConns=1）

	// Process each item: match reference interval, calculate flag
	for _, it := range items {
		if it.TestItemID == nil {
			continue
		}

		ri, _ := services.MatchReference(*it.TestItemID, gender, ageAtSample)
		flag := services.CalculateFlag(it.OrigValue, ri)

		var refID interface{} = nil
		if ri != nil {
			refID = ri.ID
		}
		database.DB.Exec(
			`UPDATE report_items SET ref_interval_id=?, flag=? WHERE id=?`,
			refID, flag, it.ID,
		)
	}

	// Calculation validation
	reportItems := loadReportItems(id)
	warnings, _ := services.ValidateCalculations(reportItems)

	// Update report status
	database.DB.Exec(`UPDATE lab_reports SET ocr_status = 'imported' WHERE id = ?`, id)

	c.JSON(http.StatusOK, models.Success(gin.H{
		"status":   "imported",
		"warnings": warnings,
	}))
}

// calculateAgeYears calculates age in years from birth date to sample date.
func calculateAgeYears(birthDate, sampleDate string) float64 {
	birth, err1 := parseDateStr(birthDate)
	sample, err2 := parseDateStr(sampleDate)
	if err1 != nil || err2 != nil {
		return 0
	}
	years := sample.Sub(birth).Hours() / (365.25 * 24)
	if years < 0 {
		return 0
	}
	return years
}

func parseDateStr(s string) (time.Time, error) {
	formats := []string{"2006-01-02", "2006/01/02", "2006.01.02"}
	for _, f := range formats {
		if t, err := time.Parse(f, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, errInvalidDate
}

var errInvalidDate = errInvalidDateType("invalid date format")

type errInvalidDateType string

func (e errInvalidDateType) Error() string { return string(e) }
