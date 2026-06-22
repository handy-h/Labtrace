package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"os"
	"sync"

	"github.com/gin-gonic/gin"
)

var (
	csrfSecret    string
	csrfInitOnce  sync.Once
	csrfSecretMu  sync.RWMutex
)

// initCSRFSecret 初始化 CSRF 密钥（仅在首次调用时生成）。
func initCSRFSecret() {
	csrfInitOnce.Do(func() {
		if s := os.Getenv("CSRF_SECRET"); s != "" {
			csrfSecret = s
		} else {
			b := make([]byte, 32)
			if _, err := rand.Read(b); err != nil {
				// Fallback to a less-random value if crypto/rand fails
				for i := range b {
					b[i] = byte(i ^ 0xAA)
				}
			}
			csrfSecret = hex.EncodeToString(b)
		}
	})
}

// CSRF 返回 CSRF 保护中间件。
// 通过环境变量 CSRF_ENABLED=false 禁用，默认启用。
// 对 POST/PUT/DELETE/PATCH 请求检查 X-CSRF-Token 头或 _csrf 表单字段。
func CSRF() gin.HandlerFunc {
	if os.Getenv("CSRF_ENABLED") == "false" {
		return func(c *gin.Context) { c.Next() }
	}

	initCSRFSecret()

	return func(c *gin.Context) {
		// 仅检查写操作
		method := c.Request.Method
		if method == "GET" || method == "HEAD" || method == "OPTIONS" {
			c.Next()
			return
		}

		// 获取 token
		token := c.GetHeader("X-CSRF-Token")
		if token == "" {
			token = c.PostForm("_csrf")
		}

		csrfSecretMu.RLock()
		secret := csrfSecret
		csrfSecretMu.RUnlock()

		if token != secret {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"code":    1,
				"message": "CSRF token 无效或缺失",
			})
			return
		}

		// 在响应头中返回 token 供客户端缓存
		c.Header("X-CSRF-Token", secret)
		c.Next()
	}
}

// GetCSRFToken 返回当前 CSRF 密钥。
func GetCSRFToken() string {
	initCSRFSecret()
	csrfSecretMu.RLock()
	defer csrfSecretMu.RUnlock()
	return csrfSecret
}
