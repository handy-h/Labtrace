package services

import (
	"encoding/json"
	"log"

	"labtrace/internal/database"
)

type auditEntry struct {
	action      string
	actionLabel string
	entityType  string
	entityID    int64
	details     string
}

var auditLogChan = make(chan auditEntry, 100)

// InitAuditWorker 启动后台审计日志写入 goroutine，应在数据库初始化后调用。
func InitAuditWorker() {
	go func() {
		for entry := range auditLogChan {
			if _, err := database.DB.Exec(
				`INSERT INTO audit_logs (action, action_label, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)`,
				entry.action, entry.actionLabel, entry.entityType, entry.entityID, entry.details,
			); err != nil {
				log.Printf("[audit] 写入审计日志失败: %v", err)
			}
		}
	}()
}

// LogAction records an action in the audit log (async via channel).
func LogAction(action, actionLabel, entityType string, entityID int64, details interface{}) {
	detailsJSON := "{}"
	if d, err := json.Marshal(details); err == nil {
		detailsJSON = string(d)
	}

	select {
	case auditLogChan <- auditEntry{action, actionLabel, entityType, entityID, detailsJSON}:
	default:
		// Channel full, fallback to synchronous write to avoid blocking the request
		if _, err := database.DB.Exec(
			`INSERT INTO audit_logs (action, action_label, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)`,
			action, actionLabel, entityType, entityID, detailsJSON,
		); err != nil {
			log.Printf("[audit] 同步回退写入审计日志失败: %v", err)
		}
	}
}
