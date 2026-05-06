package services

import (
	"testing"
)

// TestClassifyText_BoundValues tests that <X and >X formats are classified as "value".
func TestClassifyText_BoundValues(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"<220", "value"},
		{"<500", "value"},
		{">100", "value"},
		{"≤50", "value"},
		{"≥10", "value"},
		{"<0.5", "value"},
		{">99.9", "value"},
	}
	for _, tt := range tests {
		got := classifyText(tt.input)
		if got != tt.expected {
			t.Errorf("classifyText(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}

// TestClassifyText_RangeOnlyInterval tests that only X-Y intervals are classified as "range".
func TestClassifyText_RangeOnlyInterval(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"3.5-9.5", "range"},
		{"0-100", "range"},
		{"4.0~10.0", "range"},
		// <X and >X should NOT be range
		{"<220", "value"},
		{"<500", "value"},
	}
	for _, tt := range tests {
		got := classifyText(tt.input)
		if got != tt.expected {
			t.Errorf("classifyText(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}

// TestClassifyText_KnownUnits tests that known lab units are classified as "unit".
func TestClassifyText_KnownUnits(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"ug/L FEU", "unit"},
		{"μg/L FEU", "unit"},
		{"mmol/L", "unit"},
		{"10^9/L", "unit"},
		{"%", "unit"},
		{"U/L", "unit"},
		{"fl", "unit"},
	}
	for _, tt := range tests {
		got := classifyText(tt.input)
		if got != tt.expected {
			t.Errorf("classifyText(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}

// TestClassifyText_NoiseFiltering tests that header/footer/person names are filtered as noise.
func TestClassifyText_NoiseFiltering(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"年龄：44岁", "noise"},
		{"性别：男", "noise"},
		{"实验项目", "noise"},
		{"结果", "noise"},
		{"参考区间", "noise"},
		{"单位", "noise"},
		{"开单医生：", "noise"},
		{"王靖程", "noise"},
		{"检验者：杨龙", "noise"},
		{"审核者：", "noise"},
		{"采集时间：2026-04-2703：49", "noise"},
		{"浙江大学医学院附属第一医院(余杭)", "noise"},
		{"检验报告单", "noise"},
		{"姓名：洪峰", "noise"},
		{"※本报告仅对所检测的标本负责!如有疑问请在五天内与我科及时联系", "noise"},
		{"地址：杭州市余杭区文一西路1367号", "noise"},
		{"电话：87232719", "noise"},
	}
	for _, tt := range tests {
		got := classifyText(tt.input)
		if got != tt.expected {
			t.Errorf("classifyText(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}

// TestClassifyText_TestItemNames tests that test item names are classified as "name".
func TestClassifyText_TestItemNames(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"1.D-二聚体.", "name"},
		{"白细胞计数", "name"},
		{"血红蛋白", "name"},
		{"D-二聚体", "name"},
	}
	for _, tt := range tests {
		got := classifyText(tt.input)
		if got != tt.expected {
			t.Errorf("classifyText(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}

// TestParseLabResults_DDimerReport tests the full parsing pipeline with a realistic D-Dimer report.
func TestParseLabResults_DDimerReport(t *testing.T) {
	// Simulate OCR results from a D-Dimer lab report (all coords 0, as returned by Aliyun OCR)
	results := []OCRResult{
		{Text: "浙江大学医学院附属第一医院(余杭)", Confidence: 99, Row: 0},
		{Text: "检验报告单", Confidence: 99, Row: 0},
		{Text: "【血浆D-二聚体测定(D-Dimer)(急诊)】", Confidence: 99, Row: 0},
		{Text: "姓名：洪峰", Confidence: 99, Row: 1},
		{Text: "年龄：44岁", Confidence: 99, Row: 1},
		{Text: "性别：男", Confidence: 99, Row: 1},
		{Text: "样本类型：血浆", Confidence: 99, Row: 2},
		{Text: "科室：急诊科门诊(余杭)", Confidence: 99, Row: 2},
		{Text: "临床诊断：胸痛", Confidence: 99, Row: 2},
		{Text: "实验项目", Confidence: 99, Row: 3},
		{Text: "结果", Confidence: 99, Row: 3},
		{Text: "参考区间", Confidence: 99, Row: 3},
		{Text: "单位", Confidence: 99, Row: 3},
		{Text: "1.D-二聚体.", Confidence: 99, Row: 4},
		{Text: "<220", Confidence: 99, Row: 4},
		{Text: "<500", Confidence: 99, Row: 4},
		{Text: "ug/L FEU", Confidence: 98, Row: 4},
		{Text: "开单医生：", Confidence: 99, Row: 5},
		{Text: "王靖程", Confidence: 99, Row: 5},
		{Text: "检验者：杨龙", Confidence: 98, Row: 5},
		{Text: "审核者：", Confidence: 99, Row: 6},
		{Text: "采集时间：2026-04-2703：49", Confidence: 99, Row: 6},
	}

	items := ParseLabResults(results)

	if len(items) == 0 {
		t.Fatal("ParseLabResults returned 0 items, expected at least 1")
	}

	// Find the D-二聚体 item
	var dDimerItem *ParsedLabItem
	for i := range items {
		if items[i].Name == "1.D-二聚体." {
			dDimerItem = &items[i]
			break
		}
	}

	if dDimerItem == nil {
		t.Fatalf("D-二聚体 item not found in parsed results. Got items: %+v", items)
	}

	if dDimerItem.Value != "<220" {
		t.Errorf("D-二聚体 Value = %q, want %q", dDimerItem.Value, "<220")
	}
	if dDimerItem.Unit != "ug/L FEU" {
		t.Errorf("D-二聚体 Unit = %q, want %q", dDimerItem.Unit, "ug/L FEU")
	}
	if dDimerItem.Range != "<500" {
		t.Errorf("D-二聚体 Range = %q, want %q", dDimerItem.Range, "<500")
	}
}

// TestParseLabResults_CommonLabReport tests parsing of a common multi-item lab report.
func TestParseLabResults_CommonLabReport(t *testing.T) {
	results := []OCRResult{
		{Text: "白细胞计数", Confidence: 99, Row: 0},
		{Text: "5.2", Confidence: 99, Row: 0},
		{Text: "3.5-9.5", Confidence: 99, Row: 0},
		{Text: "10^9/L", Confidence: 98, Row: 0},
		{Text: "红细胞计数", Confidence: 99, Row: 1},
		{Text: "4.8", Confidence: 99, Row: 1},
		{Text: "4.3-5.8", Confidence: 99, Row: 1},
		{Text: "10^12/L", Confidence: 98, Row: 1},
		{Text: "血红蛋白", Confidence: 99, Row: 2},
		{Text: "145", Confidence: 99, Row: 2},
		{Text: "130-175", Confidence: 99, Row: 2},
		{Text: "g/L", Confidence: 99, Row: 2},
	}

	items := ParseLabResults(results)

	if len(items) < 3 {
		t.Fatalf("ParseLabResults returned %d items, expected at least 3", len(items))
	}

	// Check first item
	if items[0].Name != "白细胞计数" {
		t.Errorf("items[0].Name = %q, want %q", items[0].Name, "白细胞计数")
	}
	if items[0].Value != "5.2" {
		t.Errorf("items[0].Value = %q, want %q", items[0].Value, "5.2")
	}
	if items[0].Range != "3.5-9.5" {
		t.Errorf("items[0].Range = %q, want %q", items[0].Range, "3.5-9.5")
	}
	if items[0].Unit != "10^9/L" {
		t.Errorf("items[0].Unit = %q, want %q", items[0].Unit, "10^9/L")
	}
}

// TestGroupIntoItem_SecondValueAsRange tests that in groupIntoItem,
// the second value-like field is treated as reference range.
func TestGroupIntoItem_SecondValueAsRange(t *testing.T) {
	fields := []classifiedField{
		{text: "1.D-二聚体.", kind: "name"},
		{text: "<220", kind: "value"},
		{text: "<500", kind: "value"},
		{text: "ug/L FEU", kind: "unit"},
	}
	blocks := []OCRResult{
		{Text: "1.D-二聚体.", Confidence: 99},
		{Text: "<220", Confidence: 99},
		{Text: "<500", Confidence: 99},
		{Text: "ug/L FEU", Confidence: 98},
	}

	item := groupIntoItem(fields, blocks)
	if item == nil {
		t.Fatal("groupIntoItem returned nil")
	}
	if item.Value != "<220" {
		t.Errorf("Value = %q, want %q", item.Value, "<220")
	}
	if item.Range != "<500" {
		t.Errorf("Range = %q, want %q", item.Range, "<500")
	}
	if item.Unit != "ug/L FEU" {
		t.Errorf("Unit = %q, want %q", item.Unit, "ug/L FEU")
	}
}

// TestParseLabResults_DDimerReport_AllRowZero tests the realistic scenario
// where Aliyun OCR returns all blocks with Row=0 and coords=0.
// This should fall through to parseLinear which uses the state machine.
func TestParseLabResults_DDimerReport_AllRowZero(t *testing.T) {
	// This matches the actual OCR data stored in the database for report #2
	results := []OCRResult{
		{Text: "浙江大学医学院附属第一医院(余杭)", Confidence: 99, Row: 0},
		{Text: "检验报告单", Confidence: 99, Row: 0},
		{Text: "【血浆D-二聚体测定(D-Dimer)(急诊)】", Confidence: 99, Row: 0},
		{Text: "病历号：00640285", Confidence: 99, Row: 0},
		{Text: "0285就诊卡号：N330124198112060016", Confidence: 99, Row: 0},
		{Text: "NO.260427YJF00046", Confidence: 99, Row: 0},
		{Text: "姓名：洪峰", Confidence: 99, Row: 0},
		{Text: "年龄：44岁", Confidence: 99, Row: 0},
		{Text: "性别：男", Confidence: 99, Row: 0},
		{Text: "样本类型：血浆", Confidence: 99, Row: 0},
		{Text: "科室：急诊科门诊(余杭)", Confidence: 99, Row: 0},
		{Text: "临床诊断：胸痛", Confidence: 99, Row: 0},
		{Text: "实验项目", Confidence: 99, Row: 0},
		{Text: "结果", Confidence: 99, Row: 0},
		{Text: "参考区间", Confidence: 99, Row: 0},
		{Text: "单位", Confidence: 99, Row: 0},
		{Text: "1.D-二聚体.", Confidence: 99, Row: 0},
		{Text: "<220", Confidence: 99, Row: 0},
		{Text: "<500", Confidence: 99, Row: 0},
		{Text: "ug/L FEU", Confidence: 98, Row: 0},
		{Text: "※D-二聚体<500 ug/L FEU，有99.7%概率可排除静脉血栓栓塞症，若≥500", Confidence: 99, Row: 0},
		{Text: "0", Confidence: 99, Row: 0},
		{Text: "U", Confidence: 90, Row: 0},
		{Text: "ug/L FEU，并不提示血栓发", Confidence: 96, Row: 0},
		{Text: "生，请结合临床。", Confidence: 99, Row: 0},
		{Text: "开单医生：", Confidence: 99, Row: 0},
		{Text: "王靖程", Confidence: 99, Row: 0},
		{Text: "检验者：杨龙", Confidence: 98, Row: 0},
		{Text: "审核者：", Confidence: 99, Row: 0},
		{Text: "采集时间：2026-04-2703：49", Confidence: 99, Row: 0},
		{Text: "接收时间：2026-04-2704：01", Confidence: 99, Row: 0},
		{Text: "报告时间：2026-04-2704：38", Confidence: 99, Row: 0},
		{Text: "※本报告仅对所检测的标本负责!如有疑问请在五天内与我科及时联系", Confidence: 99, Row: 0},
		{Text: "地址：杭州市余杭区文一西路1367号", Confidence: 98, Row: 0},
		{Text: "电话：87232719", Confidence: 99, Row: 0},
	}

	items := ParseLabResults(results)

	if len(items) == 0 {
		t.Fatal("ParseLabResults returned 0 items for all-row-zero D-Dimer report, expected at least 1")
	}

	// Find the D-二聚体 item
	var dDimerItem *ParsedLabItem
	for i := range items {
		if items[i].Name == "1.D-二聚体." {
			dDimerItem = &items[i]
			break
		}
	}

	if dDimerItem == nil {
		t.Fatalf("D-二聚体 item not found in parsed results. Got %d items: %+v", len(items), items)
	}

	if dDimerItem.Value != "<220" {
		t.Errorf("D-二聚体 Value = %q, want %q", dDimerItem.Value, "<220")
	}
	if dDimerItem.Unit != "ug/L FEU" {
		t.Errorf("D-二聚体 Unit = %q, want %q", dDimerItem.Unit, "ug/L FEU")
	}
	if dDimerItem.Range != "<500" {
		t.Errorf("D-二聚体 Range = %q, want %q", dDimerItem.Range, "<500")
	}
}
