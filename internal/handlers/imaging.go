package handlers

import (
	"crypto/md5"
	"database/sql"
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

func ListImagingReportTypes(c *gin.Context) {
	rows, err := database.DB.Query(`SELECT id, code, name, name_en, description, sort_order, created_at FROM imaging_report_types ORDER BY sort_order`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	defer rows.Close()

	var types []models.ImagingReportType
	for rows.Next() {
		var t models.ImagingReportType
		if err := rows.Scan(&t.ID, &t.Code, &t.Name, &t.NameEn, &t.Description, &t.SortOrder, &t.CreatedAt); err != nil {
			continue
		}
		types = append(types, t)
	}
	if types == nil {
		types = []models.ImagingReportType{}
	}
	c.JSON(http.StatusOK, models.Success(types))
}

func UploadImagingReport(c *gin.Context) {
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, models.Error("文件上传失败: "+err.Error()))
		return
	}
	defer file.Close()

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error("读取文件失败"))
		return
	}

	hash := md5.Sum(fileBytes)
	fileMD5 := hex.EncodeToString(hash[:])

	var count int
	database.DB.QueryRow(`SELECT COUNT(*) FROM imaging_reports WHERE file_md5 = ?`, fileMD5).Scan(&count)
	if count > 0 {
		c.JSON(http.StatusConflict, models.Error("该文件已入库，禁止重复录入"))
		return
	}

	cfg, err := config.Load()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error("配置加载失败"))
		return
	}
	uploadDir := cfg.UploadDir
	os.MkdirAll(uploadDir, 0755)

	filePath := filepath.Join(uploadDir, fmt.Sprintf("%s_%s", fileMD5[:12], header.Filename))
	if err := os.WriteFile(filePath, fileBytes, 0644); err != nil {
		c.JSON(http.StatusInternalServerError, models.Error("保存文件失败"))
		return
	}

	subjectID, _ := strconv.ParseInt(c.PostForm("subject_id"), 10, 64)
	hospitalID, _ := strconv.ParseInt(c.PostForm("hospital_id"), 10, 64)
	sampleDate := c.PostForm("sample_date")
	reportType := c.PostForm("report_type")
	if reportType == "" {
		reportType = "OTHER"
	}

	var hospID interface{} = nil
	if hospitalID > 0 {
		hospID = hospitalID
	}

	result, err := database.DB.Exec(
		`INSERT INTO imaging_reports (subject_id, hospital_id, report_type, sample_date, file_path, file_md5, ocr_status) VALUES (?, ?, ?, ?, ?, ?, 'processing')`,
		subjectID, hospID, reportType, sampleDate, filePath, fileMD5,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	reportID, _ := result.LastInsertId()

	OCRWaitGroup.Add(1)
	go func() {
		defer OCRWaitGroup.Done()
		ocrResults, err := services.Recognize(fileBytes, cfg)

		apiSuccess := err == nil
		if quotaErr := services.RecordOCRCall(apiSuccess); quotaErr != nil {
			log.Printf("[imaging] record quota: %v", quotaErr)
		}

		if err != nil {
			if _, dbErr := database.DB.Exec(`UPDATE imaging_reports SET ocr_status = 'failed' WHERE id = ?`, reportID); dbErr != nil {
				log.Printf("[imaging] 更新报告状态失败: reportID=%d err=%v", reportID, dbErr)
			}
			services.LogAction("imaging_ocr_failed", "影像OCR失败", "imaging_report", reportID, gin.H{"error": err.Error()})
			return
		}

		ocrJSON, _ := json.Marshal(ocrResults)
		if _, dbErr := database.DB.Exec(`UPDATE imaging_reports SET ocr_raw_json = ? WHERE id = ?`, string(ocrJSON), reportID); dbErr != nil {
			log.Printf("[imaging] 存储OCR原始数据失败: reportID=%d err=%v", reportID, dbErr)
		}

		if len(ocrResults) == 0 {
			log.Printf("[imaging] OCR returned zero results for report %d", reportID)
			if _, dbErr := database.DB.Exec(`UPDATE imaging_reports SET ocr_status = 'failed' WHERE id = ?`, reportID); dbErr != nil {
				log.Printf("[imaging] 更新报告状态失败: reportID=%d err=%v", reportID, dbErr)
			}
			return
		}

		parsed := services.ParseImagingReport(ocrResults)

		examSite := parsed.ExamSite
		examDesc := parsed.ExamDescription
		diagnosis := parsed.DiagnosisResult
		examItemName := parsed.ExamItemName
		inspectNo := parsed.InspectNo
		sampleDate := parsed.SampleDate

		if _, dbErr := database.DB.Exec(
			`UPDATE imaging_reports SET exam_item_name=?, inspect_no=?, sample_date=COALESCE(NULLIF(?, ''), sample_date), exam_site=?, exam_description=?, diagnosis_result=?, ocr_status='review' WHERE id = ?`,
			examItemName, inspectNo, sampleDate, examSite, examDesc, diagnosis, reportID,
		); dbErr != nil {
			log.Printf("[imaging] 更新影像报告数据失败: reportID=%d err=%v", reportID, dbErr)
		}

		if _, dbErr := database.DB.Exec(`UPDATE imaging_reports SET ocr_status = 'review' WHERE id = ?`, reportID); dbErr != nil {
			log.Printf("[imaging] 更新报告状态失败: reportID=%d err=%v", reportID, dbErr)
		}

		log.Printf("[imaging] 完成: reportID=%d", reportID)
		services.LogAction("imaging_upload", "影像上传", "imaging_report", reportID, nil)
	}()

	c.JSON(http.StatusCreated, models.Success(models.ImagingUploadResponse{
		ReportID: reportID,
		FileMD5:  fileMD5,
		Status:   "processing",
	}))
}

