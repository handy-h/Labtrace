package handlers

import (
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"labtrace/internal/config"
	"labtrace/internal/database"
	"labtrace/internal/models"
	"labtrace/internal/services"

	"github.com/gin-gonic/gin"
)

type BatchItemData struct {
	Name  string `json:"name"`
	Value string `json:"value"`
	Unit  string `json:"unit"`
	Range string `json:"range"`
}

type BatchReportData struct {
	SampleDate string          `json:"sample_date"`
	Items      []BatchItemData `json:"items"`
}

type BatchImportResult struct {
	SuccessCount int     `json:"success_count"`
	FailCount    int     `json:"fail_count"`
	Errors       []string `json:"errors,omitempty"`
	ReportIDs    []int64 `json:"report_ids,omitempty"`
}

func UploadBatchFiles(c *gin.Context) {
	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(http.StatusBadRequest, models.Error("解析表单失败: "+err.Error()))
		return
	}

	jsonFiles := form.File["json_files"]
	pdfFiles := form.File["pdf_files"]

	if jsonFiles == nil || len(jsonFiles) == 0 {
		c.JSON(http.StatusBadRequest, models.Error("请上传至少一个JSON文件"))
		return
	}
	if pdfFiles == nil || len(pdfFiles) == 0 {
		c.JSON(http.StatusBadRequest, models.Error("请上传至少一个PDF文件"))
		return
	}

	type filePair struct {
		jsonFile *multipart.FileHeader
		pdfFile *multipart.FileHeader
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

	results := make([]map[string]interface{}, 0)
	uploadErrors := make([]string, 0)
	
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
		
		var reportData BatchReportData
		if err := json.Unmarshal(data, &reportData); err != nil {
			uploadErrors = append(uploadErrors, fmt.Sprintf("解析 %s.json 失败: %v", baseName, err))
			continue
		}
		
		results = append(results, map[string]interface{}{
			"name": baseName,
			"data": reportData,
		})
	}
	
	c.JSON(http.StatusOK, models.Success(gin.H{
		"results": results,
		"errors":  uploadErrors,
	}))
}

func ConfirmBatchImport(c *gin.Context) {
	var req struct {
		SubjectID   int64                  `json:"subject_id"`
		HospitalID  *int64                 `json:"hospital_id"`
		CategoryID  *int64                 `json:"category_id"`
		Reports     []map[string]interface{}`json:"reports"`
	}
	
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.Error("请求参数错误: "+err.Error()))
		return
	}
	
	if req.SubjectID == 0 {
		c.JSON(http.StatusBadRequest, models.Error("请选择受检者"))
		return
	}
	
	cfg, _ := config.Load()
	
	uploadDir := cfg.UploadDir
	os.MkdirAll(uploadDir, 0755)
	
	result := &BatchImportResult{
		SuccessCount: 0,
		FailCount:    0,
		Errors:       make([]string, 0),
		ReportIDs:    make([]int64, 0),
	}
	
	for _, report := range req.Reports {
		name, _ := report["name"].(string)
		data, _ := report["data"].(map[string]interface{})
		pdfData, _ := report["pdf_data"].(string)
		
		if pdfData == "" {
			result.FailCount++
			result.Errors = append(result.Errors, fmt.Sprintf("%s: 缺少PDF数据", name))
			continue
		}
		
		decodedPDF, err := base64Decode(pdfData)
		if err != nil {
			result.FailCount++
			result.Errors = append(result.Errors, fmt.Sprintf("%s: 解码PDF失败", name))
			continue
		}
		
		hash := md5.Sum(decodedPDF)
		fileMD5 := hex.EncodeToString(hash[:])
		
		var count int
		database.DB.QueryRow(`SELECT COUNT(*) FROM lab_reports WHERE file_md5 = ?`, fileMD5).Scan(&count)
		if count > 0 {
			result.FailCount++
			result.Errors = append(result.Errors, fmt.Sprintf("%s: 文件已存在", name))
			continue
		}
		
		filePath := filepath.Join(uploadDir, fmt.Sprintf("%s_%s.pdf", fileMD5[:12], name))
		if err := os.WriteFile(filePath, decodedPDF, 0644); err != nil {
			result.FailCount++
			result.Errors = append(result.Errors, fmt.Sprintf("%s: 保存PDF失败", name))
			continue
		}
		
		var sampleDate string
		if d, ok := data["sample_date"].(string); ok {
			sampleDate = d
		}
		
		var hospID interface{}
		if req.HospitalID != nil && *req.HospitalID > 0 {
			hospID = req.HospitalID
		}
		
		var catID interface{}
		if req.CategoryID != nil && *req.CategoryID > 0 {
			catID = req.CategoryID
		}
		
		res, err := database.DB.Exec(
			`INSERT INTO lab_reports (subject_id, hospital_id, sample_date, category_id, file_path, file_md5, ocr_status) VALUES (?, ?, ?, ?, ?, ?, 'review')`,
			req.SubjectID, hospID, sampleDate, catID, filePath, fileMD5,
		)
		if err != nil {
			result.FailCount++
			result.Errors = append(result.Errors, fmt.Sprintf("%s: 保存报告失败", name))
			os.Remove(filePath)
			continue
		}
		
		reportID, _ := res.LastInsertId()
		
		var items []BatchItemData
		if itemsData, ok := data["items"].([]interface{}); ok {
			for _, item := range itemsData {
				if itemMap, ok := item.(map[string]interface{}); ok {
					items = append(items, BatchItemData{
						Name:  getString(itemMap, "name"),
						Value: getString(itemMap, "value"),
						Unit:  getString(itemMap, "unit"),
						Range: getString(itemMap, "range"),
					})
				}
			}
		}
		
		for _, item := range items {
			database.DB.Exec(
				`INSERT INTO report_items (report_id, test_item_name, original_value, original_unit, confidence, ref_interval_text) VALUES (?, ?, ?, ?, ?, ?)`,
				reportID, item.Name, item.Value, item.Unit, 100, item.Range,
			)
		}
		
		result.SuccessCount++
		result.ReportIDs = append(result.ReportIDs, reportID)
		
		services.LogAction("batch_import_report", "批量导入报告", "lab_report", reportID, nil)
	}
	
	c.JSON(http.StatusOK, models.Success(result))
}

func getBaseName(filename string) string {
	name := filepath.Base(filename)
	ext := filepath.Ext(name)
	return strings.TrimSuffix(name, ext)
}

func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func base64Decode(s string) ([]byte, error) {
	if idx := strings.Index(s, ","); idx != -1 {
		s = s[idx+1:]
	}
	return base64.StdEncoding.DecodeString(s)
}
