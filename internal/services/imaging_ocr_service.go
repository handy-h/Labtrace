package services

import (
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

		if strings.Contains(lowerText, "科室") && !strings.Contains(lowerText, "影像表现") {
			if sb.Len() > 0 {
				saveCurrentField(result, currentField, sb.String())
			}
			currentField = "dept_name"
			sb.Reset()
			sb.WriteString(extractAfterColon(text))
			continue
		}

		if strings.Contains(lowerText, "报告医生") || strings.Contains(lowerText, "诊断医生") ||
			strings.Contains(lowerText, "审核医生") || strings.Contains(lowerText, "医生") {
			if strings.Contains(lowerText, "医生") && !strings.Contains(lowerText, "影像表现") {
				if sb.Len() > 0 {
					saveCurrentField(result, currentField, sb.String())
				}
				currentField = "doctor_name"
				sb.Reset()
				sb.WriteString(extractAfterColon(text))
				continue
			}
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
	case "dept_name":
		result.DeptName = value
	case "doctor_name":
		result.DoctorName = value
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
