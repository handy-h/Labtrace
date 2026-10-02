package services

import (
	"strings"

	"labtrace/internal/database"
)

// cleanDecorations 去除 OCR 项目名称首尾的装饰字符（*、.、空白等），
// 解决 "D-二聚体."、"*尿酸" 这类本可精确命中却被装饰字符干扰的情况。
func cleanDecorations(name string) string {
	return strings.Trim(name, " *.。　\t")
}

// SpecimenPrefixes 标本前缀：输入/标准名以此前缀开头表示标本类型不同
// （如 尿肌酐 vs 肌酐、24小时尿钙 vs 钙），包含匹配要求两侧前缀一致。
// 导出是为了让 cmd/audit 复用同一份规则——审计工具若自带一份副本就会与实现漂移。
var SpecimenPrefixes = []string{"24小时尿", "尿", "粪", "脑脊液", "胸水", "腹水", "精液"}

// semanticKeywords 语义关键词：只出现在匹配双方其中一侧时，
// 说明是两个不同的检验项目（如 糖化血红蛋白 vs 血红蛋白、降钙素 vs 钙），禁止包含匹配。
// 注意：这些词必须是「限定性」的——出现即改变项目语义，不能是无关紧要的修饰词，
// 否则会误杀合法匹配。
var semanticKeywords = []string{
	"结晶", "沉渣", "抗体", "糖化", "浓度", "含量", "总量", "活性",
	"氧合", "高铁", "还原", "免疫球蛋白", "甲状腺", "肌钙", "降钙", "钙卫",
	"微量", "前白", "同工酶", "碱度", "脑尿钠肽", "肌红", "平均", "有核",
	// 2026-10-02 复核补充：以下 5 个词都是改变项目语义的限定词，
	// 缺失会导致跨项目吸附（实测 离子钙→钙、C反应蛋白→超敏C反应蛋白、脂蛋白a→载脂蛋白A1）。
	"离子", "超敏", "载脂蛋白", "游离", "结合",
}

// containsMatchAllowed 判断 input 与 std 之间的包含匹配是否语义安全。
// 用于第 5 级包含匹配的守卫，防止 "尿肌酐→肌酐"、"磷→碱性磷酸酶" 等误映射。
func containsMatchAllowed(input, std string) bool {
	// 单字符输入过于模糊（如 "磷"→碱性磷酸酶、"β"→β-羟丁酸），一律禁止
	if len([]rune(input)) < 2 {
		return false
	}
	// 比值/复合项目：含分隔符而标准名不含（如 尿素氮/肌酐、谷丙转氨酶/谷草转氨酶）
	for _, sep := range []string{"/", ":", "："} {
		if strings.Contains(input, sep) && !strings.Contains(std, sep) {
			return false
		}
	}
	// 比例/比值：标准名本身不含"比"则禁止（保留 白球比例→白球比）
	for _, kw := range []string{"比值", "比例"} {
		if strings.Contains(input, kw) && !strings.Contains(std, "比") {
			return false
		}
	}
	// 标本前缀必须双方一致：任一侧带标本前缀而另一侧不带，即视为不同标本类型的项目。
	// 【2026-10-02 复核修复】原实现只检查 input 侧（HasPrefix(input,p) && !HasPrefix(std,p)），
	// 当「标准名带前缀、输入不带」时守卫失效，反向包含匹配会把血清短名吸附到尿液项目——
	// 实测 idx.Match("白细胞") 命中「尿白细胞」、("免疫球蛋白IgG") 命中「尿免疫球蛋白IgG」。
	// 改为双向判定后，省略「尿/粪」字的常见写法（比重/酮体/隐血/颜色/蛋白质/pH值…）
	// 由 test_item_aliases 显式登记（第 2 级精确匹配，优先级高于第 5 级包含匹配），
	// 已在尿/粪类项目下登记 23 条此类别名，因此双向收紧不会造成漏匹配。
	for _, p := range SpecimenPrefixes {
		if strings.HasPrefix(input, p) != strings.HasPrefix(std, p) {
			return false
		}
	}
	// 输入含"尿"而标准名不含（如 B-型脑尿钠肽 vs 钠）
	if strings.Contains(input, "尿") && !strings.Contains(std, "尿") {
		return false
	}
	// "尿"+标准名 的尿液版本（如 尿尿素 vs 尿素、尿酸碱度 vs 尿酸）
	if strings.HasPrefix(input, "尿"+std) {
		return false
	}
	// 否定前缀（如 非高密度脂蛋白胆固醇 vs 高密度脂蛋白胆固醇）
	if strings.HasPrefix(input, "非") && !strings.HasPrefix(std, "非") {
		return false
	}
	// 语义关键词必须双方一致（如 肌酸激酶 vs 肌酸激酶同工酶：同工酶不一致，拒绝）
	for _, kw := range semanticKeywords {
		if strings.Contains(input, kw) != strings.Contains(std, kw) {
			return false
		}
	}
	return true
}

