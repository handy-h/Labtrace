package database

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "github.com/mattn/go-sqlite3"
)

var DB *sql.DB

// Open opens (or creates) the SQLite database and runs migrations.
// For now we use standard SQLite; AES field-level encryption is applied in service layer.
func Open(dbPath string) error {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create data dir: %w", err)
	}

	var err error
	DB, err = sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		return fmt.Errorf("open db: %w", err)
	}

	DB.SetMaxOpenConns(1) // SQLite single-writer
	DB.SetMaxIdleConns(1)

	if err := DB.Ping(); err != nil {
		return fmt.Errorf("ping db: %w", err)
	}

	if err := migrate(DB); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}

	if err := Seed(DB); err != nil {
		return fmt.Errorf("seed: %w", err)
	}

	return nil
}

func Close() {
	if DB != nil {
		DB.Close()
	}
}