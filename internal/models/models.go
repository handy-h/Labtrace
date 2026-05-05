package models

// Subject — 受检者
type Subject struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Gender    string `json:"gender"` // 男 | 女
	BirthDate string `json:"birth_date"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// SubjectSummary — 列表用（含统计）
type SubjectSummary struct {
	Subject
	ReportCount   int64  `json:"report_count"`
	LastReportDate string `json:"last_report_date,omitempty"`
}

// Hospital — 医院
type Hospital struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"created_at"`
}

// TestItem — 检验项目
type TestItem struct {
	ID           int64  `json:"id"`
	Code         string `json:"code"`
	StandardName string `json:"standard_name"`
	Category     string `json:"category"`
	DefaultUnit  string `json:"default_unit"`
	ValueType    string `json:"value_type"` // numeric | titer | qualitative
	CreatedAt    string `json:"created_at"`
}

// TestItemAlias — 项目别名
type TestItemAlias struct {
	ID         int64  `json:"id"`
	TestItemID int64  `json:"test_item_id"`
	HospitalID *int64 `json:"hospital_id,omitempty"`
	AliasName  string `json:"alias_name"`
	CreatedAt  string `json:"created_at"`
}

// ReferenceInterval — 参考区间
type ReferenceInterval struct {
	ID               int64    `json:"id"`
	TestItemID       int64    `json:"test_item_id"`
	Gender           string   `json:"gender"` // 男 | 女 | 不限
	AgeMin           *float64 `json:"age_min,omitempty"`
	AgeMax           *float64 `json:"age_max,omitempty"`
	AgeUnit          string   `json:"age_unit"` // 岁 | 天
	ValueMin         *float64 `json:"value_min,omitempty"`
	ValueMax         *float64 `json:"value_max,omitempty"`
	ValueType        string   `json:"value_type"` // numeric | titer | qualitative
	QualitativeValue string   `json:"qualitative_value,omitempty"`
	CreatedAt        string   `json:"created_at"`
}

// UnitConversion — 单位转换
type UnitConversion struct {
	ID            int64   `json:"id"`
	TestItemID    int64   `json:"test_item_id"`
	SourceUnit    string  `json:"source_unit"`
	TargetUnit    string  `json:"target_unit"`
	Formula       string  `json:"formula"`
	ExampleInput  float64 `json:"example_input"`
	ExampleOutput float64 `json:"example_output"`
	CreatedAt     string  `json:"created_at"`
}

// CalculationRule — 计算校验规则
type CalculationRule struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	Formula      string `json:"formula"`
	Threshold    float64 `json:"threshold"`
	TestItemIDs  string `json:"test_item_ids"` // JSON array
	CreatedAt    string `json:"created_at"`
}

// LabReport — 检验报告单
type LabReport struct {
	ID               int64  `json:"id"`
	SubjectID        int64  `json:"subject_id"`
	HospitalID       *int64 `json:"hospital_id,omitempty"`
	SampleDate       string `json:"sample_date"`
	FilePath         string `json:"file_path"`
	FileMD5          string `json:"file_md5"`
	OCRStatus        string `json:"ocr_status"` // pending|processing|review|imported|failed
	OCRRawJSON       string `json:"ocr_raw_json,omitempty"`
	WholeReportNotes string `json:"whole_report_notes"`
	CreatedAt        string `json:"created_at"`

	// Joined fields
	HospitalName string       `json:"hospital_name,omitempty"`
	Items        []ReportItem `json:"items,omitempty"`
}

// ReportItem — 报告数据行
type ReportItem struct {
	ID              int64   `json:"id"`
	ReportID        int64   `json:"report_id"`
	TestItemID      *int64  `json:"test_item_id,omitempty"`
	OriginalValue   string  `json:"original_value"`
	NormalizedValue *float64 `json:"normalized_value,omitempty"`
	OriginalUnit    string  `json:"original_unit"`
	NormalizedUnit  string  `json:"normalized_unit"`
	Confidence      int     `json:"confidence"`
	RefIntervalID   *int64  `json:"ref_interval_id,omitempty"`
	Flag            string  `json:"flag"` // H|L|阳性|阴性|normal
	RowNotes        string  `json:"row_notes"`
	OCRBBox         string  `json:"ocr_bbox,omitempty"` // JSON: {x,y,w,h}
	CreatedAt       string  `json:"created_at"`

	// Joined fields
	TestItemName   string `json:"test_item_name,omitempty"`
	RefIntervalText string `json:"ref_interval_text,omitempty"`
}

// HospitalRule — 医院解析规则
type HospitalRule struct {
	ID             int64  `json:"id"`
	HospitalID     int64  `json:"hospital_id"`
	RuleName       string `json:"rule_name"`
	ColumnMappings string `json:"column_mappings"` // JSON
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
}

// Backup — 备份记录
type Backup struct {
	ID          int64  `json:"id"`
	Filename    string `json:"filename"`
	Description string `json:"description"`
	FileSize    int64  `json:"file_size"`
	CreatedAt   string `json:"created_at"`
}

// AuditLog — 审计日志
type AuditLog struct {
	ID         int64  `json:"id"`
	Action     string `json:"action"`
	EntityType string `json:"entity_type"`
	EntityID   int64  `json:"entity_id"`
	Details    string `json:"details"` // JSON
	CreatedAt  string `json:"created_at"`
}

// --- Request / Response helpers ---

type PaginatedResponse struct {
	Data       interface{} `json:"data"`
	Total      int64       `json:"total"`
	Page       int         `json:"page"`
	PageSize   int         `json:"page_size"`
}

type APIResponse struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

func Success(data interface{}) APIResponse {
	return APIResponse{Code: 0, Message: "ok", Data: data}
}

func Error(msg string) APIResponse {
	return APIResponse{Code: 1, Message: msg}
}