func ListImagingExamItems(c *gin.Context) {
	rows, err := database.DB.Query(`SELECT DISTINCT exam_item_name FROM imaging_reports WHERE exam_item_name != '' ORDER BY exam_item_name`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	defer rows.Close()

	var items []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			continue
		}
		items = append(items, name)
	}
	if items == nil {
		items = []string{}
	}
	c.JSON(http.StatusOK, models.Success(items))
}

func ListImagingReports(c *gin.Context) {
	subjectID := c.Query("subject_id")
	hospitalID := c.Query("hospital_id")
	reportType := c.Query("report_type")
	examItemName := c.Query("exam_item_name")
	ocrStatus := c.Query("ocr_status")
	startDate := c.Query("start_date")
	endDate := c.Query("end_date")
	sortBy := c.Query("sort_by")
	sortOrder := c.Query("sort_order")

	query := `SELECT ir.id, ir.subject_id, ir.hospital_id, ir.report_type, ir.exam_item_name, ir.inspect_no,
		ir.sample_date, ir.exam_site, ir.exam_description, ir.diagnosis_result,
		ir.file_path, ir.file_md5, ir.ocr_status, ir.thumbnail_path, ir.created_at,
		COALESCE(h.name, '') as hospital_name,
		s.name as subject_name
		FROM imaging_reports ir
		LEFT JOIN hospitals h ON h.id = ir.hospital_id
		LEFT JOIN subjects s ON s.id = ir.subject_id`
	args := []interface{}{}
	conditions := []string{}

	if subjectID != "" {
		conditions = append(conditions, "ir.subject_id = ?")
		args = append(args, subjectID)
	}
	if hospitalID != "" {
		conditions = append(conditions, "ir.hospital_id = ?")
		args = append(args, hospitalID)
	}
	if reportType != "" {
		conditions = append(conditions, "ir.report_type = ?")
		args = append(args, reportType)
	}
	if examItemName != "" {
		conditions = append(conditions, "ir.exam_item_name = ?")
		args = append(args, examItemName)
	}
	if ocrStatus != "" {
		conditions = append(conditions, "ir.ocr_status = ?")
		args = append(args, ocrStatus)
	}
	if startDate != "" {
		conditions = append(conditions, "ir.sample_date >= ?")
		args = append(args, startDate)
	}
	if endDate != "" {
		conditions = append(conditions, "ir.sample_date <= ?")
		args = append(args, endDate)
	}

	if len(conditions) > 0 {
		query += " WHERE " + conditions[0]
		for i := 1; i < len(conditions); i++ {
			query += " AND " + conditions[i]
		}
	}

	// 排序：白名单校验，防止 SQL 注入
	allowedSort := map[string]bool{
		"sample_date": true,
		"exam_item_name": true,
		"exam_site": true,
		"ocr_status": true,
	}
	if sortBy != "" && allowedSort[sortBy] {
		if sortOrder != "asc" && sortOrder != "ASC" {
			sortOrder = "desc"
		}
		query += " ORDER BY ir." + sortBy + " " + sortOrder
	} else {
		query += " ORDER BY ir.sample_date DESC, ir.created_at DESC"
	}

	rows, err := database.DB.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	defer rows.Close()

	var reports []models.ImagingReport
	for rows.Next() {
		var r models.ImagingReport
		var hospID sql.NullInt64
		var hospName sql.NullString
		if err := rows.Scan(
			&r.ID, &r.SubjectID, &hospID, &r.ReportType, &r.ExamItemName, &r.InspectNo,
			&r.SampleDate, &r.ExamSite, &r.ExamDescription,
			&r.DiagnosisResult, &r.FilePath, &r.FileMD5, &r.OCRStatus, &r.ThumbnailPath,
			&r.CreatedAt, &hospName, &r.SubjectName,
		); err != nil {
			continue
		}
		if hospID.Valid {
			r.HospitalID = &hospID.Int64
		}
		if hospName.Valid {
			r.HospitalName = hospName.String
		}
		reports = append(reports, r)
	}
	if reports == nil {
		reports = []models.ImagingReport{}
	}
	c.JSON(http.StatusOK, models.Success(reports))
}

