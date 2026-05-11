package services

import (
	"log"
	"regexp"
	"sort"
	"strings"
)

// ParsedLabItem represents one parsed laboratory test item from OCR results.
type ParsedLabItem struct {
	Name       string `json:"name"`
	Value      string `json:"value"`
	Unit       string `json:"unit"`
	Range      string `json:"range"`
	Category   string `json:"category,omitempty"` // 检验项目分类（从映射列提取）
	Confidence int    `json:"confidence"`
	BBox       string `json:"bbox"` // JSON: {"x":...,"y":...,"w":...,"h":...,"page":...}
	RowText    string `json:"row_text"`
}

// ParseLabResults converts raw OCRResult slice into structured ParsedLabItem list.
func ParseLabResults(results []OCRResult) []ParsedLabItem {
	if len(results) == 0 {
		return nil
	}

	// Try structured SubImages path first
	items := parseStructured(results)
	if len(items) > 0 {
		log.Printf("[ocr_parser] parsed %d items from structured blocks", len(items))
		return items
	}

	// Try linear state-machine parsing next (works well when each OCR block
	// is a single token like "1.D-二聚体.", "<220", "ug/L FEU")
	items = parseLinear(results)
	if len(items) > 0 {
		log.Printf("[ocr_parser] parsed %d items from linear block parsing", len(items))
		return items
	}

	// Fallback: Some blocks contain entire lines (e.g., "白细胞计数 5.2 10^9/L 3.5-9.5").
	// Join blocks with newlines so each block becomes a line, then use content-level parsing
	// which splits each line into individual tokens for proper classification.
	texts := collectTexts(results)
	log.Printf("[ocr_parser] trying content-level parsing with %d blocks", len(results))
	allText := strings.Join(texts, "\n")
	items = parseContentText(allText)
	log.Printf("[ocr_parser] content-level parsing produced %d items", len(items))
	return items
}

// collectTexts extracts all text strings from OCRResults.
func collectTexts(results []OCRResult) []string {
	out := make([]string, 0, len(results))
	for _, r := range results {
		if r.Text != "" {
			out = append(out, r.Text)
		}
	}
	return out
}

// ----------------------------------------------------------------------------
// Path 1: structured parsing from SubImages blocks
// ----------------------------------------------------------------------------

func parseStructured(results []OCRResult) []ParsedLabItem {
	// If results have bounding boxes with coordinates, try grouping by Row
	// (my parseOCRResponse in ocr_service.go assigns Row based on Y-coordinate)
	// Also allow Row-based grouping even without coordinates (Row may be assigned
	// from Y-position grouping in ocr_service.go even when CenterX/CenterY are 0).
	hasCoords := false
	hasRows := false
	rowSet := make(map[int]bool)
	for _, r := range results {
		if r.Left != 0 || r.Top != 0 {
			hasCoords = true
		}
		rowSet[r.Row] = true
	}
	hasRows = len(rowSet) > 1 // Multiple distinct rows indicate meaningful grouping

	if !hasCoords && !hasRows {
		return nil
	}

	// Group by Row (each row = one test item)
	rowMap := make(map[int][]OCRResult)
	rowOrder := make([]int, 0)
	for _, r := range results {
		if _, exists := rowMap[r.Row]; !exists {
			rowOrder = append(rowOrder, r.Row)
		}
		rowMap[r.Row] = append(rowMap[r.Row], r)
	}
	sort.Ints(rowOrder)

	if len(rowMap) == 0 {
		return nil
	}

	// Sort rows by page then row order
	var items []ParsedLabItem
	for _, rowIdx := range rowOrder {
		blocks := rowMap[rowIdx]
		if len(blocks) == 0 {
			continue
		}

		// Sort blocks in this row by X coordinate (left-to-right)
		sortByX(blocks)

		// Extract texts and classify
		texts := make([]string, 0, len(blocks))
		for _, b := range blocks {
			if b.Text != "" {
				texts = append(texts, b.Text)
			}
		}
		if len(texts) == 0 {
			continue
		}
		texts = mergeSplitDecimals(texts)

		// Classify each field
		fields := classifyFields(texts)

		// Check if this row looks like a header (only noise/unit/range, no name)
		hasName := false
		for _, f := range fields {
			if f.kind == "name" {
				hasName = true
				break
			}
		}
		if !hasName {
			continue
		}

		// Group fields into item
		item := groupIntoItem(fields, blocks)
		if item != nil {
			items = append(items, *item)
		}
	}

	return items
}

