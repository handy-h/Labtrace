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

	cfg, _ := config.Load()
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

	go func() {
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
		deptName := parsed.DeptName
		doctorName := parsed.DoctorName

		if _, dbErr := database.DB.Exec(
			`UPDATE imaging_reports SET exam_item_name=?, inspect_no=?, dept_name=?, doctor_name=?, exam_site=?, exam_description=?, diagnosis_result=?, ocr_status='review' WHERE id = ?`,
			examItemName, inspectNo, deptName, doctorName, examSite, examDesc, diagnosis, reportID,
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

func ListImagingReports(c *gin.Context) {
	subjectID := c.Query("subject_id")
	hospitalID := c.Query("hospital_id")
	reportType := c.Query("report_type")

	query := `SELECT ir.id, ir.subject_id, ir.hospital_id, ir.report_type, ir.exam_item_name, ir.inspect_no, 
		ir.dept_name, ir.doctor_name, ir.sample_date, ir.exam_site, ir.exam_description, ir.diagnosis_result,
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

	if len(conditions) > 0 {
		query += " WHERE " + conditions[0]
		for i := 1; i < len(conditions); i++ {
			query += " AND " + conditions[i]
		}
	}
	query += " ORDER BY ir.sample_date DESC, ir.created_at DESC"

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
			&r.DeptName, &r.DoctorName, &r.SampleDate, &r.ExamSite, &r.ExamDescription,
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
		ir.dept_name, ir.doctor_name, ir.sample_date, ir.exam_site, ir.exam_description, ir.diagnosis_result,
		ir.file_path, ir.file_md5, ir.ocr_status, ir.thumbnail_path, ir.created_at, ir.updated_at,
		COALESCE(h.name, '') as hospital_name,
		s.name as subject_name
		FROM imaging_reports ir
		LEFT JOIN hospitals h ON h.id = ir.hospital_id
		LEFT JOIN subjects s ON s.id = ir.subject_id
		WHERE ir.id = ?`, id,
	).Scan(
		&r.ID, &r.SubjectID, &hospID, &r.ReportType, &r.ExamItemName, &r.InspectNo,
		&r.DeptName, &r.DoctorName, &r.SampleDate, &r.ExamSite, &r.ExamDescription,
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

func UpdateImagingReport(c *gin.Context) {
	id := c.Param("id")

	var req struct {
		ExamItemName    string  `json:"exam_item_name"`
		InspectNo       string  `json:"inspect_no"`
		DeptName        string  `json:"dept_name"`
		DoctorName      string  `json:"doctor_name"`
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
		exam_item_name=?, inspect_no=?, dept_name=?, doctor_name=?,
		exam_site=?, exam_description=?, diagnosis_result=?,
		report_type=COALESCE(NULLIF(?, ''), report_type),
		hospital_id=?, sample_date=?,
		updated_at=datetime('now')
		WHERE id=?`,
		req.ExamItemName, req.InspectNo, req.DeptName, req.DoctorName,
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

	go func() {
		fileBytes, err := os.ReadFile(filePath)
		if err != nil {
			log.Printf("[imaging] 读取文件失败: %v", err)
			database.DB.Exec(`UPDATE imaging_reports SET ocr_status = 'failed' WHERE id = ?`, id)
			return
		}

		cfg, _ := config.Load()
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
			`UPDATE imaging_reports SET exam_item_name=?, inspect_no=?, dept_name=?, doctor_name=?, exam_site=?, exam_description=?, diagnosis_result=?, ocr_status='review' WHERE id = ?`,
			parsed.ExamItemName, parsed.InspectNo, parsed.DeptName, parsed.DoctorName, parsed.ExamSite, parsed.ExamDescription, parsed.DiagnosisResult, id,
		)

		log.Printf("[imaging] ReOCR完成: reportID=%s", id)
	}()

	c.JSON(http.StatusOK, models.Success(gin.H{"status": "processing"}))
}