func GetImagingReport(c *gin.Context) {
	id := c.Param("id")

	var r models.ImagingReport
	var hospID sql.NullInt64
	var hospName sql.NullString
	err := database.DB.QueryRow(
		`SELECT ir.id, ir.subject_id, ir.hospital_id, ir.report_type, ir.exam_item_name, ir.inspect_no,
		ir.sample_date, ir.exam_site, ir.exam_description, ir.diagnosis_result,
		ir.file_path, ir.file_md5, ir.ocr_status, ir.thumbnail_path, ir.created_at, ir.updated_at,
		COALESCE(h.name, '') as hospital_name,
		s.name as subject_name
		FROM imaging_reports ir
		LEFT JOIN hospitals h ON h.id = ir.hospital_id
		LEFT JOIN subjects s ON s.id = ir.subject_id
		WHERE ir.id = ?`, id,
	).Scan(
		&r.ID, &r.SubjectID, &hospID, &r.ReportType, &r.ExamItemName, &r.InspectNo,
		&r.SampleDate, &r.ExamSite, &r.ExamDescription,
		&r.DiagnosisResult, &r.FilePath, &r.FileMD5, &r.OCRStatus, &r.ThumbnailPath,
		&r.CreatedAt, &r.UpdatedAt, &hospName, &r.SubjectName,
	)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.Error("影像报告未找到"))
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

	c.JSON(http.StatusOK, models.Success(r))
}

// GetImagingOCRBlocks returns the raw OCR block data for an imaging report.
func GetImagingOCRBlocks(c *gin.Context) {
	id := c.Param("id")

	var rawJSON string
	err := database.DB.QueryRow(`SELECT ocr_raw_json FROM imaging_reports WHERE id = ?`, id).Scan(&rawJSON)
	if err != nil {
		c.JSON(http.StatusNotFound, models.Error("报告未找到"))
		return
	}
	if rawJSON == "" {
		c.JSON(http.StatusOK, models.Success(gin.H{
			"blocks": []interface{}{},
		}))
		return
	}

	var blocks []services.OCRResult
	if err := json.Unmarshal([]byte(rawJSON), &blocks); err != nil {
		c.JSON(http.StatusInternalServerError, models.Error("解析OCR数据失败"))
		return
	}

	c.JSON(http.StatusOK, models.Success(gin.H{
		"blocks": blocks,
	}))
}

