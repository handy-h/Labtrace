package main

import (
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"labtrace/internal/config"
	"labtrace/internal/database"
	"labtrace/internal/handlers"
	"labtrace/internal/middleware"
	"labtrace/internal/services"

	"github.com/gin-gonic/gin"
)

func main() {
	// Load config
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Config error: %v", err)
	}

	// Open database
	if err := database.Open(cfg.DBPath); err != nil {
		log.Fatalf("Database error: %v", err)
	}
	defer database.Close()

	// Set OCR monthly quota from config
	services.SetOCRQuotaMonthly(cfg.OCRQuotaMonthly)

	// Backfill test_item_id on existing report_items
	if n := services.BackfillTestItemIDs(); n > 0 {
		fmt.Printf("Backfilled test_item_id for %d report items\n", n)
	}

	fmt.Printf("LabTrace starting on :%s (db: %s)\n", cfg.Port, cfg.DBPath)

	// Gin router
	r := gin.Default()
	r.Use(middleware.CORS())

	// Serve web frontend
	r.Static("/web", "./web")
	r.StaticFile("/", "./web/index.html")

	// API v1
	v1 := r.Group("/api/v1")
	{
		v1.GET("/ping", handlers.Ping)

		// Subjects
		v1.GET("/subjects", handlers.ListSubjects)
		v1.POST("/subjects", handlers.CreateSubject)
		v1.GET("/subjects/:id", handlers.GetSubject)
		v1.PUT("/subjects/:id", handlers.UpdateSubject)
		v1.DELETE("/subjects/:id", handlers.DeleteSubject)

		// Hospitals
		v1.GET("/hospitals", handlers.ListHospitals)
		v1.POST("/hospitals", handlers.CreateHospital)
		v1.PUT("/hospitals/:id", handlers.UpdateHospital)
		v1.DELETE("/hospitals/:id", handlers.DeleteHospital)

		// Test Items
		v1.GET("/test-items", handlers.ListTestItems)
		v1.POST("/test-items", handlers.CreateTestItem)
		v1.PUT("/test-items/:id", handlers.UpdateTestItem)
		v1.DELETE("/test-items/:id", handlers.DeleteTestItem)

		// Test Item Aliases
		v1.GET("/test-items/:id/aliases", handlers.ListAliases)
		v1.POST("/test-items/:id/aliases", handlers.CreateAlias)
		v1.DELETE("/test-item-aliases/:aliasId", handlers.DeleteAlias)

		// Reference Intervals
		v1.GET("/test-items/:id/reference-intervals", handlers.ListRefIntervals)
		v1.POST("/test-items/:id/reference-intervals", handlers.CreateRefInterval)
		v1.PUT("/reference-intervals/:refId", handlers.UpdateRefInterval)
		v1.DELETE("/reference-intervals/:refId", handlers.DeleteRefInterval)

		// Unit Conversions
		v1.GET("/unit-conversions", handlers.ListUnitConversions)
		v1.POST("/unit-conversions", handlers.CreateUnitConversion)
		v1.PUT("/unit-conversions/:id", handlers.UpdateUnitConversion)
		v1.DELETE("/unit-conversions/:id", handlers.DeleteUnitConversion)

		// Calculation Rules
		v1.GET("/calculation-rules", handlers.ListCalcRules)
		v1.POST("/calculation-rules", handlers.CreateCalcRule)
		v1.PUT("/calculation-rules/:id", handlers.UpdateCalcRule)
		v1.DELETE("/calculation-rules/:id", handlers.DeleteCalcRule)

		// OCR & Reports
		v1.POST("/ocr/upload", handlers.Upload)
		v1.GET("/reports", handlers.ListReports)
		v1.GET("/reports/:id", handlers.GetReport)
		v1.PUT("/reports/:id", handlers.UpdateReport)
		v1.PUT("/reports/:id/items/:itemId", handlers.UpdateReportItem)
		v1.DELETE("/reports/:id/items/:itemId", handlers.DeleteReportItem)
		v1.POST("/reports/:id/confirm", handlers.ConfirmReport)
		v1.POST("/reports/:id/import", handlers.ImportReport)
		v1.POST("/reports/:id/re-ocr", handlers.ReOCR)
		v1.GET("/reports/:id/image", handlers.GetReportImage)
		v1.GET("/reports/:id/ocr-blocks", handlers.GetOCRBlocks)
		v1.POST("/reports/:id/apply-mapping", handlers.ApplyColumnMapping)

		// OCR Quota
		v1.GET("/ocr/quota", handlers.GetOCRQuota)
		v1.PUT("/ocr/quota", handlers.UpdateOCRQuota)

		// Hospital Rules
		v1.GET("/hospital-rules", handlers.ListHospitalRules)
		v1.POST("/hospital-rules", handlers.CreateHospitalRule)
		v1.PUT("/hospital-rules/:id", handlers.UpdateHospitalRule)
		v1.DELETE("/hospital-rules/:id", handlers.DeleteHospitalRule)
		v1.GET("/hospitals/:id/mapping-template", handlers.GetHospitalMappingTemplate)
		v1.POST("/hospitals/:id/mapping-template", handlers.SaveHospitalMappingTemplate)

		// Trend
		v1.GET("/trend/data", handlers.GetTrendData)

		// Dashboard
		v1.GET("/dashboard/summary", handlers.DashboardSummary)
		v1.GET("/dashboard/anomalies", handlers.DashboardAnomalies)

		// Backups
		v1.POST("/backups/export", handlers.ExportBackup)
		v1.POST("/backups/import", handlers.ImportBackup)
		v1.GET("/backups", handlers.ListBackups)
		v1.DELETE("/backups/:id", handlers.DeleteBackup)

		// Audit Logs
		v1.GET("/audit-logs", handlers.ListAuditLogs)

		// Imaging Reports
		v1.GET("/imaging-report-types", handlers.ListImagingReportTypes)
		v1.GET("/imaging-exam-items", handlers.ListImagingExamItems)
		v1.POST("/imaging/upload", handlers.UploadImagingReport)
		v1.GET("/imaging-reports", handlers.ListImagingReports)
		v1.GET("/imaging-reports/:id", handlers.GetImagingReport)
		v1.PUT("/imaging-reports/:id", handlers.UpdateImagingReport)
		v1.DELETE("/imaging-reports/:id", handlers.DeleteImagingReport)
		v1.GET("/imaging-reports/:id/image", handlers.GetImagingReportImage)
		v1.GET("/imaging-reports/:id/ocr-blocks", handlers.GetImagingOCRBlocks)
		v1.POST("/imaging-reports/:id/apply-mapping", handlers.ApplyImagingMapping)
		v1.POST("/imaging-reports/:id/confirm", handlers.ConfirmImagingReport)
		v1.POST("/imaging-reports/:id/import", handlers.ImportImagingReport)
		v1.POST("/imaging-reports/:id/re-ocr", handlers.ReOCRImagingReport)
		v1.GET("/hospitals/:id/imaging-mapping-template", handlers.GetImagingMappingTemplate)
		v1.POST("/hospitals/:id/imaging-mapping-template", handlers.SaveImagingMappingTemplate)

		// Batch Import
		v1.POST("/batch/upload", handlers.UploadBatchFiles)
		v1.POST("/batch/confirm", handlers.ConfirmBatchImport)

		// Batch Import (Imaging)
		v1.POST("/batch/imaging/upload", handlers.UploadBatchImagingFiles)
		v1.POST("/batch/imaging/confirm", handlers.ConfirmBatchImagingImport)
	}

	// Graceful shutdown
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
		<-sig
		fmt.Println("\nShutting down...")
		database.Close()
		os.Exit(0)
	}()

	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
