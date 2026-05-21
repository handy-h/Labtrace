package handlers

import (
	"database/sql"
	"net/http"

	"labtrace/internal/database"
	"labtrace/internal/models"

	"github.com/gin-gonic/gin"
)

// --- Subject CRUD ---

func ListSubjects(c *gin.Context) {
	search := c.Query("search")

	query := `SELECT s.id, s.name, s.gender, s.birth_date, s.created_at, s.updated_at,
		COUNT(lr.id) as report_count,
		MAX(lr.sample_date) as last_report_date
		FROM subjects s
		LEFT JOIN lab_reports lr ON lr.subject_id = s.id`
	args := []interface{}{}

	if search != "" {
		query += ` WHERE s.name LIKE ?`
		args = append(args, "%"+search+"%")
	}

	query += ` GROUP BY s.id ORDER BY s.updated_at DESC`

	rows, err := database.DB.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	defer rows.Close()

	subjects := []models.SubjectSummary{}
	for rows.Next() {
		var s models.SubjectSummary
		var lastDate sql.NullString
		if err := rows.Scan(&s.ID, &s.Name, &s.Gender, &s.BirthDate,
			&s.CreatedAt, &s.UpdatedAt, &s.ReportCount, &lastDate); err != nil {
			c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
			return
		}
		if lastDate.Valid {
			s.LastReportDate = lastDate.String
		}
		subjects = append(subjects, s)
	}

	c.JSON(http.StatusOK, models.Success(subjects))
}

func CreateSubject(c *gin.Context) {
	var s models.Subject
	if err := c.ShouldBindJSON(&s); err != nil {
		c.JSON(http.StatusBadRequest, models.Error(err.Error()))
		return
	}

	result, err := database.DB.Exec(
		`INSERT INTO subjects (name, gender, birth_date) VALUES (?, ?, ?)`,
		s.Name, s.Gender, s.BirthDate,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}

	id, _ := result.LastInsertId()
	s.ID = id
	c.JSON(http.StatusCreated, models.Success(s))
}

func GetSubject(c *gin.Context) {
	id := c.Param("id")
	var s models.Subject
	err := database.DB.QueryRow(
		`SELECT id, name, gender, birth_date, created_at, updated_at FROM subjects WHERE id = ?`, id,
	).Scan(&s.ID, &s.Name, &s.Gender, &s.BirthDate, &s.CreatedAt, &s.UpdatedAt)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.Error("subject not found"))
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	c.JSON(http.StatusOK, models.Success(s))
}

func UpdateSubject(c *gin.Context) {
	id := c.Param("id")
	var s models.Subject
	if err := c.ShouldBindJSON(&s); err != nil {
		c.JSON(http.StatusBadRequest, models.Error(err.Error()))
		return
	}

	result, err := database.DB.Exec(
		`UPDATE subjects SET name=?, gender=?, birth_date=?, updated_at=datetime('now') WHERE id=?`,
		s.Name, s.Gender, s.BirthDate, id,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, models.Error("subject not found"))
		return
	}
	c.JSON(http.StatusOK, models.Success(nil))
}

func DeleteSubject(c *gin.Context) {
	id := c.Param("id")
	result, err := database.DB.Exec(`DELETE FROM subjects WHERE id = ?`, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, models.Error("subject not found"))
		return
	}
	c.JSON(http.StatusOK, models.Success(nil))
}

// --- Hospital CRUD ---

func ListHospitals(c *gin.Context) {
	rows, err := database.DB.Query(`SELECT id, name, level, created_at FROM hospitals ORDER BY name`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	defer rows.Close()

	hospitals := []models.Hospital{}
	for rows.Next() {
		var h models.Hospital
		if err := rows.Scan(&h.ID, &h.Name, &h.Level, &h.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
			return
		}
		hospitals = append(hospitals, h)
	}
	c.JSON(http.StatusOK, models.Success(hospitals))
}

func CreateHospital(c *gin.Context) {
	var h models.Hospital
	if err := c.ShouldBindJSON(&h); err != nil {
		c.JSON(http.StatusBadRequest, models.Error(err.Error()))
		return
	}
	result, err := database.DB.Exec(`INSERT INTO hospitals (name, level) VALUES (?, ?)`, h.Name, h.Level)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	id, _ := result.LastInsertId()
	h.ID = id
	c.JSON(http.StatusCreated, models.Success(h))
}

func UpdateHospital(c *gin.Context) {
	id := c.Param("id")
	var h models.Hospital
	if err := c.ShouldBindJSON(&h); err != nil {
		c.JSON(http.StatusBadRequest, models.Error(err.Error()))
		return
	}
	result, err := database.DB.Exec(`UPDATE hospitals SET name=?, level=? WHERE id=?`, h.Name, h.Level, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, models.Error("hospital not found"))
		return
	}
	c.JSON(http.StatusOK, models.Success(nil))
}

func DeleteHospital(c *gin.Context) {
	id := c.Param("id")
	result, err := database.DB.Exec(`DELETE FROM hospitals WHERE id=?`, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, models.Error("hospital not found"))
		return
	}
	c.JSON(http.StatusOK, models.Success(nil))
}