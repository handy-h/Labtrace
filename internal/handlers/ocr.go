package handlers

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"labtrace/internal/config"
	"labtrace/internal/database"
	"labtrace/internal/models"
	"labtrace/internal/services"

	"github.com/gin-gonic/gin"
)

// Upload handles file upload and triggers OCR recognition.
func Upload(c *gin.Context) {
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, models.Error("文件上传失败: "+err.Error()))
		return
	}
	defer file.Close()

	// Read file bytes
	fileBytes, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error("读取文件失败"))
		return
	}

	// Calculate MD5
	hash := md5.Sum(fileBytes)
	fileMD5 := hex.EncodeToString(hash[:])

	// Check duplicate
	var count int
	database.DB.QueryRow(`SELECT COUNT(*) FROM lab_reports WHERE file_md5 = ?`, fileMD5).Scan(&count)
	if count > 0 {
		c.JSON(http.StatusConflict, models.Error("该文件已入库，禁止重复录入"))
		return
	}

	// Save file to uploads directory
	cfg, _ := config.Load()
	uploadDir := cfg.UploadDir
	os.MkdirAll(uploadDir, 0755)

	filePath := filepath.Join(uploadDir, fmt.Sprintf("%s_%s", fileMD5[:12], header.Filename))
	if err := os.WriteFile(filePath, fileBytes, 0644); err != nil {
		c.JSON(http.StatusInternalServerError, models.Error("保存文件失败"))
		return
	}

	// Get subject_id and hospital_id from form
	subjectID, _ := strconv.ParseInt(c.PostForm("subject_id"), 10, 64)
	hospitalID, _ := strconv.ParseInt(c.PostForm("hospital_id"), 10, 64)
	sampleDate := c.PostForm("sample_date")

	// Create lab_reports record
	var hospID interface{} = nil
	if hospitalID > 0 {
		hospID = hospitalID
	}

	result, err := database.DB.Exec(
		`INSERT INTO lab_reports (subject_id, hospital_id, sample_date, file_path, file_md5, ocr_status) VALUES (?, ?, ?, ?, ?, 'processing')`,
		subjectID, hospID, sampleDate, filePath, fileMD5,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	reportID, _ := result.LastInsertId()

	// Async OCR recognition
	go func() {
		ocrResults, err := services.Recognize(fileBytes, cfg)

		// Record OCR API call in monthly quota (success = HTTP call succeeded)
		apiSuccess := err == nil
		if quotaErr := services.RecordOCRCall(apiSuccess); quotaErr != nil {
			log.Printf("[ocr] record quota: %v", quotaErr)
		}

		if err != nil {
			database.DB.Exec(`UPDATE lab_reports SET ocr_status = 'failed' WHERE id = ?`, reportID)
			services.LogAction("ocr_failed", "lab_report", reportID, gin.H{"error": err.Error()})
			return
		}

		// Store raw OCR JSON
		ocrJSON, _ := json.Marshal(ocrResults)
		database.DB.Exec(`UPDATE lab_reports SET ocr_raw_json = ? WHERE id = ?`, string(ocrJSON), reportID)

		// Check if OCR returned any data
		if len(ocrResults) == 0 {
			log.Printf("[ocr] OCR returned zero results for report %d", reportID)
			database.DB.Exec(`UPDATE lab_reports SET ocr_status = 'failed' WHERE id = ?`, reportID)
			services.LogAction("ocr_failed", "lab_report", reportID, gin.H{"error": "OCR returned no results"})
			return
		}

		// Parse OCR results into structured lab items (name/value/unit/range)
		parsedItems := services.ParseLabResults(ocrResults)

		if len(parsedItems) > 0 {
			// Create report_items from parsed items
			for _, item := range parsedItems {
				normalizedValue := services.NormalizeQualitative(item.Value)
				database.DB.Exec(
					`INSERT INTO report_items (report_id, test_item_name, original_value, original_unit, confidence, ocr_bbox, ref_interval_text, row_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
					reportID, item.Name, normalizedValue, item.Unit, item.Confidence, item.BBox, item.Range, item.Range,
				)
			}
		} else {
			// Fallback: insert raw OCR blocks as individual items
			for _, r := range ocrResults {
				normalizedValue := services.NormalizeQualitative(r.Text)
				database.DB.Exec(
					`INSERT INTO report_items (report_id, original_value, confidence, ocr_bbox) VALUES (?, ?, ?, ?)`,
					reportID, normalizedValue, int(r.Confidence), fmt.Sprintf(`{"x":%d,"y":%d,"w":%d,"h":%d}`, r.Left, r.Top, r.Width, r.Height),
				)
			}
		}

		// Update status to review (only if items were inserted)
		database.DB.Exec(`UPDATE lab_reports SET ocr_status = 'review' WHERE id = ?`, reportID)

		// Audit log
		services.LogAction("ocr_upload", "lab_report", reportID, nil)
	}()

	c.JSON(http.StatusCreated, models.Success(gin.H{
		"report_id": reportID,
		"file_md5":  fileMD5,
		"status":    "processing",
	}))
}

// GetReportImage serves the original file for a report.
func GetReportImage(c *gin.Context) {
	id := c.Param("id")

	var filePath string
	err := database.DB.QueryRow(`SELECT file_path FROM lab_reports WHERE id = ?`, id).Scan(&filePath)
	if err != nil {
		c.JSON(http.StatusNotFound, models.Error("报告未找到"))
		return
	}

	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, models.Error("原始文件不存在"))
		return
	}

	c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
	c.Header("Pragma", "no-cache")
	c.Header("Expires", "0")
	c.File(filePath)
}

// GetOCRBlocks returns the raw OCR block data for a report (used by the mapping wizard).
func GetOCRBlocks(c *gin.Context) {
	id := c.Param("id")

	var rawJSON string
	err := database.DB.QueryRow(`SELECT ocr_raw_json FROM lab_reports WHERE id = ?`, id).Scan(&rawJSON)
	if err != nil {
		c.JSON(http.StatusNotFound, models.Error("报告未找到"))
		return
	}
	if rawJSON == "" {
		c.JSON(http.StatusOK, models.Success(gin.H{
			"blocks":      []interface{}{},
			"auto_region": services.TableRegion{Page: -1},
		}))
		return
	}

	var blocks []services.OCRResult
	if err := json.Unmarshal([]byte(rawJSON), &blocks); err != nil {
		c.JSON(http.StatusInternalServerError, models.Error("解析OCR数据失败"))
		return
	}

	autoRegion := services.AutoDetectTableRegion(blocks)
	c.JSON(http.StatusOK, models.Success(gin.H{
		"blocks":      blocks,
		"auto_region": autoRegion,
	}))
}

// ApplyColumnMapping re-parses a report using a user-defined column mapping.
func ApplyColumnMapping(c *gin.Context) {
	id := c.Param("id")

	var cfg services.ColumnMappingConfig
	if err := c.ShouldBindJSON(&cfg); err != nil {
		c.JSON(http.StatusBadRequest, models.Error("请求参数错误: "+err.Error()))
		return
	}

	var rawJSON, sampleDate string
	err := database.DB.QueryRow(
		`SELECT ocr_raw_json, sample_date FROM lab_reports WHERE id = ?`, id,
	).Scan(&rawJSON, &sampleDate)
	if err != nil {
		c.JSON(http.StatusNotFound, models.Error("报告未找到"))
		return
	}
	if rawJSON == "" {
		c.JSON(http.StatusBadRequest, models.Error("该报告尚无OCR数据，请先完成OCR识别"))
		return
	}

	var blocks []services.OCRResult
	if err := json.Unmarshal([]byte(rawJSON), &blocks); err != nil {
		c.JSON(http.StatusInternalServerError, models.Error("解析OCR数据失败"))
		return
	}

	parsedItems := services.ParseLabResultsWithMapping(blocks, cfg)

	if cfg.SampleDate != "" && cfg.SampleDate != sampleDate {
		database.DB.Exec(`UPDATE lab_reports SET sample_date = ? WHERE id = ?`, cfg.SampleDate, id)
	}

	mappingJSON, _ := services.MarshalColumnMappingConfig(cfg)
	database.DB.Exec(`UPDATE lab_reports SET column_mapping_json = ? WHERE id = ?`, mappingJSON, id)

	database.DB.Exec(`DELETE FROM report_items WHERE report_id = ?`, id)
	for _, item := range parsedItems {
		rowNotes := item.RowText
		database.DB.Exec(
			`INSERT INTO report_items (report_id, test_item_name, original_value, original_unit, confidence, ocr_bbox, ref_interval_text, row_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			id, item.Name, item.Value, item.Unit, item.Confidence, item.BBox, item.Range, rowNotes,
		)
	}

	database.DB.Exec(`UPDATE lab_reports SET ocr_status = 'review' WHERE id = ?`, id)

	reportIDInt, _ := strconv.ParseInt(id, 10, 64)
	services.LogAction("apply_column_mapping", "lab_report", reportIDInt, gin.H{"item_count": len(parsedItems)})

	rows, err := database.DB.Query(
		`SELECT id, report_id, COALESCE(test_item_id, 0), COALESCE(test_item_name,''), original_value, COALESCE(original_unit,''), confidence, COALESCE(flag,''), COALESCE(row_notes,''), COALESCE(ocr_bbox,''), COALESCE(ref_interval_text,'') FROM report_items WHERE report_id = ? ORDER BY id`,
		id,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error("查询结果失败"))
		return
	}
	defer rows.Close()

	var items []models.ReportItem
	for rows.Next() {
		var it models.ReportItem
		var testItemID int64
		rows.Scan(&it.ID, &it.ReportID, &testItemID, &it.TestItemName, &it.OriginalValue,
			&it.OriginalUnit, &it.Confidence, &it.Flag, &it.RowNotes, &it.OCRBBox, &it.RefIntervalText)
		if testItemID > 0 {
			it.TestItemID = &testItemID
		}
		items = append(items, it)
	}
	if items == nil {
		items = []models.ReportItem{}
	}

	c.JSON(http.StatusOK, models.Success(gin.H{
		"items":      items,
		"item_count": len(items),
	}))
}

// GetHospitalMappingTemplate retrieves the saved column mapping template for a hospital.
func GetHospitalMappingTemplate(c *gin.Context) {
	hospitalID := c.Param("id")

	var colMappings string
	err := database.DB.QueryRow(
		`SELECT column_mappings FROM hospital_rules WHERE hospital_id = ? ORDER BY updated_at DESC LIMIT 1`,
		hospitalID,
	).Scan(&colMappings)
	if err != nil || colMappings == "" || colMappings == "{}" {
		c.JSON(http.StatusOK, models.Success(nil))
		return
	}

	cfg, err := services.UnmarshalColumnMappingConfig(colMappings)
	if err != nil {
		c.JSON(http.StatusOK, models.Success(nil))
		return
	}
	c.JSON(http.StatusOK, models.Success(cfg))
}

// SaveHospitalMappingTemplate saves a column mapping as a reusable hospital-level template.
func SaveHospitalMappingTemplate(c *gin.Context) {
	hospitalID := c.Param("id")

	var body struct {
		Name   string                       `json:"name"`
		Config services.ColumnMappingConfig `json:"config"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.Error("请求参数错误"))
		return
	}

	cfgJSON, err := services.MarshalColumnMappingConfig(body.Config)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error("序列化配置失败"))
		return
	}
	ruleName := body.Name
	if ruleName == "" {
		ruleName = "default"
	}

	var existingID int64
	queryErr := database.DB.QueryRow(
		`SELECT id FROM hospital_rules WHERE hospital_id = ? LIMIT 1`, hospitalID,
	).Scan(&existingID)

	if queryErr != nil {
		res, err := database.DB.Exec(
			`INSERT INTO hospital_rules (hospital_id, rule_name, column_mappings) VALUES (?, ?, ?)`,
			hospitalID, ruleName, cfgJSON,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
			return
		}
		newID, _ := res.LastInsertId()
		c.JSON(http.StatusOK, models.Success(gin.H{"id": newID}))
	} else {
		_, err := database.DB.Exec(
			`UPDATE hospital_rules SET rule_name = ?, column_mappings = ?, updated_at = datetime('now') WHERE id = ?`,
			ruleName, cfgJSON, existingID,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
			return
		}
		c.JSON(http.StatusOK, models.Success(gin.H{"id": existingID}))
	}
}
