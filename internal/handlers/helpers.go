package handlers

import (
	"fmt"
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
	target, err = filepath.EvalSymlinks(target)
	if err != nil {
		return false
	}
	base, err := filepath.Abs(filepath.Clean(cfg.UploadDir))
	if err != nil {
		return false
	}
	base, err = filepath.EvalSymlinks(base)
	if err != nil {
		return false
	}
	sep := string(os.PathSeparator)
	if !strings.HasSuffix(base, sep) {
		base += sep
	}
	return strings.HasPrefix(target, base)
}

// validateDateFormat checks if a date string matches YYYY-MM-DD or YYYY-MM format.
func validateDateFormat(date string) bool {
	if len(date) == 7 {
		// YYYY-MM format
		if date[4] != '-' {
			return false
		}
		year := date[:4]
		month := date[5:7]
		if _, err := strconv.Atoi(year); err != nil {
			return false
		}
		m, err := strconv.Atoi(month)
		if err != nil || m < 1 || m > 12 {
			return false
		}
		return true
	}
	if len(date) == 10 {
		// YYYY-MM-DD format
		if date[4] != '-' || date[7] != '-' {
			return false
		}
		year := date[:4]
		month := date[5:7]
		day := date[8:10]
		if _, err := strconv.Atoi(year); err != nil {
			return false
		}
		m, err := strconv.Atoi(month)
		if err != nil || m < 1 || m > 12 {
			return false
		}
		d, err := strconv.Atoi(day)
		if err != nil || d < 1 || d > 31 {
			return false
		}
		return true
	}
	return false
}

// sanitizeError 根据 DevMode 返回安全的错误消息。
// 生产模式下隐藏内部错误详情，开发模式下返回真实错误。
func sanitizeError(err error) string {
	return config.SanitizeError(err)
}

// validateUploadFileType validates file type by extension.
// Allowed extensions: .pdf, .png, .jpg, .jpeg.
func validateUploadFileType(fileName, contentType string) error {
	// Check file extension
	ext := strings.ToLower(filepath.Ext(fileName))
	allowedExts := map[string]bool{
		".pdf":  true,
		".png":  true,
		".jpg":  true,
		".jpeg": true,
	}
	if !allowedExts[ext] {
		return fmt.Errorf("不支持的文件类型: %s，仅支持 PDF、PNG、JPG、JPEG", ext)
	}

	// Check Content-Type if provided
	if contentType != "" {
		allowedTypes := map[string]bool{
			"application/pdf": true,
			"image/png":       true,
			"image/jpeg":      true,
			"image/jpg":       true,
		}
		ct := strings.ToLower(strings.Split(contentType, ";")[0])
		ct = strings.TrimSpace(ct)
		if !allowedTypes[ct] {
			return fmt.Errorf("不支持的文件类型: %s，仅支持 PDF、PNG、JPG、JPEG", ct)
		}
	}

	return nil
}

// validateFileMagicBytes checks file magic bytes for expected types.
// For PDF: checks %PDF header. For images: checks common image headers.
func validateFileMagicBytes(data []byte, ext string) error {
	if len(data) < 4 {
		return fmt.Errorf("文件内容过短，无法验证")
	}
	ext = strings.ToLower(ext)
	switch ext {
	case ".pdf":
		if string(data[:4]) != "%PDF" {
			return fmt.Errorf("文件头不是有效的 PDF 格式")
		}
	case ".png":
		// PNG magic: 89 50 4E 47 0D 0A 1A 0A
		if len(data) < 8 || data[0] != 0x89 || data[1] != 0x50 || data[2] != 0x4E || data[3] != 0x47 {
			return fmt.Errorf("文件头不是有效的 PNG 格式")
		}
	case ".jpg", ".jpeg":
		// JPEG magic: FF D8 FF
		if data[0] != 0xFF || data[1] != 0xD8 || data[2] != 0xFF {
			return fmt.Errorf("文件头不是有效的 JPEG 格式")
		}
	}
	return nil
}
