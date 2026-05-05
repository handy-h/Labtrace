package config

import (
	"encoding/hex"
	"errors"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	DBKey            []byte // 32-byte AES-256 key
	AliAccessKeyID   string
	AliAccessSecret  string
	Port             string
	UploadDir        string
	BackupDir        string
	DBPath           string
}

func Load() (*Config, error) {
	// .env is optional; env vars take precedence
	_ = godotenv.Load()

	cfg := &Config{
		Port:      getEnv("PORT", "8080"),
		UploadDir: getEnv("UPLOAD_DIR", "data/uploads"),
		BackupDir: getEnv("BACKUP_DIR", "data/backups"),
		DBPath:    getEnv("DB_PATH", "data/labtrace.db"),
	}

	// DB key
	keyHex := os.Getenv("DB_KEY")
	if keyHex == "" {
		return nil, errors.New("DB_KEY is required in environment or .env file")
	}
	key, err := hex.DecodeString(keyHex)
	if err != nil {
		return nil, errors.New("DB_KEY must be a valid hex string")
	}
	if len(key) != 32 {
		return nil, errors.New("DB_KEY must be 32 bytes (64 hex chars)")
	}
	cfg.DBKey = key

	// OCR credentials
	cfg.AliAccessKeyID = os.Getenv("ALI_ACCESS_KEY_ID")
	cfg.AliAccessSecret = os.Getenv("ALI_ACCESS_KEY_SECRET")

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}