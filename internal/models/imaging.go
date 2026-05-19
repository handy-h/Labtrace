package models

type ImagingReportType struct {
	ID          int64  `json:"id"`
	Code        string `json:"code"`
	Name        string `json:"name"`
	NameEn      string `json:"name_en"`
	Description string `json:"description"`
	SortOrder   int    `json:"sort_order"`
	CreatedAt   string `json:"created_at"`
}

type ImagingReport struct {
	ID               int64  `json:"id"`
	SubjectID        int64  `json:"subject_id"`
	HospitalID       *int64 `json:"hospital_id,omitempty"`
	ReportType       string `json:"report_type"`
	ExamItemName     string `json:"exam_item_name"`
	InspectNo        string `json:"inspect_no"`
	SampleDate       string `json:"sample_date"`
	ExamSite         string `json:"exam_site"`
	ExamDescription  string `json:"exam_description"`
	DiagnosisResult  string `json:"diagnosis_result"`
	FilePath         string `json:"file_path"`
	FileMD5          string `json:"file_md5"`
	OCRStatus        string `json:"ocr_status"`
	OCRRawJSON      string `json:"ocr_raw_json,omitempty"`
	ThumbnailPath    string `json:"thumbnail_path"`
	CreatedAt        string `json:"created_at"`
	UpdatedAt        string `json:"updated_at"`

	HospitalName string `json:"hospital_name,omitempty"`
	SubjectName  string `json:"subject_name,omitempty"`
}

type ImagingUploadResponse struct {
	ReportID int64  `json:"report_id"`
	FileMD5  string `json:"file_md5"`
	Status   string `json:"status"`
}

type ImagingParsedResult struct {
	ExamItemName    string `json:"exam_item_name"`
	InspectNo       string `json:"inspect_no"`
	ExamSite        string `json:"exam_site"`
	ExamDescription string `json:"exam_description"`
	DiagnosisResult string `json:"diagnosis_result"`
}

// ImagingMappingConfig stores the user-defined field mapping for imaging reports.
type ImagingMappingConfig struct {
	// FieldMappings maps field names to lists of OCR block indices.
	// Valid field names: exam_item_name, inspect_no,
	//                    exam_site, exam_description, diagnosis_result
	FieldMappings map[string][]int `json:"field_mappings"`

	// HospitalID is optional, used for template matching.
	HospitalID *int64 `json:"hospital_id,omitempty"`
}
