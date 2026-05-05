package handlers

import (
	"net/http"

	"labtrace/internal/database"
	"labtrace/internal/models"

	"github.com/gin-gonic/gin"
)

// --- HospitalRule CRUD ---

func ListHospitalRules(c *gin.Context) {
	hospitalID := c.Query("hospital_id")

	query := `SELECT id, hospital_id, rule_name, column_mappings, created_at, updated_at FROM hospital_rules`
	args := []interface{}{}

	if hospitalID != "" {
		query += ` WHERE hospital_id = ?`
		args = append(args, hospitalID)
	}
	query += ` ORDER BY updated_at DESC`

	rows, err := database.DB.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	defer rows.Close()

	rules := []models.HospitalRule{}
	for rows.Next() {
		var r models.HospitalRule
		if err := rows.Scan(&r.ID, &r.HospitalID, &r.RuleName, &r.ColumnMappings, &r.CreatedAt, &r.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
			return
		}
		rules = append(rules, r)
	}
	c.JSON(http.StatusOK, models.Success(rules))
}

func CreateHospitalRule(c *gin.Context) {
	var r models.HospitalRule
	if err := c.ShouldBindJSON(&r); err != nil {
		c.JSON(http.StatusBadRequest, models.Error(err.Error()))
		return
	}

	result, err := database.DB.Exec(
		`INSERT INTO hospital_rules (hospital_id, rule_name, column_mappings) VALUES (?, ?, ?)`,
		r.HospitalID, r.RuleName, r.ColumnMappings,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	id, _ := result.LastInsertId()
	r.ID = id
	c.JSON(http.StatusCreated, models.Success(r))
}

func UpdateHospitalRule(c *gin.Context) {
	id := c.Param("id")
	var r models.HospitalRule
	if err := c.ShouldBindJSON(&r); err != nil {
		c.JSON(http.StatusBadRequest, models.Error(err.Error()))
		return
	}
	_, err := database.DB.Exec(
		`UPDATE hospital_rules SET hospital_id=?, rule_name=?, column_mappings=?, updated_at=datetime('now') WHERE id=?`,
		r.HospitalID, r.RuleName, r.ColumnMappings, id,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	c.JSON(http.StatusOK, models.Success(nil))
}

func DeleteHospitalRule(c *gin.Context) {
	id := c.Param("id")
	_, err := database.DB.Exec(`DELETE FROM hospital_rules WHERE id=?`, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	c.JSON(http.StatusOK, models.Success(nil))
}