type classifiedField struct {
	text string
	kind string // "name", "value", "range", "unit", "noise"
}

// classifyFields classifies a sorted list of text fields from one table row.
func classifyFields(texts []string) []classifiedField {
	fields := make([]classifiedField, 0, len(texts))
	for _, t := range texts {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		kind := classifyText(t)
		if kind != "noise" {
			fields = append(fields, classifiedField{text: t, kind: kind})
		}
	}
	return fields
}

// groupIntoItem groups classified fields into a ParsedLabItem.
// Uses a decision tree rather than state machine for robustness.
// Handles the common lab report layout: name → value → [range] → [unit]
// where <X/>X formats can be either value or range depending on position.
func groupIntoItem(fields []classifiedField, blocks []OCRResult) *ParsedLabItem {
	if len(fields) == 0 {
		return nil
	}

	var name, value, unit, rng string
	var conf float64
	var bbox string

	// 从同一行的所有OCR块中取最大置信度作为该item的置信度
	// 不依赖文本匹配，因为mergeSplitDecimals可能改变了文本导致匹配失败
	for _, b := range blocks {
		conf = maxConf(conf, b.Confidence)
	}
	// 如果所有OCR块的置信度都为0（API未返回），给一个合理的默认值
	if conf == 0 {
		conf = 85
	}

	// Find the name (first "name" field), then assign remaining fields
	// using positional context: first value-like field = result value,
	// second value-like field (if no explicit range) = reference range.
	nameFound := false
	valueCount := 0
	for _, f := range fields {
		if !nameFound && f.kind == "name" {
			name = f.text
			nameFound = true
			// Get bbox from the original block matching this text
			for _, b := range blocks {
				if strings.Contains(b.Text, f.text) || strings.Contains(f.text, b.Text) {
					if bbox == "" {
						bbox = bboxJSON(b.Left, b.Top, b.Width, b.Height, b.PageIndex)
					}
				}
			}
		} else if nameFound {
			switch f.kind {
			case "value":
				valueCount++
				if valueCount == 1 {
					// First value after name = result value
					value = f.text
				} else if valueCount == 2 && rng == "" {
					// Second value after name with no explicit range = reference range
					// (e.g., "<220" as value, "<500" as range)
					rng = f.text
				} else if value == "" {
					value = f.text
				}
				for _, b := range blocks {
					if strings.Contains(b.Text, f.text) || strings.Contains(f.text, b.Text) {
						conf = maxConf(conf, b.Confidence)
						if bbox == "" {
							bbox = bboxJSON(b.Left, b.Top, b.Width, b.Height, b.PageIndex)
						}
					}
				}
			case "range":
				if rng == "" {
					rng = f.text
				}
			case "unit":
				if unit == "" {
					unit = f.text
				}
			}
		}
	}

	if name == "" || value == "" {
		return nil
	}

	return &ParsedLabItem{
		Name:       name,
		Value:      value,
		Unit:       unit,
		Range:      rng,
		Confidence: int(conf),
		BBox:       bbox,
		RowText:    strings.Join(fieldsToStrings(fields), " | "),
	}
}

func fieldsToStrings(fields []classifiedField) []string {
	out := make([]string, len(fields))
	for i, f := range fields {
		out[i] = f.text
	}
	return out
}

func sortByX(blocks []OCRResult) {
	for i := 0; i < len(blocks); i++ {
		for j := i + 1; j < len(blocks); j++ {
			if blocks[i].Left > blocks[j].Left {
				blocks[i], blocks[j] = blocks[j], blocks[i]
			}
		}
	}
}

