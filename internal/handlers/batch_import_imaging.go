package handlers

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"

	"labtrace/internal/config"
	"labtrace/internal/database"
	"labtrace/internal/models"
	"labtrace/internal/services"

	"github.com/gin-gonic/gin"
)

type ImagingBatchMappingConfig struct {
	SubjectID       int64  `json:"subject_id"`
	HospitalID      *int64 `json:"hospital_id"`
	ReportType      string `json:"report_type"`
	SampleDate      string `json:"sample_date"`
	ExamItemName    string `json:"exam_item_name"`
	ExamSite        string `json:"exam_site"`
	ExamDescription string `json:"exam_description"`
	DiagnosisResult string `json:"diagnosis_result"`
	InspectNo       string `json:"inspect_no"`
}

type ImagingBatchUploadResponse struct {
	FileName string                 `json:"file_name"`
	Data     map[string]interface{} `json:"data"`
}

func UploadBatchImagingFiles(c *gin.Context) {
	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(http.StatusBadRequest, models.Error("解析表单失败: "+err.Error()))
		return
	}

	jsonFiles := form.File["json_files"]
	pdfFiles := form.File["pdf_files"]

	if jsonFiles == nil || len(jsonFiles) == 0 {
		c.JSON(http.StatusBadRequest, models.Error("请上传JSON文件"))
		return
	}
	if pdfFiles == nil || len(pdfFiles) == 0 {
		c.JSON(http.StatusBadRequest, models.Error("请上传PDF文件"))
		return
	}

	type filePair struct {
		jsonFile *multipart.FileHeader
		pdfFile  *multipart.FileHeader
	}
	pairs := make(map[string]*filePair)

	for _, f := range jsonFiles {
		baseName := getBaseName(f.Filename)
		if pairs[baseName] == nil {
			pairs[baseName] = &filePair{}
		}
		pairs[baseName].jsonFile = f
	}

	for _, f := range pdfFiles {
		baseName := getBaseName(f.Filename)
		if pairs[baseName] == nil {
			pairs[baseName] = &filePair{}
		}
		pairs[baseName].pdfFile = f
	}

	results := []ImagingBatchUploadResponse{}
	uploadErrors := []string{}

	for baseName, pair := range pairs {
		if pair.jsonFile == nil {
			uploadErrors = append(uploadErrors, fmt.Sprintf("文件 %s 缺少对应的JSON文件", baseName))
			continue
		}
		if pair.pdfFile == nil {
			uploadErrors = append(uploadErrors, fmt.Sprintf("文件 %s 缺少对应的PDF文件", baseName))
			continue
		}

		f, err := pair.jsonFile.Open()
		if err != nil {
			uploadErrors = append(uploadErrors, fmt.Sprintf("无法打开 %s.json: %v", baseName, err))
			continue
		}
		defer f.Close()

		data, err := io.ReadAll(f)
		if err != nil {
			uploadErrors = append(uploadErrors, fmt.Sprintf("读取 %s.json 失败: %v", baseName, err))
			continue
		}

		var jsonData map[string]interface{}
		if err := json.Unmarshal(data, &jsonData); err != nil {
			uploadErrors = append(uploadErrors, fmt.Sprintf("解析 %s.json 失败: %v", baseName, err))
			continue
		}

		results = append(results, ImagingBatchUploadResponse{
			FileName: baseName,
			Data:     jsonData,
		})
	}

	c.JSON(http.StatusOK, models.Success(gin.H{
		"results": results,
		"errors":  uploadErrors,
	}))
}

