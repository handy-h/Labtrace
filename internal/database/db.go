package database

import (
	"database/sql"
	"fmt"
	"log"
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
	// _busy_timeout=15000：SQLite 写锁冲突时最多等 15s，缓解并发上传/批量导入/审计写入之间的互锁。
	// （SetMaxOpenConns=2 + WAL 已限制并发，但仍可能出现写事务排队，更长 timeout 让上层少撞 "database is locked"）
	DB, err = sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_foreign_keys=on&_busy_timeout=15000")
	if err != nil {
		return fmt.Errorf("open db: %w", err)
	}

	DB.SetMaxOpenConns(2) // SQLite WAL: 允许并发读+写
	DB.SetMaxIdleConns(2)

	if err := DB.Ping(); err != nil {
		return fmt.Errorf("ping db: %w", err)
	}

	if err := migrate(DB); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}

	return nil
}

func Close() {
	if DB != nil {
		if err := DB.Close(); err != nil {
			log.Printf("close database: %v", err)
		}
		DB = nil
	}
}