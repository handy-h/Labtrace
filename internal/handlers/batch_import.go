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
	"sort"
	"strconv"
	"strings"

	"labtrace/internal/config"
	"labtrace/internal/database"
	"labtrace/internal/models"
	"labtrace/internal/services"

	"github.com/gin-gonic/gin"
)

type BatchMappingConfig struct {
	SubjectID    int64  `json:"subject_id"`
	HospitalID   *int64 `json:"hospital_id"`
	SampleDate   string `json:"sample_date"`
	ItemsPath    string `json:"items_path"`
	ItemName     string `json:"item_name"`
	ItemValue    string `json:"item_value"`
	ItemUnit     string `json:"item_unit"`
	ItemCategory string `json:"item_category"`
	RefRange     string `json:"ref_range"`
	RefMin       string `json:"ref_min"`
	RefMax       string `json:"ref_max"`
}

type BatchUploadResponse struct {
	FileName string                 `json:"file_name"`
	Data    map[string]interface{} `json:"data"`
	Items   []interface{}         `json:"items"`
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

	results := []BatchUploadResponse{}
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

		items := extractItemsFromJSON(jsonData, "") // auto-detect during upload phase
		results = append(results, BatchUploadResponse{
			FileName: baseName,
			Data:    jsonData,
			Items:    items,
		})
	}

	c.JSON(http.StatusOK, models.Success(gin.H{
		"results": results,
		"errors":  uploadErrors,
	}))
}

func extractItemsFromJSON(data map[string]interface{}, itemsPath string) []interface{} {
	if itemsPath != "" {
		raw := getNestedRaw(data, itemsPath)
		if arr, ok := raw.([]interface{}); ok {
			return arr
		}
	}
	// Auto-detect: find first array of objects among top-level values
	for _, v := range data {
		if arr, ok := v.([]interface{}); ok && len(arr) > 0 {
			if _, isObj := arr[0].(map[string]interface{}); isObj {
				return arr
			}
		}
	}
	return []interface{}{data}
}

