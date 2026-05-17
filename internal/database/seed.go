package database

import "database/sql"

// Seed is intentionally a no-op — no preset data is seeded.
// All test items, reference intervals, unit conversions, etc.
// are populated by the user at runtime.
func Seed(_ *sql.DB) error {
	return nil
}