// ApplyImagingMapping applies a user-defined field mapping to an imaging report.
func ApplyImagingMapping(c *gin.Context) {
	id := c.Param("id")

	var cfg models.ImagingMappingConfig
	if err := c.ShouldBindJSON(&cfg); err != nil {
		c.JSON(http.StatusBadRequest, models.Error("请求参数错误: "+err.Error()))
		return
	}

	// 获取 OCR 原始数据
	var rawJSON string
	err := database.DB.QueryRow(`SELECT ocr_raw_json FROM imaging_reports WHERE id = ?`, id).Scan(&rawJSON)
	if err != nil {
		c.JSON(http.StatusNotFound, models.Error("报告未找到"))
		return
	}
	if rawJSON == "" {
		c.JSON(http.StatusBadRequest, models.Error("报告暂无OCR数据"))
		return
	}

	// 解析 OCR 块
	var blocks []services.OCRResult
	if err := json.Unmarshal([]byte(rawJSON), &blocks); err != nil {
		c.JSON(http.StatusInternalServerError, models.Error("解析OCR数据失败"))
		return
	}

	// 应用映射配置
	parsed := services.ParseImagingReportWithMapping(blocks, cfg)

	// 更新报告字段
	cfgJSON, _ := json.Marshal(cfg)
	_, err = database.DB.Exec(
		`UPDATE imaging_reports SET 
            exam_item_name = ?, inspect_no = ?, sample_date = COALESCE(NULLIF(?, ''), sample_date),
            exam_site = ?, exam_description = ?, diagnosis_result = ?,
            mapping_config_json = ?, ocr_status = 'review'
        WHERE id = ?`,
		parsed.ExamItemName, parsed.InspectNo, parsed.SampleDate,
		parsed.ExamSite, parsed.ExamDescription, parsed.DiagnosisResult,
		string(cfgJSON),
		id,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error("更新报告失败"))
		return
	}

	// 返回解析结果
	c.JSON(http.StatusOK, models.Success(parsed))
}

// GetImagingMappingTemplate returns the imaging mapping template for a hospital.
func GetImagingMappingTemplate(c *gin.Context) {
	hospitalID := c.Param("id")

	var cfgJSON string
	err := database.DB.QueryRow(
		`SELECT column_mappings FROM hospital_rules WHERE hospital_id = ? AND rule_type = 'imaging_mapping' ORDER BY updated_at DESC LIMIT 1`,
		hospitalID,
	).Scan(&cfgJSON)
	if err != nil || cfgJSON == "" || cfgJSON == "{}" {
		c.JSON(http.StatusOK, models.Success(nil))
		return
	}

	var cfg models.ImagingMappingConfig
	if err := json.Unmarshal([]byte(cfgJSON), &cfg); err != nil {
		c.JSON(http.StatusOK, models.Success(nil))
		return
	}
	c.JSON(http.StatusOK, models.Success(cfg))
}

// SaveImagingMappingTemplate saves an imaging mapping as a reusable hospital-level template.
func SaveImagingMappingTemplate(c *gin.Context) {
	hospitalID := c.Param("id")

	var body struct {
		Name   string                      `json:"name"`
		Config models.ImagingMappingConfig `json:"config"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.Error("请求参数错误"))
		return
	}

	cfgJSON, err := json.Marshal(body.Config)
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
		`SELECT id FROM hospital_rules WHERE hospital_id = ? AND rule_type = 'imaging_mapping' LIMIT 1`, hospitalID,
	).Scan(&existingID)

	if queryErr != nil {
		res, err := database.DB.Exec(
			`INSERT INTO hospital_rules (hospital_id, rule_name, rule_type, column_mappings) VALUES (?, ?, 'imaging_mapping', ?)`,
			hospitalID, ruleName, string(cfgJSON),
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
			ruleName, string(cfgJSON), existingID,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
			return
		}
		c.JSON(http.StatusOK, models.Success(gin.H{"id": existingID}))
	}
}

func UpdateImagingReport(c *gin.Context) {
	id := c.Param("id")

	var req struct {
		ExamItemName    string  `json:"exam_item_name"`
		InspectNo       string  `json:"inspect_no"`
		ExamSite        string  `json:"exam_site"`
		ExamDescription string  `json:"exam_description"`
		DiagnosisResult string  `json:"diagnosis_result"`
		ReportType      string  `json:"report_type"`
		HospitalID      *int64  `json:"hospital_id"`
		SampleDate      string  `json:"sample_date"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.Error(err.Error()))
		return
	}

	hospID := req.HospitalID
	if hospID != nil && *hospID == 0 {
		hospID = nil
	}

	_, err := database.DB.Exec(
		`UPDATE imaging_reports SET 
		exam_item_name=?, inspect_no=?,
		exam_site=?, exam_description=?, diagnosis_result=?,
		report_type=COALESCE(NULLIF(?, ''), report_type),
		hospital_id=?, sample_date=?,
		updated_at=datetime('now')
		WHERE id=?`,
		req.ExamItemName, req.InspectNo,
		req.ExamSite, req.ExamDescription, req.DiagnosisResult,
		req.ReportType, hospID, req.SampleDate, id,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.Success(nil))
}

