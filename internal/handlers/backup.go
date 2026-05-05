package handlers

import (
	"net/http"
	"os"

	"labtrace/internal/config"
	"labtrace/internal/database"
	"labtrace/internal/models"
	"labtrace/internal/services"

	"github.com/gin-gonic/gin"
)

// ExportBackup handles backup export request.
func ExportBackup(c *gin.Context) {
	var req struct {
		Description string `json:"description"`
	}
	c.ShouldBindJSON(&req)

	cfg, _ := config.Load()

	filename, fileSize, err := services.ExportBackup(cfg.DBKey, cfg.BackupDir, req.Description)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error("备份导出失败: "+err.Error()))
		return
	}

	services.LogAction("export", "backup", 0, map[string]interface{}{"filename": filename})

	c.JSON(http.StatusOK, models.Success(gin.H{
		"filename":  filename,
		"file_size": fileSize,
	}))
}

// ImportBackup handles backup import request.
func ImportBackup(c *gin.Context) {
	file, _, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, models.Error("文件上传失败"))
		return
	}
	defer file.Close()

	// Save uploaded file temporarily
	tmpPath := "/tmp/labtrace_restore.bak"
	tmpFile, _ := os.Create(tmpPath)
	defer tmpFile.Close()
	defer os.Remove(tmpPath)

	_, err = tmpFile.ReadFrom(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error("保存临时文件失败"))
		return
	}

	cfg, _ := config.Load()
	if err := services.ImportBackup(cfg.DBKey, tmpPath); err != nil {
		c.JSON(http.StatusBadRequest, models.Error("备份导入失败: "+err.Error()))
		return
	}

	services.LogAction("import", "backup", 0, nil)
	c.JSON(http.StatusOK, models.Success(gin.H{"status": "restored"}))
}

// ListBackups returns backup history.
func ListBackups(c *gin.Context) {
	rows, err := database.DB.Query(`SELECT id, filename, description, file_size, created_at FROM backups ORDER BY created_at DESC`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	defer rows.Close()

	backups := []models.Backup{}
	for rows.Next() {
		var b models.Backup
		if err := rows.Scan(&b.ID, &b.Filename, &b.Description, &b.FileSize, &b.CreatedAt); err != nil {
			continue
		}
		backups = append(backups, b)
	}
	c.JSON(http.StatusOK, models.Success(backups))
}

// DeleteBackup removes a backup record.
func DeleteBackup(c *gin.Context) {
	id := c.Param("id")
	_, err := database.DB.Exec(`DELETE FROM backups WHERE id=?`, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error(err.Error()))
		return
	}
	c.JSON(http.StatusOK, models.Success(nil))
}
