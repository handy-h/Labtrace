package handlers

import (
	"net/http"

	"labtrace/internal/models"

	"github.com/gin-gonic/gin"
)

// Ping health check
func Ping(c *gin.Context) {
	c.JSON(http.StatusOK, models.Success(gin.H{"status": "ok", "version": "0.1.0"}))
}