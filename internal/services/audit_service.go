package services

import (
	"encoding/json"

	"labtrace/internal/database"
)

// LogAction records an action in the audit log.
func LogAction(action, actionLabel, entityType string, entityID int64, details interface{}) {
	detailsJSON := "{}"
	if d, err := json.Marshal(details); err == nil {
		detailsJSON = string(d)
	}

	database.DB.Exec(
		`INSERT INTO audit_logs (action, action_label, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)`,
		action, actionLabel, entityType, entityID, detailsJSON,
	)
}
