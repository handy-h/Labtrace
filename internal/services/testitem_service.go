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

	updated := 0
	for _, it := range items {
		matchID := MatchTestItemByName(it.name)
		if matchID > 0 {
			database.DB.Exec(`UPDATE report_items SET test_item_id = ? WHERE id = ?`, matchID, it.id)
			updated++
		}
	}
	return updated
}
