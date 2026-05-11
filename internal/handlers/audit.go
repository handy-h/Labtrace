package handlers

import (
	"net/http"

	"labtrace/internal/database"
	"labtrace/internal/models"

	"github.com/gin-gonic/gin"
)

// ListAuditLogs returns audit log entries with optional filtering.
// Joins lab_reports and report_categories to provide sample_date and category_name.
func ListAuditLogs(c *gin.Context) {
	action := c.Query("action")
	entityType := c.Query("entity_type")

	query := `
		SELECT a.id, a.action, COALESCE(a.action_label,''), a.entity_type, a.entity_id, a.details, a.created_at,
		       COALESCE(r.sample_date,''), COALESCE(rc.name,'')
		FROM audit_logs a
		LEFT JOIN lab_reports r ON a.entity_type = 'lab_report' AND a.entity_id = r.id
		LEFT JOIN report_categories rc ON r.category_id = rc.id`
	args := []interface{}{}
	conditions := []string{}

	if action != "" {
		conditions = append(conditions, "a.action = ?")
		args = append(args, action)
	}
	if entityType != "" {
		conditions = append(conditions, "a.entity_type = ?")
		args = append(args, entityType)
	}

	if len(conditions) > 0 {
		query += " WHERE " + conditions[0]
		for i := 1; i < len(conditions); i++ {
			query += " AND " + conditions[i]
		}
	}
	query += ` ORDER BY a.created_at DESC LIMIT 200`

	rows, err := database.DB.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	defer rows.Close()

	logs := []models.AuditLog{}
	for rows.Next() {
		var l models.AuditLog
		if err := rows.Scan(&l.ID, &l.Action, &l.ActionLabel, &l.EntityType, &l.EntityID, &l.Details, &l.CreatedAt,
			&l.SampleDate, &l.CategoryName); err != nil {
			continue
		}
		logs = append(logs, l)
	}
	c.JSON(http.StatusOK, models.Success(logs))
}
