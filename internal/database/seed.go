package database

import (
	"database/sql"
	"fmt"
)

// Seed inserts preset data if tables are empty.
func Seed(db *sql.DB) error {
	if err := seedTestItems(db); err != nil {
		return err
	}
	if err := seedReferenceIntervals(db); err != nil {
		return err
	}
	if err := seedUnitConversions(db); err != nil {
		return err
	}
	if err := seedCalculationRules(db); err != nil {
		return err
	}
	if err := seedReportCategories(db); err != nil {
		return err
	}
	if err := seedImagingReportTypes(db); err != nil {
		return err
	}
	return nil
}

func seedTestItems(db *sql.DB) error {
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM test_items").Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	items := []struct {
		code, name, category, unit, valueType string
	}{
		// 血常规
		{"WBC", "白细胞计数", "血常规", "×10^9/L", "numeric"},
		{"RBC", "红细胞计数", "血常规", "×10^12/L", "numeric"},
		{"HGB", "血红蛋白", "血常规", "g/L", "numeric"},
		{"HCT", "红细胞压积", "血常规", "%", "numeric"},
		{"MCV", "平均红细胞体积", "血常规", "fL", "numeric"},
		{"MCH", "平均红细胞血红蛋白量", "血常规", "pg", "numeric"},
		{"MCHC", "平均红细胞血红蛋白浓度", "血常规", "g/L", "numeric"},
		{"PLT", "血小板计数", "血常规", "×10^9/L", "numeric"},
		{"NEU%", "中性粒细胞百分比", "血常规", "%", "numeric"},
		{"LYM%", "淋巴细胞百分比", "血常规", "%", "numeric"},
		{"MONO%", "单核细胞百分比", "血常规", "%", "numeric"},
		{"EO%", "嗜酸性粒细胞百分比", "血常规", "%", "numeric"},
		{"BASO%", "嗜碱性粒细胞百分比", "血常规", "%", "numeric"},
		{"NEU", "中性粒细胞绝对值", "血常规", "×10^9/L", "numeric"},
		{"LYM", "淋巴细胞绝对值", "血常规", "×10^9/L", "numeric"},
		{"MONO", "单核细胞绝对值", "血常规", "×10^9/L", "numeric"},
		{"RDW-CV", "红细胞分布宽度CV", "血常规", "%", "numeric"},
		{"PDW", "血小板分布宽度", "血常规", "fL", "numeric"},
		{"MPV", "平均血小板体积", "血常规", "fL", "numeric"},
		// 生化
		{"GLU", "血糖", "生化", "mmol/L", "numeric"},
		{"TP", "总蛋白", "生化", "g/L", "numeric"},
		{"ALB", "白蛋白", "生化", "g/L", "numeric"},
		{"GLOB", "球蛋白", "生化", "g/L", "numeric"},
		{"A/G", "白球比", "生化", "", "numeric"},
		{"ALT", "丙氨酸氨基转移酶", "生化", "U/L", "numeric"},
		{"AST", "天门冬氨酸氨基转移酶", "生化", "U/L", "numeric"},
		{"ALP", "碱性磷酸酶", "生化", "U/L", "numeric"},
		{"GGT", "γ-谷氨酰转肽酶", "生化", "U/L", "numeric"},
		{"TBIL", "总胆红素", "生化", "μmol/L", "numeric"},
		{"DBIL", "直接胆红素", "生化", "μmol/L", "numeric"},
		{"BUN", "尿素氮", "生化", "mmol/L", "numeric"},
		{"Cr", "肌酐", "生化", "μmol/L", "numeric"},
		{"UA", "尿酸", "生化", "μmol/L", "numeric"},
		{"TC", "总胆固醇", "生化", "mmol/L", "numeric"},
		{"TG", "甘油三酯", "生化", "mmol/L", "numeric"},
		{"HDL-C", "高密度脂蛋白胆固醇", "生化", "mmol/L", "numeric"},
		{"LDL-C", "低密度脂蛋白胆固醇", "生化", "mmol/L", "numeric"},
		{"K", "钾", "生化", "mmol/L", "numeric"},
		{"Na", "钠", "生化", "mmol/L", "numeric"},
		{"Cl", "氯", "生化", "mmol/L", "numeric"},
		{"Ca", "钙", "生化", "mmol/L", "numeric"},
		// 免疫/其他
		{"hsCRP", "超敏C反应蛋白", "免疫", "mg/L", "numeric"},
		{"ESR", "红细胞沉降率", "其他", "mm/h", "numeric"},
	}

	stmt, err := db.Prepare("INSERT INTO test_items (code, standard_name, category, default_unit, value_type) VALUES (?, ?, ?, ?, ?)")
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, it := range items {
		if _, err := stmt.Exec(it.code, it.name, it.category, it.unit, it.valueType); err != nil {
			return err
		}
	}
	return nil
}