// ----------------------------------------------------------------------------
// Path 2: linear state-machine parsing (no row group available)
// ----------------------------------------------------------------------------

func parseLinear(results []OCRResult) []ParsedLabItem {
	blockTexts := collectTexts(results)
	if len(blockTexts) == 0 {
		return nil
	}

	// Build a list of classified blocks
	blockTexts = mergeSplitDecimals(blockTexts)

	type cb struct {
		text string
		kind string
		ocr  OCRResult
	}

	var classified []cb
	textIdx := 0
	for _, r := range results {
		if textIdx >= len(blockTexts) {
			break
		}
		t := blockTexts[textIdx]
		textIdx++
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		kind := classifyText(t)
		if kind == "noise" {
			continue
		}
		classified = append(classified, cb{text: t, kind: kind, ocr: r})
	}

	// State machine
	type state int
	const (
		sName state = iota
		sVal
		sValUnit // have value + optional unit, waiting for range or next name
		sValRng  // have value + range, waiting for unit or next name
	)

	var items []ParsedLabItem
	st := sName
	var curName, curVal, curUnit, curRng string
	var curConf float64
	var curBBox string
	var lastUnit string // for unit inheritance when OCR omits repeated units

	// Known default units for specific test items (when OCR omits the unit)
	defaultUnitMap := map[string]string{
		"平均红细胞体积": "fl", "MCV": "fl",
		"平均血红蛋白含量": "pg", "MCH": "pg",
		"平均血红蛋白浓度": "g/L", "MCHC": "g/L",
		"红细胞分布宽度": "%", "RDW": "%", "RDW-CV": "%", "RDW-SD": "fl",
		"血小板分布宽度": "fl", "PDW": "fl",
		"平均血小板体积": "fl", "MPV": "fl",
		"血小板压积": "%", "PCT": "%",
	}

	tryEmit := func() {
		if curName != "" && curVal != "" {
			unit := curUnit
			if unit == "" {
				// First check known default units
				if du, ok := defaultUnitMap[curName]; ok {
					unit = du
				} else if lastUnit != "" {
					// Fallback: inherit from previous item
					unit = lastUnit
				}
			}
			items = append(items, ParsedLabItem{
				Name:       curName,
				Value:      curVal,
				Unit:       unit,
				Range:      curRng,
				Confidence: int(curConf),
				BBox:       curBBox,
			})
			if unit != "" {
				lastUnit = unit
			}
		}
		curName, curVal, curUnit, curRng = "", "", "", ""
		curConf = 0
		curBBox = ""
	}

	startNewName := func(text string, ocr OCRResult) {
		curName = text
		curConf = ocr.Confidence
		curBBox = bboxJSON(ocr.Left, ocr.Top, ocr.Width, ocr.Height, ocr.PageIndex)
		st = sName
	}

	for _, b := range classified {
		switch st {
		case sName:
			switch b.kind {
			case "name":
				startNewName(b.text, b.ocr)
			case "value":
				curVal = b.text
				curConf = maxConf(curConf, b.ocr.Confidence)
				if curBBox == "" {
					curBBox = bboxJSON(b.ocr.Left, b.ocr.Top, b.ocr.Width, b.ocr.Height, b.ocr.PageIndex)
				}
				st = sVal
			case "range":
				v := extractNumericValueStr(b.text)
				if v != "" {
					curVal = v
				}
				r := extractNormalRangeStr(b.text)
				if r != "" {
					curRng = r
				}
				curConf = maxConf(curConf, b.ocr.Confidence)
				if curBBox == "" {
					curBBox = bboxJSON(b.ocr.Left, b.ocr.Top, b.ocr.Width, b.ocr.Height, b.ocr.PageIndex)
				}
				st = sValRng
			case "unit":
				curUnit = b.text
				curConf = maxConf(curConf, b.ocr.Confidence)
				// No name yet, just remember unit and keep looking for name
			}

		case sVal:
			switch b.kind {
			case "value":
				// Second value after name with no range/unit — treat as reference range
				if curRng == "" {
					curRng = b.text
					st = sValRng
				} else {
					curVal = b.text
					curConf = maxConf(curConf, b.ocr.Confidence)
				}
			case "unit":
				curUnit = b.text
				curConf = maxConf(curConf, b.ocr.Confidence)
				st = sValUnit
			case "range":
				curRng = b.text
				curConf = maxConf(curConf, b.ocr.Confidence)
				st = sValRng
			case "name":
				tryEmit()
				startNewName(b.text, b.ocr)
			}

		case sValUnit:
			// Have: name + value + unit. Looking for range or next item.
			switch b.kind {
			case "range":
				curRng = b.text
				curConf = maxConf(curConf, b.ocr.Confidence)
				tryEmit()
				st = sName
			case "name":
				tryEmit()
				startNewName(b.text, b.ocr)
			case "value":
				// Another value could mean missing range; emit current, start new value
				tryEmit()
				curVal = b.text
				curConf = b.ocr.Confidence
				curBBox = bboxJSON(b.ocr.Left, b.ocr.Top, b.ocr.Width, b.ocr.Height, b.ocr.PageIndex)
				st = sVal
			default:
				// unit/range/noise → emit and reset
				tryEmit()
				st = sName
				if b.kind == "name" {
					startNewName(b.text, b.ocr)
				}
			}

		case sValRng:
			// Have: name + value + range. Looking for unit or next item.
			switch b.kind {
			case "unit":
				curUnit = b.text
				curConf = maxConf(curConf, b.ocr.Confidence)
				tryEmit()
				st = sName
			case "name":
				tryEmit()
				startNewName(b.text, b.ocr)
			case "value", "range":
				// Another value/range — emit current and restart with this
				tryEmit()
				curVal = b.text
				curConf = b.ocr.Confidence
				curBBox = bboxJSON(b.ocr.Left, b.ocr.Top, b.ocr.Width, b.ocr.Height, b.ocr.PageIndex)
				if b.kind == "range" {
					st = sValRng
				} else {
					st = sVal
				}
			default:
				tryEmit()
				st = sName
				if b.kind == "name" {
					startNewName(b.text, b.ocr)
				}
			}
		}
	}
	// Emit last item if it has name+value
	if curName != "" && curVal != "" {
		items = append(items, ParsedLabItem{
			Name:       curName,
			Value:      curVal,
			Unit:       curUnit,
			Range:      curRng,
			Confidence: int(curConf),
			BBox:       curBBox,
		})
	}

	return items
}

