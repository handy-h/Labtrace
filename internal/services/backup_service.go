package services

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"fmt"
	"io"
	"os"
	"sync"
	"time"

	"labtrace/internal/database"
)

// backupMutex 保护 ImportBackup 期间的 Close/Write/Open 序列，防止并发访问。
var backupMutex sync.Mutex

// ExportBackup creates an encrypted backup of the SQLite database.
func ExportBackup(dbKey []byte, dbPath, backupDir, description string) (string, int64, error) {
	// Ensure backup directory exists
	os.MkdirAll(backupDir, 0755)

	plainBytes, err := os.ReadFile(dbPath)
	if err != nil {
		return "", 0, fmt.Errorf("read database: %w", err)
	}

	// Encrypt using AES-256-GCM
	encrypted, err := encryptAESGCM(plainBytes, dbKey)
	if err != nil {
		return "", 0, fmt.Errorf("encrypt: %w", err)
	}

	// Write backup file
	filename := fmt.Sprintf("labtrace_%s.bak", time.Now().Format("20060102_150405"))
	filePath := backupDir + "/" + filename
	if err := os.WriteFile(filePath, encrypted, 0600); err != nil {
		return "", 0, fmt.Errorf("write backup: %w", err)
	}

	fileSize := int64(len(encrypted))

	// Record in database
	if _, err := database.DB.Exec(
		`INSERT INTO backups (filename, description, file_size) VALUES (?, ?, ?)`,
		filename, description, fileSize,
	); err != nil {
		return filename, fileSize, fmt.Errorf("record backup: %w", err)
	}

	return filename, fileSize, nil
}

// ImportBackup restores the database from an encrypted backup file.
func ImportBackup(dbKey []byte, dbPath, filePath string) error {
	encrypted, err := os.ReadFile(filePath)
	if err != nil {
		return fmt.Errorf("read backup: %w", err)
	}

	plainBytes, err := decryptAESGCM(encrypted, dbKey)
	if err != nil {
		return fmt.Errorf("decrypt: %w - key may not match", err)
	}

	// Verify it's a valid SQLite file (starts with "SQLite format 3")
	if len(plainBytes) < 16 || string(plainBytes[:15]) != "SQLite format 3" {
		return fmt.Errorf("invalid database file after decryption")
	}

	// 全局锁保护 Close → Write → Open 序列，防止其他 goroutine 并发访问 DB
	backupMutex.Lock()
	defer backupMutex.Unlock()

	database.Close()

	if err := os.WriteFile(dbPath, plainBytes, 0644); err != nil {
		return fmt.Errorf("write database: %w", err)
	}

	if err := database.Open(dbPath); err != nil {
		return fmt.Errorf("reopen database: %w", err)
	}

	return nil
}

func encryptAESGCM(plainBytes, key []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}

	return gcm.Seal(nonce, nonce, plainBytes, nil), nil
}

func decryptAESGCM(encrypted, key []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonceSize := gcm.NonceSize()
	if len(encrypted) < nonceSize {
		return nil, fmt.Errorf("ciphertext too short")
	}

	nonce, ciphertext := encrypted[:nonceSize], encrypted[nonceSize:]
	return gcm.Open(nil, nonce, ciphertext, nil)
}