func seedReferenceIntervals(db *sql.DB) error {
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM reference_intervals").Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	// Helper: get test_item_id by code
	itemID := func(code string) int64 {
		var id int64
		db.QueryRow("SELECT id FROM test_items WHERE code = ?", code).Scan(&id)
		return id
	}

	intervals := []struct {
		itemCode, gender    string
		ageMin, ageMax      float64
		ageUnit             string
		valueMin, valueMax  float64
		valueType           string
	}{
		// 血常规 - 成人
		{"WBC", "不限", 18, 200, "岁", 4.0, 10.0, "numeric"},
		{"RBC", "男", 18, 200, "岁", 4.0, 5.5, "numeric"},
		{"RBC", "女", 18, 200, "岁", 3.5, 5.0, "numeric"},
		{"HGB", "男", 18, 200, "岁", 120, 160, "numeric"},
		{"HGB", "女", 18, 200, "岁", 110, 150, "numeric"},
		{"HCT", "男", 18, 200, "岁", 40, 50, "numeric"},
		{"HCT", "女", 18, 200, "岁", 37, 48, "numeric"},
		{"MCV", "不限", 18, 200, "岁", 80, 100, "numeric"},
		{"MCH", "不限", 18, 200, "岁", 27, 34, "numeric"},
		{"MCHC", "不限", 18, 200, "岁", 320, 360, "numeric"},
		{"PLT", "不限", 18, 200, "岁", 100, 300, "numeric"},
		{"NEU%", "不限", 18, 200, "岁", 40, 75, "numeric"},
		{"LYM%", "不限", 18, 200, "岁", 20, 50, "numeric"},
		{"MONO%", "不限", 18, 200, "岁", 3, 10, "numeric"},
		// 生化 - 成人
		{"GLU", "不限", 18, 200, "岁", 3.9, 6.1, "numeric"},
		{"TP", "不限", 18, 200, "岁", 60, 80, "numeric"},
		{"ALB", "不限", 18, 200, "岁", 35, 55, "numeric"},
		{"GLOB", "不限", 18, 200, "岁", 20, 35, "numeric"},
		{"A/G", "不限", 18, 200, "岁", 1.2, 2.0, "numeric"},
		{"ALT", "不限", 18, 200, "岁", 0, 40, "numeric"},
		{"AST", "不限", 18, 200, "岁", 0, 40, "numeric"},
		{"ALP", "不限", 18, 200, "岁", 40, 150, "numeric"},
		{"GGT", "不限", 18, 200, "岁", 0, 50, "numeric"},
		{"TBIL", "不限", 18, 200, "岁", 3.4, 17.1, "numeric"},
		{"DBIL", "不限", 18, 200, "岁", 0, 6.8, "numeric"},
		{"BUN", "不限", 18, 200, "岁", 2.9, 8.2, "numeric"},
		{"Cr", "男", 18, 200, "岁", 62, 115, "numeric"},
		{"Cr", "女", 18, 200, "岁", 53, 97, "numeric"},
		{"UA", "男", 18, 200, "岁", 208, 428, "numeric"},
		{"UA", "女", 18, 200, "岁", 155, 357, "numeric"},
		{"TC", "不限", 18, 200, "岁", 2.8, 5.7, "numeric"},
		{"TG", "不限", 18, 200, "岁", 0.56, 1.7, "numeric"},
		{"HDL-C", "男", 18, 200, "岁", 1.04, 1.55, "numeric"},
		{"HDL-C", "女", 18, 200, "岁", 1.10, 1.68, "numeric"},
		{"LDL-C", "不限", 18, 200, "岁", 1.5, 3.4, "numeric"},
		{"K", "不限", 18, 200, "岁", 3.5, 5.3, "numeric"},
		{"Na", "不限", 18, 200, "岁", 137, 147, "numeric"},
		{"Cl", "不限", 18, 200, "岁", 99, 110, "numeric"},
		{"Ca", "不限", 18, 200, "岁", 2.11, 2.55, "numeric"},
		{"hsCRP", "不限", 18, 200, "岁", 0, 3, "numeric"},
		{"ESR", "男", 18, 200, "岁", 0, 15, "numeric"},
		{"ESR", "女", 18, 200, "岁", 0, 20, "numeric"},
	}

	stmt, err := db.Prepare("INSERT INTO reference_intervals (test_item_id, gender, age_min, age_max, age_unit, value_min, value_max, value_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, ri := range intervals {
		id := itemID(ri.itemCode)
		if id == 0 {
			continue
		}
		if _, err := stmt.Exec(id, ri.gender, ri.ageMin, ri.ageMax, ri.ageUnit, ri.valueMin, ri.valueMax, ri.valueType); err != nil {
			return err
		}
	}
	return nil
}