// ----------------------------------------------------------------------------
// Path 3: Content-level parsing (when SubImages not available)
// ----------------------------------------------------------------------------

func parseContentText(content string) []ParsedLabItem {
	if content == "" {
		return nil
	}

	// Split by newlines to get candidate rows
	lines := strings.Split(content, "\n")
	var allItems []ParsedLabItem

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Split line into fields by whitespace
		tokens := strings.Fields(line)
		if len(tokens) < 2 {
			continue
		}

		// Classify each token
		fields := classifyFields(tokens)
		if len(fields) < 2 {
			continue
		}

		// Check if there's at least one name in this line
		hasName := false
		for _, f := range fields {
			if f.kind == "name" {
				hasName = true
				break
			}
		}
		if !hasName {
			continue
		}

		// Group into an item using positional context
		var name, value, unit, rng string
		valueCount := 0
		for _, f := range fields {
			switch f.kind {
			case "name":
				if name == "" {
					name = f.text
				}
			case "value":
				valueCount++
				if valueCount == 1 {
					value = f.text
				} else if valueCount == 2 && rng == "" {
					rng = f.text
				} else if value == "" {
					value = f.text
				}
			case "unit":
				if unit == "" {
					unit = f.text
				}
			case "range":
				if rng == "" {
					rng = f.text
				}
			}
		}

		if name != "" && value != "" {
			allItems = append(allItems, ParsedLabItem{
				Name:       name,
				Value:      value,
				Unit:       unit,
				Range:      rng,
				Confidence: 95, // Content-level parsed items default to 95%
			})
		}
	}

	return allItems
}

