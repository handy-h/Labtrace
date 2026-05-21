package handlers

import (
	"database/sql"
	"net/http"
	"strconv"

	"labtrace/internal/database"
	"labtrace/internal/models"

	"github.com/gin-gonic/gin"
)

// --- TestItem CRUD ---

func ListTestItems(c *gin.Context) {
	category := c.Query("category")

	query := `SELECT id, code, standard_name, category, default_unit, value_type, created_at FROM test_items`
	args := []interface{}{}

	if category != "" {
		query += ` WHERE category = ?`
		args = append(args, category)
	}
	query += ` ORDER BY code`

	rows, err := database.DB.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	defer rows.Close()

	items := []models.TestItem{}
	for rows.Next() {
		var it models.TestItem
		if err := rows.Scan(&it.ID, &it.Code, &it.StandardName, &it.Category, &it.DefaultUnit, &it.ValueType, &it.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
			return
		}
		items = append(items, it)
	}
	c.JSON(http.StatusOK, models.Success(items))
}

func CreateTestItem(c *gin.Context) {
	var it models.TestItem
	if err := c.ShouldBindJSON(&it); err != nil {
		c.JSON(http.StatusBadRequest, models.Error(err.Error()))
		return
	}

	result, err := database.DB.Exec(
		`INSERT INTO test_items (code, standard_name, category, default_unit, value_type) VALUES (?, ?, ?, ?, ?)`,
		it.Code, it.StandardName, it.Category, it.DefaultUnit, it.ValueType,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	id, _ := result.LastInsertId()
	it.ID = id
	c.JSON(http.StatusCreated, models.Success(it))
}

func UpdateTestItem(c *gin.Context) {
	id := c.Param("id")
	var it models.TestItem
	if err := c.ShouldBindJSON(&it); err != nil {
		c.JSON(http.StatusBadRequest, models.Error(err.Error()))
		return
	}
	result, err := database.DB.Exec(
		`UPDATE test_items SET code=?, standard_name=?, category=?, default_unit=?, value_type=? WHERE id=?`,
		it.Code, it.StandardName, it.Category, it.DefaultUnit, it.ValueType, id,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, models.Error("test item not found"))
		return
	}
	c.JSON(http.StatusOK, models.Success(nil))
}

func DeleteTestItem(c *gin.Context) {
	id := c.Param("id")
	result, err := database.DB.Exec(`DELETE FROM test_items WHERE id=?`, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, models.Error("test item not found"))
		return
	}
	c.JSON(http.StatusOK, models.Success(nil))
}

// --- TestItemAlias CRUD ---

func ListAliases(c *gin.Context) {
	itemID := c.Param("id")

	rows, err := database.DB.Query(
		`SELECT id, test_item_id, hospital_id, alias_name, created_at FROM test_item_aliases WHERE test_item_id = ? ORDER BY alias_name`, itemID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	defer rows.Close()

	aliases := []models.TestItemAlias{}
	for rows.Next() {
		var a models.TestItemAlias
		var hospID sql.NullInt64
		if err := rows.Scan(&a.ID, &a.TestItemID, &hospID, &a.AliasName, &a.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
			return
		}
		if hospID.Valid {
			a.HospitalID = &hospID.Int64
		}
		aliases = append(aliases, a)
	}
	c.JSON(http.StatusOK, models.Success(aliases))
}

func CreateAlias(c *gin.Context) {
	itemID := c.Param("id")
	var a models.TestItemAlias
	if err := c.ShouldBindJSON(&a); err != nil {
		c.JSON(http.StatusBadRequest, models.Error(err.Error()))
		return
	}

	result, err := database.DB.Exec(
		`INSERT INTO test_item_aliases (test_item_id, hospital_id, alias_name) VALUES (?, ?, ?)`,
		itemID, a.HospitalID, a.AliasName,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	id, _ := result.LastInsertId()
	a.ID = id
	a.TestItemID, _ = strconv.ParseInt(itemID, 10, 64)
	c.JSON(http.StatusCreated, models.Success(a))
}

func DeleteAlias(c *gin.Context) {
	id := c.Param("aliasId")
	_, err := database.DB.Exec(`DELETE FROM test_item_aliases WHERE id=?`, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	c.JSON(http.StatusOK, models.Success(nil))
}

// --- ReferenceInterval CRUD ---

func ListRefIntervals(c *gin.Context) {
	itemID := c.Param("id")

	rows, err := database.DB.Query(
		`SELECT id, test_item_id, gender, age_min, age_max, age_unit, value_min, value_max, value_type, qualitative_value, created_at
		FROM reference_intervals WHERE test_item_id = ? ORDER BY gender, age_min`, itemID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	defer rows.Close()

	intervals := []models.ReferenceInterval{}
	for rows.Next() {
		var ri models.ReferenceInterval
		var ageMin, ageMax, valMin, valMax sql.NullFloat64
		if err := rows.Scan(&ri.ID, &ri.TestItemID, &ri.Gender, &ageMin, &ageMax, &ri.AgeUnit, &valMin, &valMax, &ri.ValueType, &ri.QualitativeValue, &ri.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
			return
		}
		if ageMin.Valid {
			ri.AgeMin = &ageMin.Float64
		}
		if ageMax.Valid {
			ri.AgeMax = &ageMax.Float64
		}
		if valMin.Valid {
			ri.ValueMin = &valMin.Float64
		}
		if valMax.Valid {
			ri.ValueMax = &valMax.Float64
		}
		intervals = append(intervals, ri)
	}
	c.JSON(http.StatusOK, models.Success(intervals))
}

func CreateRefInterval(c *gin.Context) {
	itemID := c.Param("id")
	var ri models.ReferenceInterval
	if err := c.ShouldBindJSON(&ri); err != nil {
		c.JSON(http.StatusBadRequest, models.Error(err.Error()))
		return
	}

	result, err := database.DB.Exec(
		`INSERT INTO reference_intervals (test_item_id, gender, age_min, age_max, age_unit, value_min, value_max, value_type, qualitative_value)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		itemID, ri.Gender, ri.AgeMin, ri.AgeMax, ri.AgeUnit, ri.ValueMin, ri.ValueMax, ri.ValueType, ri.QualitativeValue,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	id, _ := result.LastInsertId()
	ri.ID = id
	c.JSON(http.StatusCreated, models.Success(ri))
}

func UpdateRefInterval(c *gin.Context) {
	id := c.Param("refId")
	var ri models.ReferenceInterval
	if err := c.ShouldBindJSON(&ri); err != nil {
		c.JSON(http.StatusBadRequest, models.Error(err.Error()))
		return
	}
	_, err := database.DB.Exec(
		`UPDATE reference_intervals SET gender=?, age_min=?, age_max=?, age_unit=?, value_min=?, value_max=?, value_type=?, qualitative_value=? WHERE id=?`,
		ri.Gender, ri.AgeMin, ri.AgeMax, ri.AgeUnit, ri.ValueMin, ri.ValueMax, ri.ValueType, ri.QualitativeValue, id,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	c.JSON(http.StatusOK, models.Success(nil))
}

func DeleteRefInterval(c *gin.Context) {
	id := c.Param("refId")
	_, err := database.DB.Exec(`DELETE FROM reference_intervals WHERE id=?`, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	c.JSON(http.StatusOK, models.Success(nil))
}
