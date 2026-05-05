package handlers

import (
	"net/http"
	"strconv"

	"labtrace/internal/database"
	"labtrace/internal/models"

	"github.com/gin-gonic/gin"
)

// DashboardSummary returns statistics for the dashboard.
func DashboardSummary(c *gin.Context) {
	var subjectCount, pendingCount, anomalyCount, hospitalCount int

	database.DB.QueryRow(`SELECT COUNT(*) FROM subjects`).Scan(&subjectCount)
	database.DB.QueryRow(`SELECT COUNT(*) FROM lab_reports WHERE ocr_status = 'review'`).Scan(&pendingCount)
	database.DB.QueryRow(`SELECT COUNT(*) FROM report_items WHERE flag IN ('H', 'L', '阳性', '阴性')`).Scan(&anomalyCount)
	database.DB.QueryRow(`SELECT COUNT(DISTINCT hospital_id) FROM lab_reports WHERE hospital_id IS NOT NULL`).Scan(&hospitalCount)

	c.JSON(http.StatusOK, models.Success(gin.H{
		"subjects":  subjectCount,
		"pending":   pendingCount,
		"anomalies": anomalyCount,
		"hospitals": hospitalCount,
	}))
}

// DashboardAnomalies returns a filtered list of anomalous report items.
func DashboardAnomalies(c *gin.Context) {
	hospital := c.Query("hospital")
	confidence := c.Query("confidence") // "high"(>=95), "medium"(80-94), "low"(<80)
	flag := c.Query("flag")             // H, L, 阳性, 阴性
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}

	query := `SELECT ri.id, s.name, lr.sample_date, COALESCE(ti.standard_name, ''),
		ri.original_value, COALESCE(h.name, ''), ri.confidence, ri.flag
		FROM report_items ri
		JOIN lab_reports lr ON lr.id = ri.report_id
		JOIN subjects s ON s.id = lr.subject_id
		LEFT JOIN hospitals h ON h.id = lr.hospital_id
		LEFT JOIN test_items ti ON ti.id = ri.test_item_id
		WHERE ri.flag != '' AND ri.flag != 'normal'`
	args := []interface{}{}

	if hospital != "" {
		query += ` AND h.name = ?`
		args = append(args, hospital)
	}
	if flag != "" {
		query += ` AND ri.flag = ?`
		args = append(args, flag)
	}
	if confidence == "high" {
		query += ` AND ri.confidence >= 95`
	} else if confidence == "medium" {
		query += ` AND ri.confidence >= 80 AND ri.confidence < 95`
	} else if confidence == "low" {
		query += ` AND ri.confidence < 80`
	}

	// Count total
	countQuery := "SELECT COUNT(*) FROM (" + query + ")"
	var total int
	database.DB.QueryRow(countQuery, args...).Scan(&total)

	// Paginate
	query += ` ORDER BY lr.sample_date DESC LIMIT ? OFFSET ?`
	args = append(args, pageSize, (page-1)*pageSize)

	rows, err := database.DB.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	defer rows.Close()

	type AnomalyItem struct {
		ID           int64  `json:"id"`
		SubjectName  string `json:"subject_name"`
		SampleDate   string `json:"sample_date"`
		TestItemName string `json:"test_item_name"`
		Value        string `json:"value"`
		HospitalName string `json:"hospital_name"`
		Confidence   int    `json:"confidence"`
		Flag         string `json:"flag"`
	}

	items := []AnomalyItem{}
	for rows.Next() {
		var it AnomalyItem
		if err := rows.Scan(&it.ID, &it.SubjectName, &it.SampleDate, &it.TestItemName,
			&it.Value, &it.HospitalName, &it.Confidence, &it.Flag); err != nil {
			continue
		}
		items = append(items, it)
	}

	c.JSON(http.StatusOK, models.Success(models.PaginatedResponse{
		Data:     items,
		Total:    int64(total),
		Page:     page,
		PageSize: pageSize,
	}))
}
