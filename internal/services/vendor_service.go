package services

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// VendorLibrary 定义一个需要本地缓存的前端库
type VendorLibrary struct {
	Name         string // 库名称，如 "vue", "echarts", "pdfjs"
	URL          string // CDN 下载地址
	LocalPath    string // 本地存储路径（相对于 vendorDir）
	Integrity    string // 可选：SHA-256 校验（留空则跳过校验）
	Required     bool   // 是否为必需库（下载失败是否影响启动）
	MinSize      int64  // 可选：最小文件大小（字节），本地文件小于此值时强制重新下载，0 表示不检查
}

// DefaultVendorLibraries 定义项目依赖的前端库清单
// 注意：Integrity 是 SHA-256，不是 SRI 的 SHA-384。留空表示不校验。
var DefaultVendorLibraries = []VendorLibrary{
	{
		Name:      "vue",
		URL:       "https://unpkg.com/vue@3.5.13/dist/vue.global.prod.js",
		LocalPath: "vue.global.prod.js",
		Required:  true,
	},
	{
		Name:      "echarts",
		URL:       "https://cdn.jsdelivr.net/npm/echarts@5.6.0/dist/echarts.min.js",
		LocalPath: "echarts.min.js",
		Required:  true,
	},
	{
		Name:      "pdfjs",
		URL:       "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js",
		LocalPath: "pdf.min.js",
		Required:  true,
		MinSize:   100_000, // 正常的 pdf.min.js 约 300KB，如果本地文件过小说明是损坏的缓存
	},
	{
		Name:      "pdfjs-worker",
		URL:       "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js",
		LocalPath: "pdf.worker.min.js",
		Required:  true,
		MinSize:   500_000, // 正常的 pdf.worker.min.js 约 1.5MB
	},
}

// EnsureVendorLibraries 确保所有前端库已下载到本地。
// 如果本地文件不存在，或远程有更新（通过 Last-Modified / ETag 判断），则下载更新。
// 如果远程无法获取且本地有缓存，则使用本地版本。
// 返回成功下载的库列表和错误信息。
func EnsureVendorLibraries(vendorDir string, libs []VendorLibrary, timeout time.Duration) ([]string, error) {
	if err := os.MkdirAll(vendorDir, 0755); err != nil {
		return nil, fmt.Errorf("create vendor dir: %w", err)
	}

	client := &http.Client{Timeout: timeout}
	downloaded := make([]string, 0, len(libs))
	var errs []error

	for _, lib := range libs {
		localFile := filepath.Join(vendorDir, lib.LocalPath)

		// 检查本地是否已有缓存
		localExists := false
		var localSize int64
		if fi, err := os.Stat(localFile); err == nil {
			localSize = fi.Size()
			localExists = true
		}

		// 如果本地文件过小（可能是损坏的缓存），标记需要重新下载
		if localExists && lib.MinSize > 0 && localSize < lib.MinSize {
			log.Printf("[vendor] %s local file too small (%d bytes < %d), will re-download", lib.Name, localSize, lib.MinSize)
			localExists = false
		}

		// 尝试从远程下载
		needsDownload := !localExists
		remoteAvailable := false

		if req, err := http.NewRequest(http.MethodHead, lib.URL, nil); err == nil {
			resp, err := client.Do(req)
			if err != nil {
				log.Printf("[vendor] HEAD %s failed: %v", lib.Name, err)
			} else if resp.StatusCode != http.StatusOK {
				log.Printf("[vendor] HEAD %s returned HTTP %d", lib.Name, resp.StatusCode)
				resp.Body.Close()
			} else {
				remoteAvailable = true
				// 如果本地有文件，比较 Last-Modified 或 Content-Length
				if localExists {
					if localFi, err := os.Stat(localFile); err == nil {
						remoteLM := resp.Header.Get("Last-Modified")
						if remoteLM != "" {
							if remoteTime, err := http.ParseTime(remoteLM); err == nil {
								if remoteTime.After(localFi.ModTime()) {
									needsDownload = true
								}
							}
						} else {
							// 没有 Last-Modified，比较 Content-Length
							if resp.ContentLength > 0 && resp.ContentLength != localFi.Size() {
								needsDownload = true
							}
						}
					}
				}
				resp.Body.Close()
			}
		}

		if needsDownload && remoteAvailable {
			log.Printf("[vendor] Downloading %s from %s ...", lib.Name, lib.URL)
			if err := downloadFile(client, lib.URL, localFile, lib.Integrity); err != nil {
				msg := fmt.Sprintf("download %s failed: %v", lib.Name, err)
				if localExists {
					log.Printf("[vendor] %s, using cached local version", msg)
				} else if lib.Required {
					errs = append(errs, fmt.Errorf("%s", msg))
				} else {
					log.Printf("[vendor] %s, library is optional, skipping", msg)
				}
				continue
			}
			downloaded = append(downloaded, lib.Name)
			log.Printf("[vendor] %s downloaded successfully", lib.Name)
		} else if !localExists && !remoteAvailable {
			msg := fmt.Sprintf("%s not available locally and remote unreachable", lib.Name)
			if lib.Required {
				errs = append(errs, fmt.Errorf("%s", msg))
			} else {
				log.Printf("[vendor] %s, library is optional, skipping", msg)
			}
		} else if localExists {
			log.Printf("[vendor] %s using cached local version", lib.Name)
		}
	}

	if len(errs) > 0 {
		return downloaded, fmt.Errorf("vendor library errors: %v", errs)
	}
	return downloaded, nil
}

// downloadFile 下载文件并可选校验 SHA-256。
func downloadFile(client *http.Client, url, destPath, expectedHash string) error {
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	// 创建临时文件
	tmpFile, err := os.CreateTemp(filepath.Dir(destPath), ".tmp-"+filepath.Base(destPath)+"-*")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()

	// 只在下载失败时清理临时文件
	success := false
	defer func() {
		if !success {
			os.Remove(tmpPath)
		}
	}()

	// 写入并计算哈希
	hasher := sha256.New()
	writer := io.MultiWriter(tmpFile, hasher)
	if _, err := io.Copy(writer, resp.Body); err != nil {
		tmpFile.Close()
		return fmt.Errorf("download: %w", err)
	}
	tmpFile.Close()

	// 校验哈希
	if expectedHash != "" {
		actualHash := hex.EncodeToString(hasher.Sum(nil))
		if actualHash != expectedHash {
			return fmt.Errorf("hash mismatch: expected %s, got %s", expectedHash, actualHash)
		}
	}

	// 原子替换
	if err := os.Rename(tmpPath, destPath); err != nil {
		return fmt.Errorf("rename: %w", err)
	}
	success = true

	return nil
}


