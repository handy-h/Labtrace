package services

import (
	"strings"

	"labtrace/internal/database"
)

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

// MatchTestItemByName tries to find a test_item_id for a given test_item_name.
// It uses a cascading match strategy:
// 1. Exact match on test_items.standard_name
// 2. Exact match on test_item_aliases.alias_name
// 3. Case-insensitive match on test_items.standard_name
// 4. Normalized match (strip (%) / 百分比 suffixes)
// 5. Contains match (name contains standard_name or vice versa)
// Returns 0 if no match found.
func MatchTestItemByName(name string) int64 {
	if name == "" {
		return 0
	}
	name = strings.TrimSpace(name)

	// 1. Exact match on standard_name
	var id int64
	err := database.DB.QueryRow(
		`SELECT id FROM test_items WHERE standard_name = ?`, name,
	).Scan(&id)
	if err == nil && id > 0 {
		return id
	}

	// 2. Exact match on alias
	err = database.DB.QueryRow(
		`SELECT test_item_id FROM test_item_aliases WHERE alias_name = ?`, name,
	).Scan(&id)
	if err == nil && id > 0 {
		return id
	}

	// 3. Case-insensitive match on standard_name
	err = database.DB.QueryRow(
		`SELECT id FROM test_items WHERE LOWER(standard_name) = LOWER(?)`, name,
	).Scan(&id)
	if err == nil && id > 0 {
		return id
	}

	// 4. Normalized match: strip (%) / 百分比 suffixes
	normalizedInput := normalizeName(name)
	rows, err := database.DB.Query(
		`SELECT id, standard_name FROM test_items`,
	)
	if err != nil {
		return 0
	}
	defer rows.Close()

	type candidate struct {
		id   int64
		name string
	}
	var candidates []candidate
	for rows.Next() {
		var c candidate
		if err := rows.Scan(&c.id, &c.name); err == nil {
			candidates = append(candidates, c)
		}
	}

	// Try normalized exact match
	for _, c := range candidates {
		normalizedStd := normalizeName(c.name)
		if strings.EqualFold(normalizedInput, normalizedStd) {
			return c.id
		}
	}

	// 5. Contains match: test_item_name contains standard_name or vice versa
	lowerName := strings.ToLower(name)
	bestID := int64(0)
	bestLen := 0
	for _, c := range candidates {
		lowerStd := strings.ToLower(c.name)
		if strings.Contains(lowerName, lowerStd) && len(c.name) > bestLen {
			bestID = c.id
			bestLen = len(c.name)
		}
	}
	if bestID > 0 {
		return bestID
	}

	// Try reverse: standard_name contains the input
	for _, c := range candidates {
		lowerStd := strings.ToLower(c.name)
		if strings.Contains(lowerStd, lowerName) && len(name) > bestLen {
			bestID = c.id
			bestLen = len(name)
		}
	}

	return bestID
}

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

	rows, err := database.DB.Query(`SELECT id, standard_name, COALESCE(category,'') FROM test_items`)
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

// Match 在内存中查找 test_item_id，策略与 MatchTestItemByName 相同，但不查数据库。
func (idx *TestItemIndex) Match(name string) int64 {
	if name == "" || len(idx.Candidates) == 0 {
		return 0
	}
	name = strings.TrimSpace(name)
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
	bestID := int64(0)
	bestLen := 0
	for _, c := range idx.Candidates {
		lowerStd := strings.ToLower(c.Name)
		if strings.Contains(lowerName, lowerStd) && len(c.Name) > bestLen {
			bestID = c.ID
			bestLen = len(c.Name)
		}
	}
	if bestID > 0 {
		return bestID
	}
	for _, c := range idx.Candidates {
		lowerStd := strings.ToLower(c.Name)
		if strings.Contains(lowerStd, lowerName) && len(name) > bestLen {
			bestID = c.ID
			bestLen = len(name)
		}
	}
	return bestID
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
