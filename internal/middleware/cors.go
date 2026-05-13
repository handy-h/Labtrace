package middleware

import (
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

// CORS 返回 CORS 中间件。
// 默认仅允许同源请求（不设置 Allow-Origin 头）。
// 通过 CORS_ORIGIN 环境变量可配置允许的 Origin 白名单（逗号分隔）。
func CORS() gin.HandlerFunc {
	// 读取允许的 Origin 白名单
	allowedOrigins := make(map[string]bool)
	if v := os.Getenv("CORS_ORIGIN"); v != "" {
		for _, o := range strings.Split(v, ",") {
			o = strings.TrimSpace(o)
			if o != "" {
				allowedOrigins[o] = true
			}
		}
	}

	return func(c *gin.Context) {
		// 预检请求必须响应
		if c.Request.Method == "OPTIONS" {
			origin := c.Request.Header.Get("Origin")
			if origin != "" && allowedOrigins[origin] {
				c.Header("Access-Control-Allow-Origin", origin)
				c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
				c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
				c.Header("Access-Control-Allow-Credentials", "true")
			}
			c.AbortWithStatus(204)
			return
		}

		// 普通请求：仅当 Origin 在白名单中时设置 CORS 头
		origin := c.Request.Header.Get("Origin")
		if origin != "" && allowedOrigins[origin] {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Credentials", "true")
		}

		c.Next()
	}
}