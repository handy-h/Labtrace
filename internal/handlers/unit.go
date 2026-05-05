package handlers

import (
	"math"
	"net/http"
	"strconv"

	"labtrace/internal/database"
	"labtrace/internal/models"
	"labtrace/internal/services"

	"github.com/gin-gonic/gin"
)

// --- UnitConversion CRUD ---

func ListUnitConversions(c *gin.Context) {
	itemID := c.Query("test_item_id")

	query := `SELECT id, test_item_id, source_unit, target_unit, formula, example_input, example_output, created_at FROM unit_conversions`
	args := []interface{}{}

	if itemID != "" {
		query += ` WHERE test_item_id = ?`
		args = append(args, itemID)
	}
	query += ` ORDER BY id`

	rows, err := database.DB.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	defer rows.Close()

	convs := []models.UnitConversion{}
	for rows.Next() {
		var uc models.UnitConversion
		if err := rows.Scan(&uc.ID, &uc.TestItemID, &uc.SourceUnit, &uc.TargetUnit, &uc.Formula, &uc.ExampleInput, &uc.ExampleOutput, &uc.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
			return
		}
		convs = append(convs, uc)
	}
	c.JSON(http.StatusOK, models.Success(convs))
}

func CreateUnitConversion(c *gin.Context) {
	var uc models.UnitConversion
	if err := c.ShouldBindJSON(&uc); err != nil {
		c.JSON(http.StatusBadRequest, models.Error(err.Error()))
		return
	}

	// Safety valve: verify example calculation
	result, err := services.EvalSimpleExpr(uc.Formula, uc.ExampleInput)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.Error("公式解析失败: "+err.Error()))
		return
	}

	// Check magnitude deviation
	warning := ""
	if uc.ExampleInput != 0 && math.Abs(result/uc.ExampleInput) > 100 {
		warning = "量级偏差超过100倍，请确认公式正确"
	}

	// Allow small floating point tolerance
	if math.Abs(result-uc.ExampleOutput) > 0.01*math.Max(math.Abs(result), 1) {
		c.JSON(http.StatusBadRequest, models.Error("示例验证失败: 公式计算结果("+strconv.FormatFloat(result, 'f', 4, 64)+")与预期输出不匹配"))
		return
	}

	res, err := database.DB.Exec(
		`INSERT INTO unit_conversions (test_item_id, source_unit, target_unit, formula, example_input, example_output) VALUES (?, ?, ?, ?, ?, ?)`,
		uc.TestItemID, uc.SourceUnit, uc.TargetUnit, uc.Formula, uc.ExampleInput, uc.ExampleOutput,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	id, _ := res.LastInsertId()
	uc.ID = id

	resp := models.Success(uc)
	if warning != "" {
		resp.Message = warning
	}
	c.JSON(http.StatusCreated, resp)
}

func UpdateUnitConversion(c *gin.Context) {
	id := c.Param("id")
	var uc models.UnitConversion
	if err := c.ShouldBindJSON(&uc); err != nil {
		c.JSON(http.StatusBadRequest, models.Error(err.Error()))
		return
	}

	// Re-validate on update
	result, err := services.EvalSimpleExpr(uc.Formula, uc.ExampleInput)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.Error("公式解析失败: "+err.Error()))
		return
	}
	if math.Abs(result-uc.ExampleOutput) > 0.01*math.Max(math.Abs(result), 1) {
		c.JSON(http.StatusBadRequest, models.Error("示例验证失败"))
		return
	}

	_, err = database.DB.Exec(
		`UPDATE unit_conversions SET test_item_id=?, source_unit=?, target_unit=?, formula=?, example_input=?, example_output=? WHERE id=?`,
		uc.TestItemID, uc.SourceUnit, uc.TargetUnit, uc.Formula, uc.ExampleInput, uc.ExampleOutput, id,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	c.JSON(http.StatusOK, models.Success(nil))
}

func DeleteUnitConversion(c *gin.Context) {
	id := c.Param("id")
	_, err := database.DB.Exec(`DELETE FROM unit_conversions WHERE id=?`, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	c.JSON(http.StatusOK, models.Success(nil))
}
