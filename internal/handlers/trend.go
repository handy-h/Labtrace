package handlers

import (
	"net/http"
	"strconv"

	"labtrace/internal/models"
	"labtrace/internal/services"

	"github.com/gin-gonic/gin"
)

// GetTrendData handles trend data query.
func GetTrendData(c *gin.Context) {
	subjectID, _ := strconv.ParseInt(c.Query("subject_id"), 10, 64)
	testItemID, _ := strconv.ParseInt(c.Query("test_item_id"), 10, 64)
	dateFrom := c.Query("date_from")
	dateTo := c.Query("date_to")

	if subjectID == 0 || testItemID == 0 {
		c.JSON(http.StatusBadRequest, models.Error("subject_id and test_item_id are required"))
		return
	}

	data, err := services.GetTrendData(subjectID, testItemID, dateFrom, dateTo)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.Success(data))
}