// normalizeName removes common suffixes and normalizes the name for matching.
func normalizeName(name string) string {
	name = strings.TrimSpace(name)
	// Remove "(%)" suffix
	name = strings.TrimSuffix(name, "(%)")
	// Remove "%" suffix
	name = strings.TrimSuffix(name, "%")
	// Remove "百分比" suffix (standard name uses this)
	name = strings.TrimSuffix(name, "百分比")
	// Remove "百分数" suffix
	name = strings.TrimSuffix(name, "百分数")
	name = strings.TrimSpace(name)
	return name
}

// 【2026-10-02 复核删除】原 MatchTestItemByName（直连数据库版匹配）已移除：
// 它在生产代码中零调用（3 个调用点全部使用 TestItemIndex.Match），
// 却因候选查询 `SELECT id, standard_name FROM test_items` 无 ORDER BY、
// 走覆盖索引返回名称序，与 TestItemIndex.Match（COALESCE 破坏覆盖索引 → 全表扫描 → id 序）
// 得出不同结果（实测 红细胞→红细胞压积 vs 红细胞计数、血小板→血小板压积 vs 血小板计数）。
// 现全库统一由 TestItemIndex.Match 承担，消除双实现分叉。

// BackfillTestItemIDs sets test_item_id on all report_items where it is NULL.
// Returns the number of items updated.
func BackfillTestItemIDs() int {
	rows, err := database.DB.Query(
		`SELECT id, test_item_name FROM report_items WHERE test_item_id IS NULL AND test_item_name != ''`,
	)
	if err != nil {
		return 0
	}
	defer rows.Close()

	type item struct {
		id   int64
		name string
	}
	var items []item
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.id, &it.name); err == nil {
			items = append(items, it)
		}
	}

	idx := LoadTestItemIndex()
	updated := 0
	for _, it := range items {
		matchID := idx.Match(it.name)
		if matchID > 0 {
			if _, err := database.DB.Exec(`UPDATE report_items SET test_item_id = ? WHERE id = ?`, matchID, it.id); err == nil {
				updated++
			}
		}
	}
	return updated
}

// TestItemCandidate 用于内存匹配的轻量结构。
type TestItemCandidate struct {
	ID       int64
	Name     string
	Category string
}

// TestItemIndex 预加载全部 test_items 和 aliases，供批量内存匹配使用。
type TestItemIndex struct {
	Candidates   []TestItemCandidate
	aliasMap     map[string]int64 // alias_name → test_item_id
	categoryByID map[int64]string // id → category
}

