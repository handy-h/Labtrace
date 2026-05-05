package handlers

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
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
		if err != nil {
			database.DB.Exec(`UPDATE lab_reports SET ocr_status = 'failed' WHERE id = ?`, reportID)
			return
		}

		// Store raw OCR JSON
		ocrJSON, _ := json.Marshal(ocrResults)
		database.DB.Exec(`UPDATE lab_reports SET ocr_raw_json = ?, ocr_status = 'review' WHERE id = ?`, string(ocrJSON), reportID)

		// Create report_items from OCR results
		for _, r := range ocrResults {
			normalizedValue := r.Text
			// Apply data dictionary mapping
			normalizedValue = services.NormalizeQualitative(normalizedValue)

			database.DB.Exec(
				`INSERT INTO report_items (report_id, original_value, original_unit, confidence, ocr_bbox) VALUES (?, ?, '', ?, ?)`,
				reportID, normalizedValue, int(r.Confidence), fmt.Sprintf(`{"x":%d,"y":%d,"w":%d,"h":%d}`, r.Left, r.Top, r.Width, r.Height),
			)
		}

		// Try to apply hospital rule if hospital_id is set
		if hospitalID > 0 {
			items, err := services.ApplyRule(hospitalID, ocrResults)
			if err == nil && len(items) > 0 {
				// Update report_items with rule-mapped data
				for _, item := range items {
					database.DB.Exec(
						`UPDATE report_items SET test_item_name = ?, original_value = ?, original_unit = ?, row_notes = ? WHERE report_id = ? AND original_value = ?`,
						item.TestItemName, item.OriginalValue, item.OriginalUnit, item.RowNotes, reportID, item.OriginalValue,
					)
				}
			}
		}
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