// ----------------------------------------------------------------------------
// Text classification helpers
// ----------------------------------------------------------------------------

// classifyText determines the type of an OCR text block.
func classifyText(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "noise"
	}

	// 1. Check header/footer noise
	if isHeaderFooterNoise(s) {
		return "noise"
	}

	// 2. Check if it's a pure unit string
	if isKnownUnitStr(s) {
		return "unit"
	}

	// 3. Check range pattern (interval like 3.5-9.5)
	if isRangeStr(s) {
		return "range"
	}

	// 4. Check pure numeric
	if isPureNumeric(s) {
		return "value"
	}

	// 5. Check bound value (<X or >X format, e.g., "<220", ">100")
	// These are common in lab results and should be classified as value.
	// The parser uses positional context to distinguish result vs reference.
	if isBoundValue(s) {
		return "value"
	}

	// 6. Check if it's an English lab abbreviation (ALT, AST, HbA1c, etc.)
	if isEnglishAbbrev(s) {
		return "name"
	}

	// 7. Check Chinese name
	if isNameLikeStr(s) {
		return "name"
	}

	// 8. Fallback: if it has Chinese characters, it's likely a name
	if containsChinese(s) {
		return "name"
	}

	// 9. Short all-letter strings could be abbreviations (but single letters
	// like "U", "L" are more likely OCR fragments than test names)
	if len(s) >= 2 && len(s) <= 8 && isAllLetters(s) {
		return "name"
	}

	// 10. Qualitative result symbols (-, +, ±, 1+~4+)
	if isQualitativeValue(s) {
		return "value"
	}

	// Everything else is noise
	return "noise"
}

// isBoundValue checks if text is a bound value like <220, >100, ≤500, ≥10.
func isBoundValue(s string) bool {
	s = strings.TrimSpace(s)
	if matched, _ := regexp.MatchString(`^[<>≤≥]\s*\d+(?:\.\d+)?$`, s); matched {
		return true
	}
	return false
}

// isQualitativeValue checks if text is a qualitative result like -, +, ±, 1+~4+.
func isQualitativeValue(s string) bool {
	qualitative := map[string]bool{
		"-": true, "+": true, "±": true,
		"1+": true, "2+": true, "3+": true, "4+": true,
	}
	return qualitative[s]
}

// isEnglishAbbrev checks if string is an English medical abbreviation.
func isEnglishAbbrev(s string) bool {
	// Common lab test abbreviations (uppercased)
	abbrevs := map[string]bool{
		"ALT": true, "AST": true, "GGT": true, "ALP": true, "LDH": true,
		"CK": true, "CK-MB": true, "LD": true, "HBDH": true,
		"BUN": true, "CRE": true, "UA": true, "CYS-C": true,
		"TC": true, "TG": true, "HDL-C": true, "LDL-C": true,
		"APOA": true, "APOB": true, "LPA": true,
		"FBG": true, "HbA1c": true, "FPG": true,
		"TSH": true, "FT3": true, "FT4": true, "T3": true, "T4": true,
		"CRP": true, "ESR": true, "PCT": true, "IL-6": true,
		"WBC": true, "RBC": true, "HGB": true, "HCT": true,
		"MCV": true, "MCH": true, "MCHC": true, "RDW": true,
		"PLT": true, "MPV": true, "PDW": true,
		"NEUT": true, "LYMPH": true, "MONO": true, "EO": true, "BASO": true,
		"CR": true, "GLU": true, "HDL": true, "LDL": true,
		// D-Dimer related
		"DD": true, "D-D": true, "D-Dimer": true, "FEU": true,
	}
	upper := strings.ToUpper(s)
	if abbrevs[upper] {
		return true
	}

	// Pattern: letter-digit-letter like "A1c", "C3", "C4"
	if matched, _ := regexp.MatchString(`^[A-Za-z]+\d[A-Za-z0-9]*$`, s); matched {
		return true
	}

	return false
}