// LoadTestItemIndex 一次性加载全部 test_items 和 aliases 到内存。
func LoadTestItemIndex() *TestItemIndex {
	idx := &TestItemIndex{aliasMap: make(map[string]int64), categoryByID: make(map[int64]string)}

	// ORDER BY id 是刻意加的：包含匹配在「长度并列」时按 id 兜底（见 Match），
	// 若候选顺序不确定，结果就会随查询计划漂移（历史踩坑：DB 版走覆盖索引得到名称序）。
	rows, err := database.DB.Query(`SELECT id, standard_name, COALESCE(category,'') FROM test_items ORDER BY id`)
	if err != nil {
		return idx
	}
	defer rows.Close()
	for rows.Next() {
		var c TestItemCandidate
		if err := rows.Scan(&c.ID, &c.Name, &c.Category); err == nil {
			idx.Candidates = append(idx.Candidates, c)
			idx.categoryByID[c.ID] = c.Category
		}
	}

	arows, err := database.DB.Query(`SELECT alias_name, test_item_id FROM test_item_aliases`)
	if err != nil {
		return idx
	}
	defer arows.Close()
	for arows.Next() {
		var alias string
		var tid int64
		arows.Scan(&alias, &tid)
		idx.aliasMap[alias] = tid
	}
	return idx
}

// Match 在内存中查找 test_item_id，采用级联匹配策略：
// 1) 标准名精确 → 2) 别名精确 → 3) 标准名忽略大小写 → 4) 归一化（去 %/百分比）精确
// → 5) 包含匹配（带 containsMatchAllowed 守卫）。
// 这是全库唯一的匹配实现，BackfillTestItemIDs / 单报告导入 / 批量导入共用。
func (idx *TestItemIndex) Match(name string) int64 {
	if name == "" || len(idx.Candidates) == 0 {
		return 0
	}
	name = cleanDecorations(name)
	if name == "" {
		return 0
	}
	lowerName := strings.ToLower(name)
	normalizedInput := normalizeName(name)

	for _, c := range idx.Candidates {
		if c.Name == name {
			return c.ID
		}
	}
	if id, ok := idx.aliasMap[name]; ok {
		return id
	}
	for _, c := range idx.Candidates {
		if strings.ToLower(c.Name) == lowerName {
			return c.ID
		}
	}
	for _, c := range idx.Candidates {
		if strings.EqualFold(normalizeName(c.Name), normalizedInput) {
			return c.ID
		}
	}
	// 正向包含匹配：输入包含标准名（如 血红蛋白浓度 → 血红蛋白）。
	// 取「最长标准名」优先（更具体的标准名优先），长度并列时取 id 最小者，保证结果确定。
	bestID := int64(0)
	bestLen := 0
	for _, c := range idx.Candidates {
		lowerStd := strings.ToLower(c.Name)
		if !strings.Contains(lowerName, lowerStd) || !containsMatchAllowed(name, c.Name) {
			continue
		}
		if len(c.Name) > bestLen || (len(c.Name) == bestLen && (bestID == 0 || c.ID < bestID)) {
			bestID = c.ID
			bestLen = len(c.Name)
		}
	}
	if bestID > 0 {
		return bestID
	}
	// 反向包含匹配：标准名包含输入（如 红细胞 → 红细胞计数）。
	// 取「最短标准名」优先（假设输入是完整项目名的省略写法），
	// 长度并列时取 id 最小者，保证结果确定、不随候选加载顺序漂移。
	revID := int64(0)
	revLen := int(^uint(0) >> 1)
	for _, c := range idx.Candidates {
		lowerStd := strings.ToLower(c.Name)
		if !strings.Contains(lowerStd, lowerName) || !containsMatchAllowed(name, c.Name) {
			continue
		}
		if len(c.Name) < revLen || (len(c.Name) == revLen && (revID == 0 || c.ID < revID)) {
			revID = c.ID
			revLen = len(c.Name)
		}
	}
	return revID
}

// GetCategory 返回已加载的 test_item 的分类，找不到时返回空字符串。
func (idx *TestItemIndex) GetCategory(id int64) string {
	return idx.categoryByID[id]
}

// AddCandidate 追加新创建的 test_item，避免同批次重复创建同名项目。
func (idx *TestItemIndex) AddCandidate(id int64, name string, category string) {
	idx.Candidates = append(idx.Candidates, TestItemCandidate{ID: id, Name: name, Category: category})
	idx.categoryByID[id] = category
}
