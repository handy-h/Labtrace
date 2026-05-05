package handlers

import (
	"net/http"

	"labtrace/internal/database"
	"labtrace/internal/models"

	"github.com/gin-gonic/gin"
)

// --- CalculationRule CRUD ---

func ListCalcRules(c *gin.Context) {
	rows, err := database.DB.Query(`SELECT id, name, formula, threshold, test_item_ids, created_at FROM calculation_rules ORDER BY id`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	defer rows.Close()

	rules := []models.CalculationRule{}
	for rows.Next() {
		var r models.CalculationRule
		if err := rows.Scan(&r.ID, &r.Name, &r.Formula, &r.Threshold, &r.TestItemIDs, &r.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
			return
		}
		rules = append(rules, r)
	}
	c.JSON(http.StatusOK, models.Success(rules))
}

func CreateCalcRule(c *gin.Context) {
	var r models.CalculationRule
	if err := c.ShouldBindJSON(&r); err != nil {
		c.JSON(http.StatusBadRequest, models.Error(err.Error()))
		return
	}

	result, err := database.DB.Exec(
		`INSERT INTO calculation_rules (name, formula, threshold, test_item_ids) VALUES (?, ?, ?, ?)`,
		r.Name, r.Formula, r.Threshold, r.TestItemIDs,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	id, _ := result.LastInsertId()
	r.ID = id
	c.JSON(http.StatusCreated, models.Success(r))
}

func UpdateCalcRule(c *gin.Context) {
	id := c.Param("id")
	var r models.CalculationRule
	if err := c.ShouldBindJSON(&r); err != nil {
		c.JSON(http.StatusBadRequest, models.Error(err.Error()))
		return
	}
	_, err := database.DB.Exec(
		`UPDATE calculation_rules SET name=?, formula=?, threshold=?, test_item_ids=? WHERE id=?`,
		r.Name, r.Formula, r.Threshold, r.TestItemIDs, id,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	c.JSON(http.StatusOK, models.Success(nil))
}

func DeleteCalcRule(c *gin.Context) {
	id := c.Param("id")
	_, err := database.DB.Exec(`DELETE FROM calculation_rules WHERE id=?`, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	c.JSON(http.StatusOK, models.Success(nil))
}