// isAllLetters checks if string contains only letters.
func isAllLetters(s string) bool {
	for _, r := range s {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || r == '-' || r == '/') {
			return false
		}
	}
	return len(s) > 0
}

// isHeaderFooterNoise checks if text is a known header/footer string.
func isHeaderFooterNoise(s string) bool {
	noisePatterns := []string{
		"检验报告单", "急诊", "病历号", "就诊卡号",
		"姓名", "年龄", "性别", "样本", "科室", "诊断", "开单", "检验者",
		"审核者", "采集", "接收", "报告时间", "地址", "电话",
		"实验项目", "结果", "参考区间", "单位",
		"NO.", "本报告", "备注", "序号", "编号", "标本",
		// Additional noise patterns for common lab report headers/footers
		"浙江大学", "附属", "医院", "血浆", "测定",
		"就诊卡", "报告单", "仅对所检测", "如有疑问", "及时联系",
		"请结合临床", "并不提示",
		// Clinical notes/explanations (※-prefixed notes, probability statements)
		"概率", "排除", "血栓发", "静脉血栓",
	}
	lower := strings.ToLower(s)
	for _, p := range noisePatterns {
		if strings.Contains(lower, strings.ToLower(p)) {
			return true
		}
	}

	// Date patterns like "2026-05-06" or "2026年05月06日"
	if matched, _ := regexp.MatchString(`^\d{2,4}[-/年]\d{1,2}[-/月]\d{1,2}`, s); matched {
		return true
	}

	// Date-time patterns like "2026-04-2703：49" (OCR-merged date+time)
	if matched, _ := regexp.MatchString(`^\d{4}\d{2}\d{2}\d{2}[：:]\d{2}`, s); matched {
		return true
	}

	// Short pure numbers (likely sequence/page numbers, not values)
	// But allow "0" as a valid lab result value
	if matched, _ := regexp.MatchString(`^[1-9]\d{0,2}$`, s); matched && len(s) <= 3 {
		// Single/double/triple digit numbers 1-999 without leading zero
		// Could be sequence numbers, but also valid values.
		// Only filter very short numbers that look like page/sequence numbers.
		if len(s) <= 2 {
			return true
		}
	}

	// Pure number with trailing punctuation like "1." "2." (item numbers)
	if matched, _ := regexp.MatchString(`^\d{1,2}[.．、,，]$`, s); matched {
		return true
	}

	// "项目" is a specific header word (not part of test item names)
	if s == "项目" || s == "检验项目" {
		return true
	}

	// Long Chinese text blocks (likely clinical notes, not test item names)
	// Test item names are typically short (≤20 chars). Longer Chinese text
	// is almost always explanatory notes or disclaimers.
	chineseCount := 0
	for _, r := range s {
		if r >= 0x4E00 && r <= 0x9FFF {
			chineseCount++
		}
	}
	if chineseCount > 10 {
		return true
	}

	// Text starting with ※ is always a clinical note/disclaimer
	if strings.HasPrefix(s, "※") || strings.HasPrefix(s, "*") {
		return true
	}

	// Person names (2-3 Chinese characters without any lab-related keywords)
	// This is a heuristic: short Chinese-only strings that don't look like test names
	if isPersonNameLike(s) {
		return true
	}

	return false
}

