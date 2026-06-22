package handlers

import (
	"net/http"

	"labtrace/internal/models"

	"github.com/gin-gonic/gin"
)

// Version is set from the main package via ldflags at build time.
// This avoids a circular dependency (handlers importing main).
var Version = "0.8.0"

// Ping health check
func Ping(c *gin.Context) {
	c.JSON(http.StatusOK, models.Success(gin.H{"status": "ok", "version": Version}))
}
