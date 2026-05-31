package handlers

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"labtrace/internal/config"
)

// parseInt64 将字符串转换为 int64，转换失败返回错误。
func parseInt64(s string) (int64, error) {
	return strconv.ParseInt(s, 10, 64)
}

// validateFilePath 校验文件路径是否在上传目录内，防止目录遍历攻击。
func validateFilePath(filePath string) bool {
	if filePath == "" {
		return false
	}
	cfg, err := config.Load()
	if err != nil {
		return false
	}
	target, err := filepath.Abs(filepath.Clean(filePath))
	if err != nil {
		return false
	}
	base, err := filepath.Abs(filepath.Clean(cfg.UploadDir))
	if err != nil {
		return false
	}
	sep := string(os.PathSeparator)
	if !strings.HasSuffix(base, sep) {
		base += sep
	}
	return strings.HasPrefix(target, base)
}
