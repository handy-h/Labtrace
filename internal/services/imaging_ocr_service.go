package services

import (
	"regexp"
	"sort"
	"strings"

	"labtrace/internal/models"
)

func ParseImagingReport(ocrResults []OCRResult) *models.ImagingParsedResult {
	result := &models.ImagingParsedResult{}

	var currentField string
	var sb strings.Builder

	for _, block := range ocrResults {
		text := strings.TrimSpace(block.Text)
		if text == "" {
			continue
		}

		lowerText := strings.ToLower(text)

		if strings.Contains(lowerText, "检查部位") || strings.Contains(lowerText, "检查部位：") {
			if sb.Len() > 0 {
				saveCurrentField(result, currentField, sb.String())
			}
			currentField = "exam_site"
			sb.Reset()
			sb.WriteString(extractAfterColon(text))
			continue
		}

		if strings.Contains(lowerText, "诊断结论") || strings.Contains(lowerText, "印象：") ||
			strings.Contains(lowerText, "印象诊断") || strings.Contains(lowerText, "诊断意见") {
			if sb.Len() > 0 {
				saveCurrentField(result, currentField, sb.String())
			}
			currentField = "diagnosis_result"
			sb.Reset()
			sb.WriteString(extractAfterColon(text))
			continue
		}

		if strings.Contains(lowerText, "影像表现") || strings.Contains(lowerText, "所见") ||
			strings.Contains(lowerText, "描述：") || strings.Contains(lowerText, "检查所见") {
			if sb.Len() > 0 {
				saveCurrentField(result, currentField, sb.String())
			}
			currentField = "exam_description"
			sb.Reset()
			sb.WriteString(extractAfterColon(text))
			continue
		}

		if strings.Contains(lowerText, "检查项目") || strings.Contains(lowerText, "检查名称") {
			if sb.Len() > 0 {
				saveCurrentField(result, currentField, sb.String())
			}
			currentField = "exam_item_name"
			sb.Reset()
			sb.WriteString(extractAfterColon(text))
			continue
		}

		if strings.Contains(lowerText, "检查号") || strings.Contains(lowerText, "报告编号") {
			if sb.Len() > 0 {
				saveCurrentField(result, currentField, sb.String())
			}
			currentField = "inspect_no"
			sb.Reset()
			sb.WriteString(extractAfterColon(text))
			continue
		}

		if strings.Contains(lowerText, "检查日期") || strings.Contains(lowerText, "报告日期") ||
			strings.Contains(lowerText, "日期：") || strings.Contains(lowerText, "date:") {
			if sb.Len() > 0 {
				saveCurrentField(result, currentField, sb.String())
			}
			currentField = "sample_date"
			sb.Reset()
			sb.WriteString(extractAfterColon(text))
			continue
		}

		if sb.Len() > 0 {
			sb.WriteString("\n")
			sb.WriteString(text)
		}
	}

	if sb.Len() > 0 {
		saveCurrentField(result, currentField, sb.String())
	}

	return result
}

func saveCurrentField(result *models.ImagingParsedResult, field, value string) {
	value = strings.TrimSpace(value)
	if value == "" {
		return
	}

	switch field {
	case "exam_item_name":
		result.ExamItemName = value
	case "inspect_no":
		result.InspectNo = value
	case "sample_date":
		// 只取日期部分，去掉时间
		result.SampleDate = extractDateOnly(value)
	case "exam_site":
		result.ExamSite = value
	case "exam_description":
		result.ExamDescription = value
	case "diagnosis_result":
		result.DiagnosisResult = value
	}
}

func extractAfterColon(text string) string {
	idx := strings.Index(text, "：")
	if idx == -1 {
		idx = strings.Index(text, ":")
	}
	if idx == -1 {
		return text
	}
	return strings.TrimSpace(text[idx+1:])
}

// extractDateOnly 从 OCR 文本中提取纯日期部分（YYYY-MM-DD），去掉时间。
func extractDateOnly(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	// 使用正则匹配 YYYY-MM-DD 或 YYYY/MM/DD 或 YYYY.MM.DD 格式
	// 支持日期和时间连在一起的情况（如 2025-03-3113:50:57）
	re := regexp.MustCompile(`(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})`)
	matches := re.FindStringSubmatch(raw)
	if len(matches) >= 4 {
		year := matches[1]
		month := matches[2]
		day := matches[3]
		// 补零
		if len(month) == 1 {
			month = "0" + month
		}
		if len(day) == 1 {
			day = "0" + day
		}
		return year + "-" + month + "-" + day
	}
	return raw
}

// ParseImagingReportWithMapping 根据用户定义的映射配置解析影像报告。
// cfg.FieldMappings 的 key 是字段名（如 exam_item_name），value 是 OCR 块索引列表。
func ParseImagingReportWithMapping(blocks []OCRResult, cfg models.ImagingMappingConfig) *models.ImagingParsedResult {
	result := &models.ImagingParsedResult{}

	// 定义字段名到结构体字段的映射
	fieldSetters := map[string]func(string){
		"exam_item_name":   func(v string) { result.ExamItemName = v },
		"inspect_no":       func(v string) { result.InspectNo = v },
		"sample_date":      func(v string) { result.SampleDate = v },
		"exam_site":        func(v string) { result.ExamSite = v },
		"exam_description": func(v string) { result.ExamDescription = v },
		"diagnosis_result": func(v string) { result.DiagnosisResult = v },
	}

	for fieldName, indices := range cfg.FieldMappings {
		setter, ok := fieldSetters[fieldName]
		if !ok {
			continue // 跳过无效字段名
		}

		// 收集并排序 OCR 块
		var fieldBlocks []OCRResult
		for _, idx := range indices {
			if idx >= 0 && idx < len(blocks) {
				fieldBlocks = append(fieldBlocks, blocks[idx])
			}
		}

		// 按 Y 坐标（Top）排序，保持阅读顺序
		sort.Slice(fieldBlocks, func(i, j int) bool {
			return fieldBlocks[i].Top < fieldBlocks[j].Top
		})

		// 合并文本
		var texts []string
		for _, block := range fieldBlocks {
			if block.Text != "" {
				texts = append(texts, block.Text)
			}
		}

		if len(texts) > 0 {
			setter(strings.Join(texts, "\n"))
		}
	}

	for fieldName, value := range cfg.FieldValues {
		setter, ok := fieldSetters[fieldName]
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		setter(value)
	}

	return result
}
