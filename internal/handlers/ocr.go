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

	c.File(filePath)
}