func seedUnitConversions(db *sql.DB) error {
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM unit_conversions").Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	itemID := func(code string) int64 {
		var id int64
		db.QueryRow("SELECT id FROM test_items WHERE code = ?", code).Scan(&id)
		return id
	}

	conversions := []struct {
		itemCode, srcUnit, tgtUnit, formula string
		exIn, exOut                         float64
	}{
		{"GLU", "mmol/L", "mg/dL", "x*18.0", 5.6, 100.8},
		{"GLU", "mg/dL", "mmol/L", "x/18.0", 100.8, 5.6},
		{"HGB", "g/dL", "g/L", "x*10.0", 12.0, 120.0},
		{"HGB", "g/L", "g/dL", "x/10.0", 120.0, 12.0},
		{"Cr", "mg/dL", "μmol/L", "x*88.4", 1.0, 88.4},
		{"Cr", "μmol/L", "mg/dL", "x/88.4", 88.4, 1.0},
		{"UA", "μmol/L", "mg/dL", "x/59.48", 357, 6.0},
		{"UA", "mg/dL", "μmol/L", "x*59.48", 6.0, 356.88},
	}

	stmt, err := db.Prepare("INSERT INTO unit_conversions (test_item_id, source_unit, target_unit, formula, example_input, example_output) VALUES (?, ?, ?, ?, ?, ?)")
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, uc := range conversions {
		id := itemID(uc.itemCode)
		if id == 0 {
			continue
		}
		if _, err := stmt.Exec(id, uc.srcUnit, uc.tgtUnit, uc.formula, uc.exIn, uc.exOut); err != nil {
			return err
		}
	}
	return nil
}

func seedCalculationRules(db *sql.DB) error {
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM calculation_rules").Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	// Get item IDs for TP, ALB, GLOB
	var tpID, albID, globID int64
	db.QueryRow("SELECT id FROM test_items WHERE code = 'TP'").Scan(&tpID)
	db.QueryRow("SELECT id FROM test_items WHERE code = 'ALB'").Scan(&albID)
	db.QueryRow("SELECT id FROM test_items WHERE code = 'GLOB'").Scan(&globID)

	rules := []struct {
		name, formula, itemIDs string
		threshold              float64
	}{
		{"总蛋白=白蛋白+球蛋白", "TP=ALB+GLOB", "[]", 1.0},
		{"白球比=白蛋白/球蛋白", "A/G=ALB/GLOB", "[]", 0.2},
	}

	// Update itemIDs for first rule
	if tpID > 0 && albID > 0 && globID > 0 {
		rules[0].itemIDs = fmt.Sprintf("[%d,%d,%d]", tpID, albID, globID)
		rules[1].itemIDs = fmt.Sprintf("[%d,%d,%d]", albID, globID, 0) // 0 for A/G placeholder
	}

	stmt, err := db.Prepare("INSERT INTO calculation_rules (name, formula, threshold, test_item_ids) VALUES (?, ?, ?, ?)")
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, r := range rules {
		if _, err := stmt.Exec(r.name, r.formula, r.threshold, r.itemIDs); err != nil {
			return err
		}
	}
	return nil
}

func seedReportCategories(db *sql.DB) error {
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM report_categories").Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	categories := []string{
		"血常规",
		"尿常规",
		"肝功能",
		"肾功能",
		"血脂",
		"血糖",
		"甲状腺功能",
		"电解质",
		"免疫学检查",
		"肿瘤标志物",
		"凝血功能",
		"心肌酶谱",
		"性激素",
		"感染四项",
		"生化全套",
		"其他",
	}

	stmt, err := db.Prepare("INSERT INTO report_categories (name) VALUES (?)")
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, name := range categories {
		if _, err := stmt.Exec(name); err != nil {
			return err
		}
	}
	return nil
}

func seedImagingReportTypes(db *sql.DB) error {
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM imaging_report_types").Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	types := []struct {
		code, name, nameEn, desc string
		sort                     int
	}{
		{"CT", "CT检查", "CT Scan", "计算机断层扫描，包含平扫、增强、血管造影", 1},
		{"MRI", "MRI检查", "MRI", "磁共振成像，包含平扫、增强、MRA", 2},
		{"XRAY", "X光检查", "X-Ray", "X光片检查", 3},
		{"ULTRASOUND", "超声/彩超", "Ultrasound", "超声波检查", 4},
		{"ECG", "心电图", "ECG/EKG", "心电图检查", 5},
		{"OTHER", "其他影像", "Other", "其他类型影像检查", 6},
	}

	stmt, err := db.Prepare("INSERT INTO imaging_report_types (code, name, name_en, description, sort_order) VALUES (?, ?, ?, ?, ?)")
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, t := range types {
		if _, err := stmt.Exec(t.code, t.name, t.nameEn, t.desc, t.sort); err != nil {
			return err
		}
	}
	return nil
}