func ConfirmBatchImport(c *gin.Context) {
	var req struct {
		SubjectID  int64              `json:"subject_id"`
		HospitalID *int64             `json:"hospital_id"`
		Mappings   BatchMappingConfig `json:"mappings"`
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

	if len(req.Reports) == 0 {
		c.JSON(http.StatusBadRequest, models.Error("没有可导入的报告"))
		return
	}

	cfg, err := config.Load()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error("配置加载失败"))
		return
	}
	uploadDir := cfg.UploadDir
	os.MkdirAll(uploadDir, 0755)

	type ImportResult struct {
		SuccessCount int        `json:"success_count"`
		FailCount    int        `json:"fail_count"`
		Errors       []string   `json:"errors"`
		ReportIDs    []int64     `json:"report_ids"`
	}
	result := &ImportResult{Errors: []string{}}

	// 一次性加载 test_items 索引，避免循环内重复查库
	itemIdx := services.LoadTestItemIndex()

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
		database.DB.QueryRow(`SELECT COUNT(*) FROM lab_reports WHERE file_md5 = ?`, fileMD5).Scan(&count)
		if count > 0 {
			result.FailCount++
			result.Errors = append(result.Errors, fmt.Sprintf("%s: 文件已存在", report.FileName))
			continue
		}

		filePath := filepath.Join(uploadDir, fmt.Sprintf("%s_%s.pdf", fileMD5[:12], report.FileName))
		if err := os.WriteFile(filePath, decodedPDF, 0644); err != nil {
			result.FailCount++
			result.Errors = append(result.Errors, fmt.Sprintf("%s: 保存PDF失败", report.FileName))
			continue
		}

		sampleDate := report.SampleDate
		if sampleDate == "" {
			sampleDate = getNestedValue(report.Data, req.Mappings.SampleDate)
		}
		var hospID interface{}
		if req.HospitalID != nil && *req.HospitalID > 0 {
			hospID = *req.HospitalID
		}

		res, err := database.DB.Exec(
			`INSERT INTO lab_reports (subject_id, hospital_id, sample_date, file_path, file_md5, ocr_status) VALUES (?, ?, ?, ?, ?, 'review')`,
			req.SubjectID, hospID, sampleDate, filePath, fileMD5,
		)
		if err != nil {
			result.FailCount++
			result.Errors = append(result.Errors, fmt.Sprintf("%s: 保存报告失败", report.FileName))
			os.Remove(filePath)
			continue
		}

		reportID, _ := res.LastInsertId()
		items := extractItemsFromJSON(report.Data, req.Mappings.ItemsPath)

		// 开启事务：包含所有 report_items INSERT
		tx, txErr := database.DB.Begin()
		if txErr != nil {
			result.FailCount++
			result.Errors = append(result.Errors, fmt.Sprintf("%s: 开启事务失败", report.FileName))
			database.DB.Exec(`DELETE FROM lab_reports WHERE id = ?`, reportID)
			os.Remove(filePath)
			continue
		}

		txFailed := false
		categorySet := make(map[string]bool)

		for _, itemData := range items {
			itemMap, ok := itemData.(map[string]interface{})
			if !ok {
				continue
			}
			name := getNestedValue(itemMap, req.Mappings.ItemName)
			value := getNestedValue(itemMap, req.Mappings.ItemValue)
			unit := getNestedValue(itemMap, req.Mappings.ItemUnit)
			category := getNestedValue(itemMap, req.Mappings.ItemCategory)
			if category == "" {
				category = getNestedValue(report.Data, req.Mappings.ItemCategory)
			}
			minVal := getNestedValue(itemMap, req.Mappings.RefMin)
			maxVal := getNestedValue(itemMap, req.Mappings.RefMax)

			refText := ""
			if req.Mappings.RefRange != "" {
				refText = getNestedValue(itemMap, req.Mappings.RefRange)
			}
			if refText == "" {
				if minVal != "" && maxVal != "" {
					refText = fmt.Sprintf("%s-%s", minVal, maxVal)
				} else if minVal != "" {
					refText = fmt.Sprintf(">=%s", minVal)
				} else if maxVal != "" {
					refText = fmt.Sprintf("<=%s", maxVal)
				}
				if refText == "" {
					for _, key := range []string{"refRange", "ref_range", "reference"} {
						if v := getNestedValue(itemMap, key); v != "" {
							refText = v
							break
						}
					}
				}
			}

			// 内存匹配 test_item，避免循环内重复查库
			var testItemID interface{}
			if name != "" {
				matchID := itemIdx.Match(name)
				if matchID > 0 {
					testItemID = matchID
					if category != "" {
						tx.Exec(`UPDATE test_items SET category = ? WHERE id = ?`, category, matchID)
					}
				} else {
					code := strings.ReplaceAll(strings.ToUpper(name), " ", "_")
					r, execErr := tx.Exec(
						`INSERT INTO test_items (code, standard_name, category, default_unit, value_type) VALUES (?, ?, ?, ?, 'numeric')`,
						code, name, category, unit,
					)
					if execErr == nil {
						newID, _ := r.LastInsertId()
						testItemID = newID
						itemIdx.AddCandidate(newID, name, category)
					}
				}
			}

			if _, execErr := tx.Exec(
				`INSERT INTO report_items (report_id, test_item_id, test_item_name, original_value, original_unit, confidence, ref_interval_text, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				reportID, testItemID, name, value, unit, 100, refText, category,
			); execErr != nil {
				txFailed = true
				break
			}

			if category != "" {
				categorySet[category] = true
			}
		}

		if txFailed {
			tx.Rollback()
			database.DB.Exec(`DELETE FROM lab_reports WHERE id = ?`, reportID)
			os.Remove(filePath)
			result.FailCount++
			result.Errors = append(result.Errors, fmt.Sprintf("%s: 写入检验项目失败", report.FileName))
			continue
		}

		if len(categorySet) > 0 {
			cats := make([]string, 0, len(categorySet))
			for c := range categorySet {
				cats = append(cats, c)
			}
			sort.Strings(cats)
			tx.Exec(`UPDATE lab_reports SET categories = ? WHERE id = ?`, strings.Join(cats, ","), reportID)
		}

		if err := tx.Commit(); err != nil {
			database.DB.Exec(`DELETE FROM lab_reports WHERE id = ?`, reportID)
			os.Remove(filePath)
			result.FailCount++
			result.Errors = append(result.Errors, fmt.Sprintf("%s: 提交事务失败", report.FileName))
			continue
		}

		// Auto-match reference intervals and compute flags（自带事务）
		matchRefAndCalcFlag(fmt.Sprintf("%d", reportID))

		result.SuccessCount++
		result.ReportIDs = append(result.ReportIDs, reportID)

		services.LogAction("batch_import_report", "批量导入报告", "lab_report", reportID, nil)
	}

	c.JSON(http.StatusOK, models.Success(result))
}

func getNestedValue(data map[string]interface{}, path string) string {
	if path == "" {
		return ""
	}

	raw := getNestedRaw(data, path)
	if raw == nil {
		return ""
	}
	if v, ok := raw.(string); ok {
		return v
	}
	return fmt.Sprintf("%v", raw)
}

func getNestedRaw(data map[string]interface{}, path string) interface{} {
	if path == "" {
		return nil
	}
	parts := strings.Split(path, ".")
	current := interface{}(data)
	for _, part := range parts {
		// 支持数组索引: key[N]
		if idx := strings.Index(part, "["); idx > 0 && strings.HasSuffix(part, "]") {
			key := part[:idx]
			indexStr := part[idx+1 : len(part)-1]
			index, err := strconv.Atoi(indexStr)
			if err != nil {
				return nil
			}
			if m, ok := current.(map[string]interface{}); ok {
				if arr, ok := m[key]; ok {
					if a, ok := arr.([]interface{}); ok && index >= 0 && index < len(a) {
						current = a[index]
						continue
					}
				}
			}
			return nil
		}

		if m, ok := current.(map[string]interface{}); ok {
			if v, ok := m[part]; ok {
				current = v
			} else {
				return nil
			}
		} else {
			return nil
		}
	}
	return current
}

func getBaseName(filename string) string {
	name := filepath.Base(filename)
	ext := filepath.Ext(name)
	return strings.TrimSuffix(name, ext)
}

func base64Decode(s string) ([]byte, error) {
	if idx := strings.Index(s, ","); idx != -1 {
		s = s[idx+1:]
	}
	return base64.StdEncoding.DecodeString(s)
}
