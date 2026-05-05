package handlers

import (
	"net/http"

	"labtrace/internal/database"
	"labtrace/internal/models"

	"github.com/gin-gonic/gin"
)

// ListAuditLogs returns audit log entries with optional filtering.
func ListAuditLogs(c *gin.Context) {
	action := c.Query("action")
	entityType := c.Query("entity_type")

	query := `SELECT id, action, entity_type, entity_id, details, created_at FROM audit_logs`
	args := []interface{}{}
	conditions := []string{}

	if action != "" {
		conditions = append(conditions, "action = ?")
		args = append(args, action)
	}
	if entityType != "" {
		conditions = append(conditions, "entity_type = ?")
		args = append(args, entityType)
	}

	if len(conditions) > 0 {
		query += " WHERE " + conditions[0]
		for i := 1; i < len(conditions); i++ {
			query += " AND " + conditions[i]
		}
	}
	query += ` ORDER BY created_at DESC LIMIT 200`

	rows, err := database.DB.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	defer rows.Close()

	logs := []models.AuditLog{}
	for rows.Next() {
		var l models.AuditLog
		if err := rows.Scan(&l.ID, &l.Action, &l.EntityType, &l.EntityID, &l.Details, &l.CreatedAt); err != nil {
			continue
		}
		logs = append(logs, l)
	}
	c.JSON(http.StatusOK, models.Success(logs))
}
