package services

import (
	"archive/zip"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"labtrace/internal/database"
)

// backupMutex protects the Close/Write/Open sequence during ImportBackup.
var backupMutex sync.Mutex

// ExportBackup creates a zip backup containing the SQLite database and all uploaded files.
func ExportBackup(dbPath, uploadDir, backupDir, description string) (string, int64, error) {
	if err := os.MkdirAll(backupDir, 0755); err != nil {
		return "", 0, fmt.Errorf("create backup dir: %w", err)
	}

	filename := fmt.Sprintf("labtrace_%s.zip", time.Now().Format("20060102_150405"))
	filePath := filepath.Join(backupDir, filename)

	zipFile, err := os.Create(filePath)
	if err != nil {
		return "", 0, fmt.Errorf("create zip: %w", err)
	}
	defer zipFile.Close()

	zw := zip.NewWriter(zipFile)

	// 1. Add database file
	dbName := filepath.Base(dbPath)
	if err := addFileToZip(zw, dbPath, dbName); err != nil {
		return "", 0, fmt.Errorf("add database to zip: %w", err)
	}

	// 2. Collect all uploaded file paths from the database
	uploadedFiles, err := getUploadedFilePaths()
	if err != nil {
		return "", 0, fmt.Errorf("query uploaded files: %w", err)
	}

	// 3. Add each uploaded file to the zip under files/
	for _, fPath := range uploadedFiles {
		base := filepath.Base(fPath)
		zipPath := "files/" + base
		if err := addFileToZip(zw, fPath, zipPath); err != nil {
			// File might not exist on disk; log and skip
			log.Printf("[backup] skip missing file: %s (%v)", fPath, err)
			continue
		}
	}

	// Close zip writer explicitly to flush data and check for errors
	if err := zw.Close(); err != nil {
		return "", 0, fmt.Errorf("close zip writer: %w", err)
	}

	// Get file size
	fi, err := os.Stat(filePath)
	if err != nil {
		return filename, 0, nil
	}
	fileSize := fi.Size()

	// Record in database
	if _, err := database.DB.Exec(
		`INSERT INTO backups (filename, description, file_size) VALUES (?, ?, ?)`,
		filename, description, fileSize,
	); err != nil {
		return filename, fileSize, fmt.Errorf("record backup: %w", err)
	}

	return filename, fileSize, nil
}

// ImportBackup restores database and files from a zip backup.
func ImportBackup(dbPath, uploadDir, zipPath string) error {
	// Extract to temp directory first for safety
	tmpDir, err := os.MkdirTemp("", "labtrace_restore_")
	if err != nil {
		return fmt.Errorf("create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	if err := extractZip(zipPath, tmpDir); err != nil {
		return fmt.Errorf("extract zip: %w", err)
	}

	// Verify database file exists in extracted archive
	dbName := filepath.Base(dbPath)
	extractedDB := filepath.Join(tmpDir, dbName)
	dbData, err := os.ReadFile(extractedDB)
	if err != nil {
		return fmt.Errorf("database file not found in backup: %w", err)
	}

	// Verify it's a valid SQLite file
	if len(dbData) < 15 || string(dbData[:15]) != "SQLite format 3" {
		return fmt.Errorf("invalid database file in backup (not SQLite format)")
	}

	backupMutex.Lock()
	defer backupMutex.Unlock()

	// Copy uploaded files to the target upload directory
	backupFilesDir := filepath.Join(tmpDir, "files")
	if fi, err := os.Stat(backupFilesDir); err == nil && fi.IsDir() {
		if err := os.MkdirAll(uploadDir, 0755); err != nil {
			return fmt.Errorf("create upload dir: %w", err)
		}
		entries, err := os.ReadDir(backupFilesDir)
		if err != nil {
			return fmt.Errorf("read backup files dir: %w", err)
		}
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			src := filepath.Join(backupFilesDir, entry.Name())
			dst := filepath.Join(uploadDir, entry.Name())
			if err := copyFile(src, dst); err != nil {
				log.Printf("[restore] copy file failed: %s -> %s: %v", src, dst, err)
			}
		}
	}

	// Close current DB
	database.Close()

	// Write new database file
	if err := os.WriteFile(dbPath, dbData, 0644); err != nil {
		return fmt.Errorf("write database: %w", err)
	}

	// Reopen database
	if err := database.Open(dbPath); err != nil {
		return fmt.Errorf("reopen database: %w", err)
	}

	// Rebuild file_path columns to point to the current upload directory
	absUploadDir, err := filepath.Abs(uploadDir)
	if err != nil {
		log.Printf("[restore] get abs upload dir: %v", err)
		return nil
	}

	if err := rebuildFilePaths(absUploadDir); err != nil {
		log.Printf("[restore] rebuild file paths: %v", err)
	}

	return nil
}

