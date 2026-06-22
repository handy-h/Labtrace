package handlers

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strings"

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
	startDate := c.Query("start_date")
	endDate := c.Query("end_date")

	query := `SELECT lr.id, lr.subject_id, lr.hospital_id, lr.sample_date, lr.file_path, lr.file_md5, lr.ocr_status, lr.ocr_raw_json, lr.whole_report_notes, lr.created_at,
		s.name as subject_name,
		h.name as hospital_name,
		COALESCE(lr.categories, '') as categories
		FROM lab_reports lr
		LEFT JOIN subjects s ON s.id = lr.subject_id
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
	if startDate != "" {
		conditions = append(conditions, "lr.sample_date >= ?")
		args = append(args, startDate)
	}
	if endDate != "" {
		conditions = append(conditions, "lr.sample_date <= ?")
		args = append(args, endDate)
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
		if err := rows.Scan(&r.ID, &r.SubjectID, &hospID, &r.SampleDate, &r.FilePath, &r.FileMD5, &r.OCRStatus, &r.OCRRawJSON, &r.WholeReportNotes, &r.CreatedAt, &r.SubjectName, &hospName, &r.Categories); err != nil {
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
		s.name as subject_name,
		h.name as hospital_name,
		COALESCE(lr.categories, '') as categories
		FROM lab_reports lr
		LEFT JOIN subjects s ON s.id = lr.subject_id
		LEFT JOIN hospitals h ON h.id = lr.hospital_id
		WHERE lr.id = ?`, id,
	).Scan(&r.ID, &r.SubjectID, &hospID, &r.SampleDate, &r.FilePath, &r.FileMD5, &r.OCRStatus, &r.OCRRawJSON, &r.WholeReportNotes, &r.CreatedAt, &r.SubjectName, &hospName, &r.Categories)
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

	// 注意：GetReport 保持只读语义。自动匹配 test_item_id / 参考区间 / flag 的逻辑
	// 统一在 Confirm / Import 阶段执行（写入操作），避免 GET 接口产生副作用。

	// Load report items
	items, err := loadReportItems(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error("加载报告项失败"))
		return
	}
	r.Items = items

	c.JSON(http.StatusOK, models.Success(r))
}

