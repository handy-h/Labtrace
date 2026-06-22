package middleware

import (
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type ipRateTracker struct {
	count    int
	windowStart time.Time
}

// RateLimiter 返回基于 IP 的速率限制中间件。
// 通过环境变量 RATE_LIMIT_RPM 配置每分钟请求数（默认 100）。
// 通过环境变量 RATE_LIMIT_ENABLED=false 禁用，默认启用。
func RateLimiter() gin.HandlerFunc {
	if os.Getenv("RATE_LIMIT_ENABLED") == "false" {
		return func(c *gin.Context) { c.Next() }
	}

	rpm := 100
	if v := os.Getenv("RATE_LIMIT_RPM"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			rpm = n
		}
	}

	var mu sync.Mutex
	trackers := make(map[string]*ipRateTracker)

	// 定时清理过期记录
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			mu.Lock()
			cutoff := time.Now().Add(-2 * time.Minute)
			for ip, t := range trackers {
				if t.windowStart.Before(cutoff) {
					delete(trackers, ip)
				}
			}
			mu.Unlock()
		}
	}()

	return func(c *gin.Context) {
		ip := c.ClientIP()

		mu.Lock()
		t, ok := trackers[ip]
		now := time.Now()
		if !ok || now.Sub(t.windowStart) > time.Minute {
			t = &ipRateTracker{windowStart: now, count: 0}
			trackers[ip] = t
		}
		t.count++
		current := t.count
		mu.Unlock()

		if current > rpm {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"code":    1,
				"message": "请求过于频繁，请稍后再试",
			})
			return
		}
		c.Next()
	}
}
