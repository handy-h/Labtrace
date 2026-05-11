package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"labtrace/internal/database"
	"labtrace/internal/models"

	"github.com/gin-gonic/gin"
)

// ListCategories 返回所有检验项目分类
func ListCategories(c *gin.Context) {
	rows, err := database.DB.Query("SELECT id, name, created_at FROM report_categories ORDER BY id")
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error("查询分类失败"))
		return
	}
	defer rows.Close()

	var list []models.ReportCategory
	for rows.Next() {
		var cat models.ReportCategory
		if err := rows.Scan(&cat.ID, &cat.Name, &cat.CreatedAt); err != nil {
			continue
		}
		list = append(list, cat)
	}
	c.JSON(http.StatusOK, models.Success(list))
}

// CreateCategory 创建新分类
func CreateCategory(c *gin.Context) {
	var req struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.Error("分类名称不能为空"))
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, models.Error("分类名称不能为空"))
		return
	}

	res, err := database.DB.Exec("INSERT INTO report_categories (name) VALUES (?)", name)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			c.JSON(http.StatusConflict, models.Error("分类名称已存在"))
			return
		}
		c.JSON(http.StatusInternalServerError, models.Error("创建分类失败"))
		return
	}

	id, _ := res.LastInsertId()
	c.JSON(http.StatusOK, models.Success(gin.H{"id": id, "name": name}))
}

// UpdateCategory 更新分类名称
func UpdateCategory(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.Error("无效的分类ID"))
		return
	}

	var req struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.Error("分类名称不能为空"))
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, models.Error("分类名称不能为空"))
		return
	}

	_, err = database.DB.Exec("UPDATE report_categories SET name = ? WHERE id = ?", name, id)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			c.JSON(http.StatusConflict, models.Error("分类名称已存在"))
			return
		}
		c.JSON(http.StatusInternalServerError, models.Error("更新分类失败"))
		return
	}

	c.JSON(http.StatusOK, models.Success(nil))
}

// DeleteCategory 删除分类
func DeleteCategory(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.Error("无效的分类ID"))
		return
	}

	// 将引用该分类的报告的 category_id 置空
	database.DB.Exec("UPDATE lab_reports SET category_id = NULL WHERE category_id = ?", id)

	_, err = database.DB.Exec("DELETE FROM report_categories WHERE id = ?", id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error("删除分类失败"))
		return
	}

	c.JSON(http.StatusOK, models.Success(nil))
}

// NormalizeCategory 归一化：将报告的分类从一个改为另一个
func NormalizeCategory(c *gin.Context) {
	var req struct {
		ReportID   int64 `json:"report_id" binding:"required"`
		CategoryID int64 `json:"category_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.Error("参数错误"))
		return
	}

	_, err := database.DB.Exec("UPDATE lab_reports SET category_id = ? WHERE id = ?", req.CategoryID, req.ReportID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Error("归一化失败"))
		return
	}

	c.JSON(http.StatusOK, models.Success(nil))
}