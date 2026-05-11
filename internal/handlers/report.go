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

	query := `SELECT lr.id, lr.subject_id, lr.hospital_id, lr.sample_date, lr.file_path, lr.file_md5, lr.ocr_status, lr.ocr_raw_json, lr.whole_report_notes, lr.category_id, lr.created_at,
		h.name as hospital_name,
		COALESCE(rc.name, '') as category_name
		FROM lab_reports lr
		LEFT JOIN hospitals h ON h.id = lr.hospital_id
		LEFT JOIN report_categories rc ON rc.id = lr.category_id`
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
		var catID sql.NullInt64
		if err := rows.Scan(&r.ID, &r.SubjectID, &hospID, &r.SampleDate, &r.FilePath, &r.FileMD5, &r.OCRStatus, &r.OCRRawJSON, &r.WholeReportNotes, &catID, &r.CreatedAt, &hospName, &r.CategoryName); err != nil {
			c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
			return
		}
		if hospID.Valid {
			r.HospitalID = &hospID.Int64
		}
		if hospName.Valid {
			r.HospitalName = hospName.String
		}
		if catID.Valid {
			r.CategoryID = &catID.Int64
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
	var catID sql.NullInt64
	err := database.DB.QueryRow(
		`SELECT lr.id, lr.subject_id, lr.hospital_id, lr.sample_date, lr.file_path, lr.file_md5, lr.ocr_status, lr.ocr_raw_json, lr.whole_report_notes, lr.category_id, lr.created_at,
		h.name as hospital_name,
		COALESCE(rc.name, '') as category_name
		FROM lab_reports lr
		LEFT JOIN hospitals h ON h.id = lr.hospital_id
		LEFT JOIN report_categories rc ON rc.id = lr.category_id
		WHERE lr.id = ?`, id,
	).Scan(&r.ID, &r.SubjectID, &hospID, &r.SampleDate, &r.FilePath, &r.FileMD5, &r.OCRStatus, &r.OCRRawJSON, &r.WholeReportNotes, &catID, &r.CreatedAt, &hospName, &r.CategoryName)
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
	if catID.Valid {
		r.CategoryID = &catID.Int64
	}

	// review状态时自动匹配参考区间和计算提示符，让核效阶段就能看到flag
	if r.OCRStatus == "review" {
		matchRefAndCalcFlag(id)
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

// UpdateReport updates report-level fields (e.g. category_id).
func UpdateReport(c *gin.Context) {
	id := c.Param("id")

	var req struct {
		CategoryID *int64 `json:"category_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.Error("参数错误"))
		return
	}

	if req.CategoryID != nil {
		if *req.CategoryID == 0 {
			database.DB.Exec(`UPDATE lab_reports SET category_id = NULL WHERE id = ?`, id)
		} else {
			database.DB.Exec(`UPDATE lab_reports SET category_id = ? WHERE id = ?`, *req.CategoryID, id)
		}
	}

	c.JSON(http.StatusOK, models.Success(nil))
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

	// If test_item_id is explicitly provided, update it separately
	if item.TestItemID != nil {
		database.DB.Exec(`UPDATE report_items SET test_item_id=? WHERE id=? AND report_id=?`,
			*item.TestItemID, itemID, reportID)
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

// DeleteReportItem deletes a single report item.
func DeleteReportItem(c *gin.Context) {
	reportID := c.Param("id")
	itemID := c.Param("itemId")

	_, err := database.DB.Exec(`DELETE FROM report_items WHERE id=? AND report_id=?`, itemID, reportID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	c.JSON(http.StatusOK, models.Success(nil))
}

// ConfirmReport marks all items in a report as confirmed (reviewed).
func ConfirmReport(c *gin.Context) {
	id := c.Param("id")

	// 匹配参考区间、计算提示符（让核效阶段就能看到flag）
	matchRefAndCalcFlag(id)

	_, err := database.DB.Exec(`UPDATE report_items SET confidence = 100 WHERE report_id = ?`, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	c.JSON(http.StatusOK, models.Success(nil))
}

// matchRefAndCalcFlag 自动匹配test_item_id、参考区间并计算提示符flag。
// 在确认核效和入库时都会调用。
func matchRefAndCalcFlag(reportID string) {
	// Get report info
	var subjectID int64
	var sampleDate string
	err := database.DB.QueryRow(
		`SELECT lr.subject_id, lr.sample_date FROM lab_reports lr WHERE lr.id = ?`, reportID,
	).Scan(&subjectID, &sampleDate)
	if err != nil {
		return
	}

	// Get subject info
	var gender, birthDate string
	err = database.DB.QueryRow(
		`SELECT gender, birth_date FROM subjects WHERE id = ?`, subjectID,
	).Scan(&gender, &birthDate)
	if err != nil {
		return
	}

	ageAtSample := calculateAgeYears(birthDate, sampleDate)

	// Get all report items
	rows, err := database.DB.Query(
		`SELECT ri.id, ri.test_item_id, ri.test_item_name, ri.original_value, ri.original_unit
		FROM report_items ri WHERE ri.report_id = ?`, reportID,
	)
	if err != nil {
		return
	}

	type itemInfo struct {
		ID           int64
		TestItemID   *int64
		TestItemName string
		OrigValue    string
		OrigUnit     string
	}
	var items []itemInfo
	for rows.Next() {
		var it itemInfo
		if err := rows.Scan(&it.ID, &it.TestItemID, &it.TestItemName, &it.OrigValue, &it.OrigUnit); err != nil {
			continue
		}
		items = append(items, it)
	}
	rows.Close()

	// Auto-match test_item_name → test_item_id
	for i := range items {
		if items[i].TestItemID == nil && items[i].TestItemName != "" {
			matchID := services.MatchTestItemByName(items[i].TestItemName)
			if matchID > 0 {
				items[i].TestItemID = &matchID
				database.DB.Exec(`UPDATE report_items SET test_item_id = ? WHERE id = ?`, matchID, items[i].ID)
			}
		}
	}

	// Match reference interval, calculate flag
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
}

// ImportReport imports a report into the database (final step after review).
func ImportReport(c *gin.Context) {
	id := c.Param("id")

	// 匹配参考区间、计算提示符
	matchRefAndCalcFlag(id)

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
