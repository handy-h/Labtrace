package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"

	"labtrace/internal/config"
	"labtrace/internal/database"
	"labtrace/internal/models"
	"labtrace/internal/services"

	"github.com/gin-gonic/gin"
)

// ReOCR re-processes an existing report through OCR again.
func ReOCR(c *gin.Context) {
	id := c.Param("id")

	// Load report
	var filePath, ocrStatus string
	err := database.DB.QueryRow(`SELECT file_path, ocr_status FROM lab_reports WHERE id = ?`, id).Scan(&filePath, &ocrStatus)
	if err != nil {
		c.JSON(http.StatusNotFound, models.Error("报告未找到"))
		return
	}

	// Read file from disk
	fileBytes, err := os.ReadFile(filePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error("读取原始文件失败: "+err.Error()))
		return
	}

	// Update status to processing
	database.DB.Exec(`UPDATE lab_reports SET ocr_status = 'processing' WHERE id = ?`, id)

	// Run OCR
	cfg, err := config.Load()
	if err != nil {
		database.DB.Exec(`UPDATE lab_reports SET ocr_status = 'failed' WHERE id = ?`, id)
		c.JSON(http.StatusInternalServerError, models.Error("配置加载失败"))
		return
	}
	ocrResults, err := services.Recognize(fileBytes, cfg)

	// Record API call in quota (count regardless of Recognize result)
	apiSuccess := err == nil
	if quotaErr := services.RecordOCRCall(apiSuccess); quotaErr != nil {
		log.Printf("[reocr] record quota: %v", quotaErr)
	}

	if err != nil {
		database.DB.Exec(`UPDATE lab_reports SET ocr_status = 'failed' WHERE id = ?`, id)
		c.JSON(http.StatusBadGateway, models.Error("OCR识别失败: "+err.Error()))
		return
	}

	// Store raw OCR JSON
	ocrJSON, _ := json.Marshal(ocrResults)
	database.DB.Exec(`UPDATE lab_reports SET ocr_raw_json = ? WHERE id = ?`, string(ocrJSON), id)

	// Check if OCR returned any data
	if len(ocrResults) == 0 {
		log.Printf("[reocr] OCR returned zero results for report %s", id)
		database.DB.Exec(`UPDATE lab_reports SET ocr_status = 'failed' WHERE id = ?`, id)
		c.JSON(http.StatusBadGateway, models.Error("OCR未识别到任何文字内容"))
		return
	}

	// Parse and insert new items
	parsedItems := services.ParseLabResults(ocrResults)

	// Only delete old items AFTER we confirm we have new data to insert
	database.DB.Exec(`DELETE FROM report_items WHERE report_id = ?`, id)

	// Insert new items
	insertCount := 0
	if len(parsedItems) > 0 {
		for _, item := range parsedItems {
			normalizedValue := services.NormalizeQualitative(item.Value)
			database.DB.Exec(
				`INSERT INTO report_items (report_id, test_item_name, original_value, original_unit, confidence, ocr_bbox, ref_interval_text, row_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				id, item.Name, normalizedValue, item.Unit, item.Confidence, item.BBox, item.Range, item.Range,
			)
			insertCount++
		}
	} else {
		// Fallback: raw blocks
		for _, r := range ocrResults {
			normalizedValue := services.NormalizeQualitative(r.Text)
			database.DB.Exec(
				`INSERT INTO report_items (report_id, original_value, confidence, ocr_bbox) VALUES (?, ?, ?, ?)`,
				id, normalizedValue, int(r.Confidence), fmt.Sprintf(`{"x":%d,"y":%d,"w":%d,"h":%d}`, r.Left, r.Top, r.Width, r.Height),
			)
			insertCount++
		}
	}

	log.Printf("[reocr] report %s: inserted %d items (parsed=%d, raw=%d)", id, insertCount, len(parsedItems), len(ocrResults))

	database.DB.Exec(`UPDATE lab_reports SET ocr_status = 'review' WHERE id = ?`, id)

	// Audit log
	services.LogAction("re_ocr", "重新识别", "lab_report", parseInt64(id), nil)

	c.JSON(http.StatusOK, models.Success(gin.H{
		"status": "review",
	}))
}

// GetOCRQuota returns the current month's OCR usage statistics.
func GetOCRQuota(c *gin.Context) {
	quota, err := services.GetOCRQuota()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	c.JSON(http.StatusOK, models.Success(quota))
}

// UpdateOCRQuota allows manual calibration of the monthly OCR usage count.
func UpdateOCRQuota(c *gin.Context) {
	var req struct {
		YearMonth string `json:"year_month"`
		UsedCount int    `json:"used_count"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.Error(err.Error()))
		return
	}

	err := services.UpdateOCRQuota(req.YearMonth, req.UsedCount)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	c.JSON(http.StatusOK, models.Success(nil))
}

// parseInt64 converts a string to int64 (for audit log entity_id).
func parseInt64(s string) int64 {
	n, _ := strconv.ParseInt(s, 10, 64)
	return n
}