func DeleteImagingReport(c *gin.Context) {
	id := c.Param("id")

	var filePath string
	database.DB.QueryRow(`SELECT file_path FROM imaging_reports WHERE id = ?`, id).Scan(&filePath)

	_, err := database.DB.Exec(`DELETE FROM imaging_reports WHERE id = ?`, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}

	if filePath != "" {
		os.Remove(filePath)
	}

	c.JSON(http.StatusOK, models.Success(nil))
}

func GetImagingReportImage(c *gin.Context) {
	id := c.Param("id")

	var filePath string
	err := database.DB.QueryRow(`SELECT file_path FROM imaging_reports WHERE id = ?`, id).Scan(&filePath)
	if err != nil {
		c.JSON(http.StatusNotFound, models.Error("影像报告未找到"))
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

func ConfirmImagingReport(c *gin.Context) {
	id := c.Param("id")

	_, err := database.DB.Exec(`UPDATE imaging_reports SET ocr_status = 'imported', updated_at = datetime('now') WHERE id = ?`, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}

	reportID, _ := strconv.ParseInt(id, 10, 64)
	services.LogAction("imaging_confirm", "确认影像报告", "imaging_report", reportID, nil)

	c.JSON(http.StatusOK, models.Success(nil))
}

func ImportImagingReport(c *gin.Context) {
	id := c.Param("id")

	_, err := database.DB.Exec(`UPDATE imaging_reports SET ocr_status = 'imported', updated_at = datetime('now') WHERE id = ?`, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}

	reportID, _ := strconv.ParseInt(id, 10, 64)
	services.LogAction("imaging_import", "导入影像报告", "imaging_report", reportID, nil)

	c.JSON(http.StatusOK, models.Success(gin.H{"status": "imported"}))
}

func ReOCRImagingReport(c *gin.Context) {
	id := c.Param("id")

	var filePath string
	err := database.DB.QueryRow(`SELECT file_path FROM imaging_reports WHERE id = ?`, id).Scan(&filePath)
	if err != nil {
		c.JSON(http.StatusNotFound, models.Error("影像报告未找到"))
		return
	}

	if _, err := database.DB.Exec(`UPDATE imaging_reports SET ocr_status = 'processing' WHERE id = ?`, id); err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}

	OCRWaitGroup.Add(1)
	go func() {
		defer OCRWaitGroup.Done()
		fileBytes, err := os.ReadFile(filePath)
		if err != nil {
			log.Printf("[imaging] 读取文件失败: %v", err)
			database.DB.Exec(`UPDATE imaging_reports SET ocr_status = 'failed' WHERE id = ?`, id)
			return
		}

		cfg, err := config.Load()
		if err != nil {
			log.Printf("[imaging] 配置加载失败: %v", err)
			database.DB.Exec(`UPDATE imaging_reports SET ocr_status = 'failed' WHERE id = ?`, id)
			return
		}
		ocrResults, err := services.Recognize(fileBytes, cfg)

		apiSuccess := err == nil
		if quotaErr := services.RecordOCRCall(apiSuccess); quotaErr != nil {
			log.Printf("[imaging] record quota: %v", quotaErr)
		}

		if err != nil {
			database.DB.Exec(`UPDATE imaging_reports SET ocr_status = 'failed' WHERE id = ?`, id)
			return
		}

		ocrJSON, _ := json.Marshal(ocrResults)
		database.DB.Exec(`UPDATE imaging_reports SET ocr_raw_json = ? WHERE id = ?`, string(ocrJSON), id)

		if len(ocrResults) == 0 {
			database.DB.Exec(`UPDATE imaging_reports SET ocr_status = 'failed' WHERE id = ?`, id)
			return
		}

		parsed := services.ParseImagingReport(ocrResults)

		database.DB.Exec(
			`UPDATE imaging_reports SET exam_item_name=?, inspect_no=?, exam_site=?, exam_description=?, diagnosis_result=?, ocr_status='review' WHERE id = ?`,
			parsed.ExamItemName, parsed.InspectNo, parsed.ExamSite, parsed.ExamDescription, parsed.DiagnosisResult, id,
		)

		log.Printf("[imaging] ReOCR完成: reportID=%s", id)
	}()

	c.JSON(http.StatusOK, models.Success(gin.H{"status": "processing"}))
}
