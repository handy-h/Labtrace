package handlers

import "strconv"

// parseInt64 将字符串转换为 int64，转换失败返回 0。
func parseInt64(s string) int64 {
	n, _ := strconv.ParseInt(s, 10, 64)
	return n
}