// isPersonNameLike checks if a string looks like a Chinese person name
// (2-3 Chinese characters, no lab-related suffixes like "计数", "比率", "蛋白" etc.).
func isPersonNameLike(s string) bool {
	// Must be pure Chinese, 2-3 characters
	if !containsChinese(s) {
		return false
	}
	// Remove any Chinese characters and check if anything remains
	allChinese := true
	chineseCount := 0
	for _, r := range s {
		if r >= 0x4E00 && r <= 0x9FFF {
			chineseCount++
		} else {
			allChinese = false
			break
		}
	}
	if !allChinese || chineseCount < 2 || chineseCount > 3 {
		return false
	}

	// Common Chinese person name characters (family names + given names)
	// If the string is a known test item name, it's not a person name
	labSuffixes := []string{
		"计数", "比率", "蛋白", "测定", "定量", "体积", "宽度", "分布",
		"酶", "激酶", "转氨酶", "脱氢酶", "同工酶", "肌酸", "磷酸",
		"红细胞", "白细胞", "血小板", "血红蛋白", "红细胞", "血小板",
		"葡萄糖", "尿酸", "肌酐", "尿素", "胆固醇", "甘油三酯",
		"高密度", "低密度", "脂蛋白", "载脂蛋白", "纤维蛋白",
		"凝血", "活化", "部分", "凝血酶", "国际", "标准化",
		"甲胎", "癌胚", "糖类", "神经元", "特异性", "烯醇化",
		"细胞", "角蛋白", "片段", "鳞状", "细胞癌", "抗原",
		"前列腺", "特异性", "抗原", "游离", "总", "直接", "间接",
		"胆红素", "转肽酶", "碱性磷酸酶", "淀粉酶", "脂肪酶",
		"胆碱酯酶", "前白蛋白", "视黄醇", "结合蛋白", "铁蛋白",
		"转铁蛋白", "铜蓝蛋白", "C反应", "降钙素", "原", "免疫",
		"球蛋白", "补体", "免疫球蛋白", "类风湿", "因子", "抗核",
		"抗体", "抗双链", "DNA", "抗Smith", "抗SSA", "抗SSB",
		"抗线粒体", "抗平滑肌", "抗核周", "抗角蛋白", "抗体",
	}
	for _, suffix := range labSuffixes {
		if strings.Contains(s, suffix) {
			return false
		}
	}

	// Common Chinese family names (top 20)
	familyNames := "王李张刘陈杨赵黄周吴徐孙胡朱高林何郭马罗"
	runes := []rune(s)
	if len(runes) >= 1 {
		for _, fn := range familyNames {
			if runes[0] == fn {
				return true
			}
		}
	}

	return false
}

// isKnownUnitStr checks if the entire string is a known lab unit.
func isKnownUnitStr(s string) bool {
	s = strings.TrimSpace(s)
	knownUnits := []string{
		"×10^9/L", "10E9/L", "10^9/L", "x109/L",
		"×10^12/L", "10E12/L", "10^12/L",
		"μmol/L", "mmol/L", "mol/L",
		"mg/dL", "μg/dL",
		"mg/L", "μg/L", "ng/L", "ng/mL",
		"mU/L", "IU/L", "kU/L", "U/L",
		"g/L", "g/dL",
		"fl", "fL", "pg", "mm/h",
		// D-Dimer units
		"ug/L FEU", "μg/L FEU", "mg/L FEU",
		"ug/L", "FEU",
		// Additional common units
		"umol/L", "nmol/L", "pmol/L",
		"mg/dl", "ug/dl", "ng/dl",
		"U/ml", "mU/ml", "IU/ml",
		"cells/μL", "cells/uL",
		"s", "sec", "min",
		"Ratio", "%",
	}
	sUpper := strings.ToUpper(s)
	for _, u := range knownUnits {
		if sUpper == strings.ToUpper(u) {
			return true
		}
	}

	// Single percent sign
	if s == "%" || s == "％" {
		return true
	}

	// Pattern: number + unit like "10^9/L", "10^12/L"
	if matched, _ := regexp.MatchString(`^10\^\d+/[Ll]$`, s); matched {
		return true
	}

	return false
}

