package services

import (
	"fmt"
	"sync/atomic"
	"time"

	"labtrace/internal/database"
)

// ocrQuotaMonthly is the monthly quota limit, set from config at startup.
var ocrQuotaMonthly int32 = 200

// SetOCRQuotaMonthly sets the monthly OCR quota from config.
func SetOCRQuotaMonthly(n int) {
	if n > 0 {
		atomic.StoreInt32(&ocrQuotaMonthly, int32(n))
	}
}

// OCRQuota represents monthly OCR usage statistics.
type OCRQuota struct {
	YearMonth    string `json:"year_month"`
	TotalQuota   int    `json:"total_quota"`
	UsedCount    int    `json:"used_count"`
	SuccessCount int    `json:"success_count"`
	FailCount    int    `json:"fail_count"`
}

// RecordOCRCall records a single OCR API call in the current month's quota.
// success=true means the Aliyun API responded successfully (regardless of OCR parsing result),
// success=false means the HTTP call to Aliyun failed.
func RecordOCRCall(success bool) error {
	ym := currentYearMonth()

	// Ensure quota row exists for this month
	err := ensureQuotaRow(ym)
	if err != nil {
		return fmt.Errorf("ensure quota row: %w", err)
	}

	if success {
		_, err = database.DB.Exec(
			`UPDATE ocr_quotas SET used_count = used_count + 1, success_count = success_count + 1, updated_at = datetime('now') WHERE year_month = ?`,
			ym,
		)
	} else {
		_, err = database.DB.Exec(
			`UPDATE ocr_quotas SET used_count = used_count + 1, fail_count = fail_count + 1, updated_at = datetime('now') WHERE year_month = ?`,
			ym,
		)
	}
	return err
}

// GetOCRQuota returns the current month's OCR quota info.
func GetOCRQuota() (*OCRQuota, error) {
	ym := currentYearMonth()
	err := ensureQuotaRow(ym)
	if err != nil {
		return nil, err
	}

	q := &OCRQuota{}
	err = database.DB.QueryRow(
		`SELECT year_month, used_count, success_count, fail_count FROM ocr_quotas WHERE year_month = ?`, ym,
	).Scan(&q.YearMonth, &q.UsedCount, &q.SuccessCount, &q.FailCount)
	if err != nil {
		return nil, fmt.Errorf("query quota: %w", err)
	}
	q.TotalQuota = int(atomic.LoadInt32(&ocrQuotaMonthly))
	return q, nil
}

// UpdateOCRQuota updates the used_count for a given month (admin manual calibration).
func UpdateOCRQuota(yearMonth string, usedCount int) error {
	// Ensure row exists
	err := ensureQuotaRow(yearMonth)
	if err != nil {
		return err
	}

	_, err = database.DB.Exec(
		`UPDATE ocr_quotas SET used_count = ?, updated_at = datetime('now') WHERE year_month = ?`,
		usedCount, yearMonth,
	)
	return err
}

// ensureQuotaRow creates a quota row for the given year_month if it doesn't exist.
func ensureQuotaRow(yearMonth string) error {
	var count int
	err := database.DB.QueryRow(`SELECT COUNT(*) FROM ocr_quotas WHERE year_month = ?`, yearMonth).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		_, err = database.DB.Exec(
			`INSERT INTO ocr_quotas (year_month, total_quota, used_count, success_count, fail_count) VALUES (?, ?, 0, 0, 0)`,
			yearMonth, int(atomic.LoadInt32(&ocrQuotaMonthly)),
		)
	}
	return err
}

// currentYearMonth returns the current year-month string (e.g., "2026-05").
func currentYearMonth() string {
	now := time.Now()
	return fmt.Sprintf("%d-%02d", now.Year(), now.Month())
}