// rebuildFilePaths updates file_path in lab_reports and imaging_reports to point to the current upload directory.
func rebuildFilePaths(absUploadDir string) error {
	type pathUpdate struct {
		id   int64
		path string
	}

	// lab_reports
	if rows, err := database.DB.Query(`SELECT id, file_path FROM lab_reports WHERE file_path != ''`); err == nil {
		defer rows.Close()
		var updates []pathUpdate
		for rows.Next() {
			var pu pathUpdate
			if err := rows.Scan(&pu.id, &pu.path); err == nil {
				base := filepath.Base(pu.path)
				newPath := filepath.Join(absUploadDir, base)
				if pu.path != newPath {
					updates = append(updates, pathUpdate{pu.id, newPath})
				}
			}
		}
		for _, u := range updates {
			if _, err := database.DB.Exec(`UPDATE lab_reports SET file_path = ? WHERE id = ?`, u.path, u.id); err != nil {
				log.Printf("[restore] update lab_reports path id=%d: %v", u.id, err)
			}
		}
		log.Printf("[restore] Updated %d lab_reports file paths", len(updates))
	} else {
		log.Printf("[restore] query lab_reports paths: %v", err)
	}

	// imaging_reports
	if rows, err := database.DB.Query(`SELECT id, file_path FROM imaging_reports WHERE file_path != ''`); err == nil {
		defer rows.Close()
		var updates []pathUpdate
		for rows.Next() {
			var pu pathUpdate
			if err := rows.Scan(&pu.id, &pu.path); err == nil {
				base := filepath.Base(pu.path)
				newPath := filepath.Join(absUploadDir, base)
				if pu.path != newPath {
					updates = append(updates, pathUpdate{pu.id, newPath})
				}
			}
		}
		for _, u := range updates {
			if _, err := database.DB.Exec(`UPDATE imaging_reports SET file_path = ? WHERE id = ?`, u.path, u.id); err != nil {
				log.Printf("[restore] update imaging_reports path id=%d: %v", u.id, err)
			}
		}
		log.Printf("[restore] Updated %d imaging_reports file paths", len(updates))
	} else {
		log.Printf("[restore] query imaging_reports paths: %v", err)
	}

	return nil
}

// getUploadedFilePaths returns all distinct file paths from lab_reports and imaging_reports.
func getUploadedFilePaths() ([]string, error) {
	seen := make(map[string]bool)
	var paths []string

	collect := func(query string) error {
		rows, err := database.DB.Query(query)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var p string
			if err := rows.Scan(&p); err == nil && p != "" && !seen[p] {
				seen[p] = true
				paths = append(paths, p)
			}
		}
		return nil
	}

	if err := collect(`SELECT file_path FROM lab_reports WHERE file_path != ''`); err != nil {
		return nil, err
	}
	if err := collect(`SELECT file_path FROM imaging_reports WHERE file_path != ''`); err != nil {
		return nil, err
	}

	return paths, nil
}

// addFileToZip adds a single file to a zip archive with the given zip-internal path.
func addFileToZip(zw *zip.Writer, srcPath, zipPath string) error {
	src, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer src.Close()

	info, err := src.Stat()
	if err != nil {
		return err
	}

	header, err := zip.FileInfoHeader(info)
	if err != nil {
		return err
	}
	header.Name = filepath.ToSlash(zipPath)
	header.Method = zip.Deflate

	w, err := zw.CreateHeader(header)
	if err != nil {
		return err
	}

	_, err = io.Copy(w, src)
	return err
}

// extractZip extracts all contents of a zip file to destDir.
func extractZip(zipPath, destDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()

	// Ensure destDir ends with separator for prefix check
	cleanBase := filepath.Clean(destDir)
	if !strings.HasSuffix(cleanBase, string(os.PathSeparator)) {
		cleanBase += string(os.PathSeparator)
	}

	for _, f := range r.File {
		// Convert ZIP internal forward-slash path to OS-native path
		destPath := filepath.Join(destDir, filepath.FromSlash(f.Name))

		// Prevent zip-slip attacks: ensure extracted path stays within destDir
		cleanDest := filepath.Clean(destPath)
		if !strings.HasPrefix(cleanDest+string(os.PathSeparator), cleanBase) &&
			cleanDest != filepath.Clean(destDir) {
			return fmt.Errorf("illegal file path in zip: %s", f.Name)
		}

		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(destPath, 0755); err != nil {
				return fmt.Errorf("create dir %s: %w", destPath, err)
			}
			continue
		}

		if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
			return fmt.Errorf("create parent dir for %s: %w", destPath, err)
		}

		rc, err := f.Open()
		if err != nil {
			return fmt.Errorf("open zip entry %s: %w", f.Name, err)
		}

		dst, err := os.OpenFile(destPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.Mode())
		if err != nil {
			rc.Close()
			return fmt.Errorf("create file %s: %w", destPath, err)
		}

		_, err = io.Copy(dst, rc)
		rc.Close()
		dst.Close()
		if err != nil {
			return fmt.Errorf("extract %s: %w", f.Name, err)
		}
	}

	return nil
}

// copyFile copies a file from src to dst, preserving file mode.
func copyFile(src, dst string) error {
	s, err := os.Open(src)
	if err != nil {
		return err
	}
	defer s.Close()

	info, err := s.Stat()
	if err != nil {
		return err
	}

	d, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, info.Mode())
	if err != nil {
		return err
	}
	defer d.Close()

	_, err = io.Copy(d, s)
	return err
}
