package services

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"

	"labtrace/internal/database"
)

type auditEntry struct {
	action      string
	actionLabel string
	entityType  string
	entityID    int64
	details     string
}

// getAuditHMACKey returns the HMAC key for audit log signing from the AUDIT_HMAC_KEY environment variable.
// Returns nil if not configured.
func getAuditHMACKey() []byte {
	key := os.Getenv("AUDIT_HMAC_KEY")
	if key == "" {
		return nil
	}
	return []byte(key)
}

// signAuditPayload computes HMAC-SHA256 over the audit entry fields and returns the hex-encoded signature.
func signAuditPayload(entry auditEntry, key []byte) string {
	if key == nil {
		return ""
	}
	mac := hmac.New(sha256.New, key)
	payload := fmt.Sprintf("%s|%s|%s|%d|%s", entry.action, entry.actionLabel, entry.entityType, entry.entityID, entry.details)
	mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

// auditLogChan 容量较小，写入采用非阻塞 + 同步回退策略。
var auditLogChan = make(chan auditEntry, 100)

// auditDone 用于通知审计 worker 优雅退出。
var auditDone = make(chan struct{})

// InitAuditWorker 启动后台审计日志写入 goroutine，应在数据库初始化后调用。
func InitAuditWorker() {
	go func() {
		hmacKey := getAuditHMACKey()
		for {
			select {
			case entry := <-auditLogChan:
				sig := signAuditPayload(entry, hmacKey)
				if _, err := database.DB.Exec(
					`INSERT INTO audit_logs (action, action_label, entity_type, entity_id, details, signature) VALUES (?, ?, ?, ?, ?, ?)`,
					entry.action, entry.actionLabel, entry.entityType, entry.entityID, entry.details, sig,
				); err != nil {
					log.Printf("[audit] 写入审计日志失败: %v", err)
				}
			case <-auditDone:
				// 收到退出信号：把缓冲区剩余日志全部落库后再返回
				drainAuditChannel()
				return
			}
		}
	}()
}

// StopAuditWorker 通知审计 worker 退出，并等待其把缓冲区内的剩余日志写入 DB。
// 应在 HTTP server 关闭、后台 OCR goroutine 都完成之后再调用。
func StopAuditWorker() {
	close(auditDone)
}

// drainAuditChannel 在 worker 退出前同步消费通道内剩余日志。
func drainAuditChannel() {
	hmacKey := getAuditHMACKey()
	for {
		select {
		case entry := <-auditLogChan:
			sig := signAuditPayload(entry, hmacKey)
			if _, err := database.DB.Exec(
				`INSERT INTO audit_logs (action, action_label, entity_type, entity_id, details, signature) VALUES (?, ?, ?, ?, ?, ?)`,
				entry.action, entry.actionLabel, entry.entityType, entry.entityID, entry.details, sig,
			); err != nil {
				log.Printf("[audit] 退出前写入审计日志失败: %v", err)
			}
		default:
			return
		}
	}
}

// LogAction records an action in the audit log (async via channel).
func LogAction(action, actionLabel, entityType string, entityID int64, details interface{}) {
	detailsJSON := "{}"
	if d, err := json.Marshal(details); err == nil {
		detailsJSON = string(d)
	}

	entry := auditEntry{action, actionLabel, entityType, entityID, detailsJSON}

	select {
	case auditLogChan <- entry:
	default:
		// Channel full, fallback to synchronous write to avoid blocking the request
		hmacKey := getAuditHMACKey()
		sig := signAuditPayload(entry, hmacKey)
		if _, err := database.DB.Exec(
			`INSERT INTO audit_logs (action, action_label, entity_type, entity_id, details, signature) VALUES (?, ?, ?, ?, ?, ?)`,
			action, actionLabel, entityType, entityID, detailsJSON, sig,
		); err != nil {
			log.Printf("[audit] 同步回退写入审计日志失败: %v", err)
		}
	}
}

// VerifyAuditIntegrity checks all audit_log rows with a signature and reports any tampered entries.
// Returns a list of tampered entry IDs and counts of verified entries.
// Entries without a signature (pre-migration) are skipped.
func VerifyAuditIntegrity() (tamperedIDs []int64, verifiedCount int, err error) {
	hmacKey := getAuditHMACKey()
	if hmacKey == nil {
		return nil, 0, fmt.Errorf("AUDIT_HMAC_KEY not configured")
	}

	rows, qErr := database.DB.Query(`SELECT id, action, action_label, entity_type, entity_id, details, signature FROM audit_logs WHERE signature != ''`)
	if qErr != nil {
		return nil, 0, qErr
	}
	defer rows.Close()

	for rows.Next() {
		var id, entityID int64
		var action, actionLabel, entityType, details, signature string
		if scanErr := rows.Scan(&id, &action, &actionLabel, &entityType, &entityID, &details, &signature); scanErr != nil {
			continue
		}

		mac := hmac.New(sha256.New, hmacKey)
		payload := fmt.Sprintf("%s|%s|%s|%d|%s", action, actionLabel, entityType, entityID, details)
		mac.Write([]byte(payload))
		expectedSig := hex.EncodeToString(mac.Sum(nil))

		if !hmac.Equal([]byte(signature), []byte(expectedSig)) {
			tamperedIDs = append(tamperedIDs, id)
		}
		verifiedCount++
	}
	return tamperedIDs, verifiedCount, nil
}
