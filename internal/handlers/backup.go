package handlers

import (
	"net/http"
	"os"
	"path/filepath"

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
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.Error("请求参数错误"))
		return
	}

	cfg, err := config.Load()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error("配置加载失败"))
		return
	}

	filename, fileSize, err := services.ExportBackup(cfg.DBKey, cfg.DBPath, cfg.BackupDir, req.Description)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error("备份导出失败: "+err.Error()))
		return
	}

	services.LogAction("export", "导出备份", "backup", 0, map[string]interface{}{"filename": filename})

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
	tmpPath := filepath.Join(os.TempDir(), "labtrace_restore.bak")
	tmpFile, err := os.Create(tmpPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error("创建临时文件失败"))
		return
	}
	defer tmpFile.Close()
	defer os.Remove(tmpPath)

	if _, err = tmpFile.ReadFrom(file); err != nil {
		c.JSON(http.StatusInternalServerError, models.Error("保存临时文件失败"))
		return
	}

	cfg, err := config.Load()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error("配置加载失败"))
		return
	}
	if err := services.ImportBackup(cfg.DBKey, cfg.DBPath, tmpPath); err != nil {
		c.JSON(http.StatusBadRequest, models.Error("备份导入失败: "+err.Error()))
		return
	}

	services.LogAction("import", "导入备份", "backup", 0, nil)
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