func loadReportItems(reportID string) ([]models.ReportItem, error) {
	rows, err := database.DB.Query(
		`SELECT ri.id, ri.report_id, ri.test_item_id, ri.original_value, ri.normalized_value, ri.original_unit, ri.normalized_unit,
		ri.confidence, ri.ref_interval_id, ri.flag, ri.row_notes, ri.ocr_bbox, ri.created_at,
		COALESCE(ri.test_item_name, ti.standard_name, '') as test_item_name,
		COALESCE(
			ri.ref_interval_text,
			CASE WHEN ref.id IS NOT NULL
				THEN CAST(ref.value_min AS TEXT) || '-' || CAST(ref.value_max AS TEXT)
			ELSE '' END,
			''
		) as ref_interval_text,
		COALESCE(ti.category, '') as category
		FROM report_items ri
		LEFT JOIN test_items ti ON ti.id = ri.test_item_id
		LEFT JOIN reference_intervals ref ON ref.id = ri.ref_interval_id
		WHERE ri.report_id = ? ORDER BY ri.id`, reportID,
	)
	if err != nil {
		return nil, err
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
			&item.TestItemName, &item.RefIntervalText, &item.Category); err != nil {
			log.Printf("[report] 扫描报告项失败: err=%v", err)
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
	return items, nil
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
		if _, err := database.DB.Exec(`UPDATE report_items SET test_item_id=? WHERE id=? AND report_id=?`,
			*item.TestItemID, itemID, reportID); err != nil {
			log.Printf("[report] 更新 test_item_id 失败: itemID=%s err=%v", itemID, err)
		}
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

// UpdateReport updates a report's fields (e.g. categories).
func UpdateReport(c *gin.Context) {
	id := c.Param("id")

	var body struct {
		Categories string `json:"categories"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.Error(err.Error()))
		return
	}

	_, err := database.DB.Exec(`UPDATE lab_reports SET categories = ? WHERE id = ?`, body.Categories, id)
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
// 匹配参考区间/flag、confidence=100、状态更新放在同一个事务里，避免半成品状态。
func ConfirmReport(c *gin.Context) {
	id := c.Param("id")

	tx, err := database.DB.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}

	// 1) 在事务内匹配 test_item_id / 参考区间 / 计算 flag（不再开新事务，避免互锁）
	if matchErr := matchRefAndCalcFlagWithTx(tx, id); matchErr != nil {
		tx.Rollback()
		log.Printf("[report] confirm matchRef 失败: id=%s err=%v", id, matchErr)
		// matchRef 失败不阻断 confirm 流程的核心更新，只记录日志后继续提交 confidence/status
		// —— 但为避免脏数据，这里选择回滚并返回错误，让用户重试
		c.JSON(http.StatusInternalServerError, models.Error("确认失败：匹配参考区间时出错"))
		return
	}

	// 2) confidence 置为 100，状态改为 imported
	if _, err = tx.Exec(`UPDATE report_items SET confidence = 100 WHERE report_id = ?`, id); err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	if _, err = tx.Exec(`UPDATE lab_reports SET ocr_status = 'imported' WHERE id = ?`, id); err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	if err = tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.Success(nil))
}

// itemInfo 用于 matchRefAndCalcFlag 的临时结构。
type itemInfo struct {
	ID           int64
	TestItemID   *int64
	TestItemName string
	OrigValue    string
	OrigUnit     string
	Category     string
}

// matchRefAndCalcFlag 自动匹配 test_item_id、参考区间并计算提示符 flag。
// 自开事务版本，供 ReOCR 等不希望复用外部事务的场景使用。
func matchRefAndCalcFlag(reportID string) {
	tx, err := database.DB.Begin()
	if err != nil {
		log.Printf("[matchRef] 开启事务失败: reportID=%s err=%v", reportID, err)
		return
	}
	if err := matchRefAndCalcFlagWithTx(tx, reportID); err != nil {
		tx.Rollback()
		log.Printf("[matchRef] 失败: reportID=%s err=%v", reportID, err)
		return
	}
	if err := tx.Commit(); err != nil {
		log.Printf("[matchRef] 提交事务失败: reportID=%s err=%v", reportID, err)
	}
}

// matchRefAndCalcFlagWithTx 在指定事务内执行匹配逻辑，调用方负责 Commit/Rollback。
// 这样 ConfirmReport / ImportReport 可以把匹配与状态更新放进同一事务。
func matchRefAndCalcFlagWithTx(tx *sql.Tx, reportID string) error {
	subjectID, sampleDate, err := fetchReportSubjectInfo(reportID)
	if err != nil {
		return fmt.Errorf("fetch report subject: %w", err)
	}

	gender, birthDate, err := fetchSubjectInfo(subjectID)
	if err != nil {
		return fmt.Errorf("fetch subject: %w", err)
	}

	ageAtSample := services.CalcAgeYears(birthDate, sampleDate)
	items, err := fetchReportItemInfos(reportID)
	if err != nil {
		return fmt.Errorf("fetch items: %w", err)
	}

	itemIdx := services.LoadTestItemIndex()
	return runMatchRefInTx(tx, items, itemIdx, reportID, gender, ageAtSample)
}

func fetchReportSubjectInfo(reportID string) (subjectID int64, sampleDate string, err error) {
	err = database.DB.QueryRow(
		`SELECT lr.subject_id, lr.sample_date FROM lab_reports lr WHERE lr.id = ?`, reportID,
	).Scan(&subjectID, &sampleDate)
	return
}

func fetchSubjectInfo(subjectID int64) (gender, birthDate string, err error) {
	err = database.DB.QueryRow(
		`SELECT gender, birth_date FROM subjects WHERE id = ?`, subjectID,
	).Scan(&gender, &birthDate)
	return
}

func fetchReportItemInfos(reportID string) ([]itemInfo, error) {
	rows, err := database.DB.Query(
		`SELECT ri.id, ri.test_item_id, ri.test_item_name, ri.original_value, ri.original_unit, ri.category
		FROM report_items ri WHERE ri.report_id = ?`, reportID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []itemInfo
	for rows.Next() {
		var it itemInfo
		if err := rows.Scan(&it.ID, &it.TestItemID, &it.TestItemName, &it.OrigValue, &it.OrigUnit, &it.Category); err != nil {
			log.Printf("[matchRef] 扫描报告项失败: %v", err)
			continue
		}
		items = append(items, it)
	}
	return items, nil
}

func runMatchRefInTx(tx *sql.Tx, items []itemInfo, itemIdx *services.TestItemIndex, reportID, gender string, ageAtSample float64) error {
	// Auto-match test_item_name → test_item_id, create if not exists
	for i := range items {
		if items[i].TestItemID == nil && items[i].TestItemName != "" {
			matchID := itemIdx.Match(items[i].TestItemName)
			if matchID > 0 {
				items[i].TestItemID = &matchID
				if _, execErr := tx.Exec(`UPDATE report_items SET test_item_id = ? WHERE id = ?`, matchID, items[i].ID); execErr != nil {
					log.Printf("[matchRef] 更新 test_item_id 失败: %v", execErr)
				}
				if items[i].Category != "" {
					if _, execErr := tx.Exec(`UPDATE test_items SET category = ? WHERE id = ?`, items[i].Category, matchID); execErr != nil {
						log.Printf("[matchRef] 更新 category 失败: %v", execErr)
					}
				} else if cat := itemIdx.GetCategory(matchID); cat != "" {
					items[i].Category = cat
					if _, execErr := tx.Exec(`UPDATE report_items SET category = ? WHERE id = ?`, cat, items[i].ID); execErr != nil {
						log.Printf("[matchRef] 回填 category 失败: %v", execErr)
					}
				}
			} else {
				name := items[i].TestItemName
				code := strings.ReplaceAll(strings.ToUpper(name), " ", "_")
				res, execErr := tx.Exec(
					`INSERT INTO test_items (code, standard_name, category, default_unit, value_type) VALUES (?, ?, ?, ?, 'numeric')`,
					code, name, items[i].Category, items[i].OrigUnit,
				)
				if execErr == nil {
					newID, _ := res.LastInsertId()
					items[i].TestItemID = &newID
					if _, execErr2 := tx.Exec(`UPDATE report_items SET test_item_id = ? WHERE id = ?`, newID, items[i].ID); execErr2 != nil {
						log.Printf("[matchRef] 关联新 test_item 失败: %v", execErr2)
					}
					itemIdx.AddCandidate(newID, name, items[i].Category)
				}
			}
		}
	}

	// 批量加载所有相关参考区间（一次 IN 查询）
	var testItemIDs []int64
	seen := make(map[int64]bool)
	for _, it := range items {
		if it.TestItemID != nil && !seen[*it.TestItemID] {
			testItemIDs = append(testItemIDs, *it.TestItemID)
			seen[*it.TestItemID] = true
		}
	}
	refMap, _ := services.LoadReferenceIntervals(testItemIDs)

	// Match reference interval and calculate flag — all in memory, then batch UPDATE
	catSet := make(map[string]bool)
	for _, it := range items {
		if it.Category != "" {
			catSet[it.Category] = true
		}
		if it.TestItemID == nil {
			continue
		}
		candidates := refMap[*it.TestItemID]
		ri := services.MatchBestRef(candidates, gender, ageAtSample)
		flag := services.CalculateFlag(it.OrigValue, ri)
		var refID interface{} = nil
		if ri != nil {
			refID = ri.ID
		}
		if _, execErr := tx.Exec(
			`UPDATE report_items SET ref_interval_id=?, flag=? WHERE id=?`,
			refID, flag, it.ID,
		); execErr != nil {
			log.Printf("[matchRef] 更新 flag 失败: itemID=%d err=%v", it.ID, execErr)
		}
	}

	// 收集所有项目的分类，去重后更新 lab_reports.categories
	if len(catSet) > 0 {
		cats := make([]string, 0, len(catSet))
		for c := range catSet {
			cats = append(cats, c)
		}
		sort.Strings(cats)
		if _, execErr := tx.Exec(`UPDATE lab_reports SET categories = ? WHERE id = ?`, strings.Join(cats, ","), reportID); execErr != nil {
			log.Printf("[matchRef] 更新 categories 失败: reportID=%s err=%v", reportID, execErr)
		}
	}

	return nil
}

// ImportReport imports a report into the database (final step after review).
func ImportReport(c *gin.Context) {
	id := c.Param("id")

	// 匹配参考区间、计算提示符
	matchRefAndCalcFlag(id)

	// Calculation validation
	reportItems, err := loadReportItems(id)
	if err != nil {
		log.Printf("[report] 加载报告项失败: id=%s err=%v", id, err)
	}
	warnings, err := services.ValidateCalculations(reportItems)
	if err != nil {
		log.Printf("[report] 计算规则校验失败: id=%s err=%v", id, err)
	}

	// Update report status
	if _, err := database.DB.Exec(`UPDATE lab_reports SET ocr_status = 'imported' WHERE id = ?`, id); err != nil {
		log.Printf("[report] 更新报告状态失败: id=%s err=%v", id, err)
	}

	c.JSON(http.StatusOK, models.Success(gin.H{
		"status":   "imported",
		"warnings": warnings,
	}))
}