// isRangeStr checks if text matches a reference range pattern.
// Only matches X-Y or X~Y interval format. <X and >X are classified as "value"
// because in lab reports they are more commonly result values (e.g., "<220")
// than reference bounds, and the parser uses positional context to distinguish.
func isRangeStr(s string) bool {
	s = strings.TrimSpace(s)
	// X-Y or X~Y format (with optional leading < or >)
	if matched, _ := regexp.MatchString(`^[<>]?\s*\d+(?:\.\d+)?\s*[~\-－—]\s*\d+(?:\.\d+)?$`, s); matched {
		return true
	}
	return false
}

// isPureNumeric checks if text is a pure number or decimal (possibly with sign).
func isPureNumeric(s string) bool {
	s = strings.TrimSpace(s)
	// Numbers with optional leading +/- and optional decimal point
	if matched, _ := regexp.MatchString(`^[-+]?\d+\.?\d*$`, s); matched {
		return true
	}
	// Decimal starting with dot: ".7"
	if matched, _ := regexp.MatchString(`^[-+]?\.\d+$`, s); matched {
		return true
	}
	return false
}

// isNameLikeStr checks if text looks like a test item name in Chinese.
func isNameLikeStr(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}

	// Must contain Chinese characters
	if !containsChinese(s) {
		return false
	}

	// If it looks like noise, skip
	if isHeaderFooterNoise(s) {
		return false
	}

	return true
}

// containsChinese checks if the string contains any CJK characters.
func containsChinese(s string) bool {
	for _, r := range s {
		if r >= 0x4E00 && r <= 0x9FFF {
			return true
		}
	}
	return false
}

// containsWhitespace checks if the string contains internal whitespace.
func containsWhitespace(s string) bool {
	return strings.Contains(s, " ") || strings.Contains(s, "\t")
}

// ----------------------------------------------------------------------------
// Extraction helpers
// ----------------------------------------------------------------------------

// extractNumericValueStr extracts a numeric value from a string.
func extractNumericValueStr(s string) string {
	re := regexp.MustCompile(`[-+]?\d*\.?\d+`)
	matches := re.FindAllString(s, -1)
	if len(matches) > 0 {
		val := matches[0]
		if strings.HasPrefix(val, ".") {
			val = "0" + val
		}
		return val
	}
	return ""
}

// extractNormalRangeStr extracts a reference range pattern from a string.
func extractNormalRangeStr(s string) string {
	re := regexp.MustCompile(`[<>]?\s*\d+(?:\.\d+)?\s*[~\-－—]\s*\d+(?:\.\d+)?`)
	if match := re.FindString(s); match != "" {
		return strings.TrimSpace(match)
	}
	re2 := regexp.MustCompile(`[<>]\s*\d+(?:\.\d+)?`)
	if match := re2.FindString(s); match != "" {
		return strings.TrimSpace(match)
	}
	return ""
}

// mergeSplitDecimals merges OCR-split decimal numbers.
func mergeSplitDecimals(texts []string) []string {
	if len(texts) < 2 {
		return texts
	}

	reInt := regexp.MustCompile(`^\d+$`)
	reIntDot := regexp.MustCompile(`^\d+\.$`)
	reDotDec := regexp.MustCompile(`^\.\d+$`)

	var merged []string
	i := 0
	for i < len(texts) {
		if i+1 < len(texts) {
			cur := texts[i]
			next := texts[i+1]

			if reInt.MatchString(cur) && reDotDec.MatchString(next) {
				merged = append(merged, cur+next)
				i += 2
				continue
			}

			if reIntDot.MatchString(cur) && reInt.MatchString(next) && len(next) <= 3 {
				merged = append(merged, cur+next)
				i += 2
				continue
			}
		}
		merged = append(merged, texts[i])
		i++
	}
	return merged
}

// ----------------------------------------------------------------------------
// BBox and utilities
// ----------------------------------------------------------------------------

func bboxJSON(left, top, width, height, page int) string {
	return `{"x":` + itoa(left) + `,"y":` + itoa(top) + `,"w":` + itoa(width) + `,"h":` + itoa(height) + `,"page":` + itoa(page) + `}`
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func maxConf(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}
