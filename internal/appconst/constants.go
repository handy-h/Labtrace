package appconst

// Pagination and upload defaults shared across handlers.
const (
	DefaultPage     = 1
	DefaultPageSize = 20
	MaxPageSize     = 100
)

// Confidence thresholds for OCR result classification.
const (
	ConfidenceHigh = 95
	ConfidenceMed  = 80
)

// OCRQuotaDefault is the monthly OCR quota default (calls per month).
const OCRQuotaDefault = 200

// MaxUploadSize is the maximum multipart form upload size (32 MiB).
const MaxUploadSize = 32 << 20