func ConfirmBatchImagingImport(c *gin.Context) {
	var req struct {
		SubjectID  int64                     `json:"subject_id"`
		HospitalID *int64                    `json:"hospital_id"`
		ReportType string                    `json:"report_type"`
		Mappings   ImagingBatchMappingConfig `json:"mappings"`
		Reports    []struct {
			FileName   string                 `json:"file_name"`
			Data       map[string]interface{} `json:"data"`
			PDFData    string                 `json:"pdf_data"`
			SampleDate string                 `json:"sample_date"`
		} `json:"reports"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.Error("请求参数错误: "+err.Error()))
		return
	}

	if req.SubjectID == 0 {
		c.JSON(http.StatusBadRequest, models.Error("请选择受检者"))
		return
	}
	if req.ReportType == "" {
		req.ReportType = "OTHER"
	}

	if len(req.Reports) == 0 {
		c.JSON(http.StatusBadRequest, models.Error("没有可导入的报告"))
		return
	}

	cfg, _ := config.Load()
	uploadDir := cfg.UploadDir
	os.MkdirAll(uploadDir, 0755)

	type ImportResult struct {
		SuccessCount int      `json:"success_count"`
		FailCount    int      `json:"fail_count"`
		Errors       []string `json:"errors"`
		ReportIDs    []int64  `json:"report_ids"`
	}
	result := &ImportResult{Errors: []string{}}

	for _, report := range req.Reports {
		if report.PDFData == "" {
			result.FailCount++
			result.Errors = append(result.Errors, fmt.Sprintf("%s: 缺少PDF数据", report.FileName))
			continue
		}

		decodedPDF, err := base64Decode(report.PDFData)
		if err != nil {
			result.FailCount++
			result.Errors = append(result.Errors, fmt.Sprintf("%s: 解码PDF失败", report.FileName))
			continue
		}

		hash := md5.Sum(decodedPDF)
		fileMD5 := hex.EncodeToString(hash[:])

		var count int
		database.DB.QueryRow(`SELECT COUNT(*) FROM imaging_reports WHERE file_md5 = ?`, fileMD5).Scan(&count)
		if count > 0 {
			result.FailCount++
			result.Errors = append(result.Errors, fmt.Sprintf("%s: 文件已存在", report.FileName))
			continue
		}

		filePath := filepath.Join(uploadDir, fmt.Sprintf("img_%s_%s.pdf", fileMD5[:12], report.FileName))
		if err := os.WriteFile(filePath, decodedPDF, 0644); err != nil {
			result.FailCount++
			result.Errors = append(result.Errors, fmt.Sprintf("%s: 保存PDF失败", report.FileName))
			continue
		}

		sampleDate := report.SampleDate
		if sampleDate == "" {
			sampleDate = getNestedValue(report.Data, req.Mappings.SampleDate)
		}
		if sampleDate == "" {
			result.FailCount++
			result.Errors = append(result.Errors, fmt.Sprintf("%s: 缺少采样日期", report.FileName))
			os.Remove(filePath)
			continue
		}

		var hospID interface{}
		if req.HospitalID != nil && *req.HospitalID > 0 {
			hospID = *req.HospitalID
		}

		examItemName := getNestedValue(report.Data, req.Mappings.ExamItemName)
		examSite := getNestedValue(report.Data, req.Mappings.ExamSite)
		examDescription := getNestedValue(report.Data, req.Mappings.ExamDescription)
		diagnosisResult := getNestedValue(report.Data, req.Mappings.DiagnosisResult)
		inspectNo := getNestedValue(report.Data, req.Mappings.InspectNo)

		res, err := database.DB.Exec(
			`INSERT INTO imaging_reports (subject_id, hospital_id, report_type, exam_item_name, inspect_no, sample_date, exam_site, exam_description, diagnosis_result, file_path, file_md5, ocr_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'imported')`,
			req.SubjectID, hospID, req.ReportType, examItemName, inspectNo, sampleDate, examSite, examDescription, diagnosisResult, filePath, fileMD5,
		)
		if err != nil {
			result.FailCount++
			result.Errors = append(result.Errors, fmt.Sprintf("%s: 保存报告失败: %v", report.FileName, err))
			os.Remove(filePath)
			continue
		}

		reportID, _ := res.LastInsertId()
		result.SuccessCount++
		result.ReportIDs = append(result.ReportIDs, reportID)

		services.LogAction("batch_import_imaging", "批量导入影像报告", "imaging_report", reportID, nil)
	}

	c.JSON(http.StatusOK, models.Success(result))
}
