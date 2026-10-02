package services

import (
	"crypto/md5"
	"encoding/hex"
	"sort"
	"strings"

	"labtrace/internal/database"
)

// ItemSignature 用于报告内容级去重的条目签名（名称+结果+单位）。
type ItemSignature struct {
	Name  string
	Value string
	Unit  string
}

// normalizeSigPart 归一化签名的单个字段，消除 OCR 输出的无意义差异。
// 【2026-10-02 加固】此前指纹是 name|value|unit 的逐字节 MD5，同一份报告重复导入时
// 只要 OCR 多识别一个空格、单位大小写不同、多出一行空记录，指纹就不同 → 漏拦。
// 这里做保守归一化：只去除空白与统一大小写，**不对数值做任何等价化**
// （"1.5" 与 "1.50" 视为不同，避免把用户改过的值误判为重复）。
func normalizeSigPart(s string) string {
	// 去掉所有空白（半角空格/全角空格/Tab/换行/不换行空格），中文名称内部一般不含空格
	s = strings.Map(func(r rune) rune {
		switch r {
		case ' ', '\t', '\n', '\r', '\u00a0', '\u3000':
			return -1
		}
		return r
	}, s)
	return strings.ToLower(s)
}

// ContentSignature 计算条目集合的内容指纹，与条目顺序无关。
// 背景：文件级 MD5 去重无法拦截「同一内容、不同字节」的重复报告
// （如同一份检验单从不同渠道导出两次），因此增加内容级指纹。
func ContentSignature(items []ItemSignature) string {
	parts := make([]string, 0, len(items))
	for _, it := range items {
		name := normalizeSigPart(it.Name)
		value := normalizeSigPart(it.Value)
		unit := normalizeSigPart(it.Unit)
		// 完全空白的条目（OCR 噪声行）不参与指纹，否则多一行噪声就会导致漏拦
		if name == "" && value == "" && unit == "" {
			continue
		}
		parts = append(parts, name+"|"+value+"|"+unit)
	}
	sort.Strings(parts)
	sum := md5.Sum([]byte(strings.Join(parts, "\n")))
	return hex.EncodeToString(sum[:])
}

// LoadItemSignatures 从 report_items 表加载指定报告的条目签名集合。
func LoadItemSignatures(reportID int64) ([]ItemSignature, error) {
	rows, err := database.DB.Query(
		`SELECT test_item_name, original_value, original_unit FROM report_items WHERE report_id = ?`, reportID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sigs []ItemSignature
	for rows.Next() {
		var s ItemSignature
		if err := rows.Scan(&s.Name, &s.Value, &s.Unit); err != nil {
			continue
		}
		sigs = append(sigs, s)
	}
	return sigs, nil
}

// FindIdenticalReport 在同一受检者 + 同一采样日期下，查找与给定内容指纹完全一致的报告。
// statuses 限定参与比较的报告状态（如 'imported'、'review'）；excludeID 排除自身。
// 找到返回报告 id，未找到返回 0。
func FindIdenticalReport(subjectID int64, sampleDate string, excludeID int64, sig string, statuses ...string) (int64, error) {
	if sig == "" || len(statuses) == 0 {
		return 0, nil
	}

	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(statuses)), ",")
	args := make([]interface{}, 0, len(statuses)+3)
	args = append(args, subjectID, sampleDate, excludeID)
	for _, st := range statuses {
		args = append(args, st)
	}

	rows, err := database.DB.Query(
		`SELECT id FROM lab_reports
		 WHERE subject_id = ? AND sample_date = ? AND id != ? AND ocr_status IN (`+placeholders+`)`,
		args...,
	)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	var candidateIDs []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err == nil {
			candidateIDs = append(candidateIDs, id)
		}
	}

	for _, cid := range candidateIDs {
		sigs, err := LoadItemSignatures(cid)
		if err != nil {
			continue
		}
		if len(sigs) > 0 && ContentSignature(sigs) == sig {
			return cid, nil
		}
	}
	return 0, nil
}
