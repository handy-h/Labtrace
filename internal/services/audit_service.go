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

// auditLogChan 容量较小，写入采用非阻塞 + 同步回退策略。
var auditLogChan = make(chan auditEntry, 100)

// auditDone 用于通知审计 worker 优雅退出。
var auditDone = make(chan struct{})

// InitAuditWorker 启动后台审计日志写入 goroutine，应在数据库初始化后调用。
func InitAuditWorker() {
	go func() {
		for {
			select {
			case entry := <-auditLogChan:
				if _, err := database.DB.Exec(
					`INSERT INTO audit_logs (action, action_label, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)`,
					entry.action, entry.actionLabel, entry.entityType, entry.entityID, entry.details,
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
	for {
		select {
		case entry := <-auditLogChan:
			if _, err := database.DB.Exec(
				`INSERT INTO audit_logs (action, action_label, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)`,
				entry.action, entry.actionLabel, entry.entityType, entry.entityID, entry.details,
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
