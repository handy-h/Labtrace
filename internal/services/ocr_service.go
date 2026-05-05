package services

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"labtrace/internal/config"
)

// OCRResult represents a single recognized element from OCR.
type OCRResult struct {
	Text        string  `json:"text"`
	Confidence  float64 `json:"confidence"`
	Left        int     `json:"left"`
	Top         int     `json:"top"`
	Width       int     `json:"width"`
	Height      int     `json:"height"`
	Row         int     `json:"row"`
}

// OCRResponse is the parsed response from Aliyun OCR.
type OCRResponse struct {
	RequestID string `json:"RequestId"`
	Data      struct {
		Content string `json:"Content"`
		PageNum int    `json:"PageNum"`
	} `json:"Data"`
	Code string `json:"Code"`
	Message string `json:"Message"`
}

// Recognize calls Aliyun OCR unified recognition API and returns structured results.
func Recognize(fileBytes []byte, cfg *config.Config) ([]OCRResult, error) {
	if cfg.AliAccessKeyID == "" || cfg.AliAccessSecret == "" {
		return nil, fmt.Errorf("Aliyun OCR credentials not configured")
	}

	// Use the OCR API endpoint
	apiURL := "https://ocr-api.cn-hangzhou.aliyuncs.com/"

	// Base64 encode the file
	fileBase64 := base64.StdEncoding.EncodeToString(fileBytes)

	// Build request parameters
	params := map[string]string{
		"Action":      "RecognizeGeneral",
		"Version":     "2021-07-07",
		"AccessKeyId": cfg.AliAccessKeyID,
		"SignatureMethod":  "HMAC-SHA1",
		"SignatureVersion": "1.0",
		"SignatureNonce":   fmt.Sprintf("%d", time.Now().UnixNano()),
		"Timestamp":        time.Now().UTC().Format("2006-01-02T15:04:05Z"),
		"Format":          "JSON",
		"Body":           fileBase64,
	}

	// Generate signature
	signature := signRequest(params, cfg.AliAccessSecret)
	params["Signature"] = signature

	// Build form data
	formData := url.Values{}
	for k, v := range params {
		formData.Set(k, v)
	}

	// Make HTTP request
	resp, err := http.Post(apiURL, "application/x-www-form-urlencoded", strings.NewReader(formData.Encode()))
	if err != nil {
		return nil, fmt.Errorf("OCR request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read OCR response: %w", err)
	}

	var ocrResp OCRResponse
	if err := json.Unmarshal(body, &ocrResp); err != nil {
		return nil, fmt.Errorf("parse OCR response: %w", err)
	}

	if ocrResp.Code != "" && ocrResp.Code != "200" {
		return nil, fmt.Errorf("OCR error: %s - %s", ocrResp.Code, ocrResp.Message)
	}

	// Parse the content - Aliyun returns structured content as JSON string
	return parseOCRContent(ocrResp.Data.Content), nil
}

// parseOCRContent parses the OCR content string into structured results.
func parseOCRContent(content string) []OCRResult {
	if content == "" {
		return nil
	}

	// Try parsing as JSON array of blocks
	var blocks []struct {
		Text       string  `json:"text"`
		Confidence float64 `json:"confidence"`
		Position   struct {
			Left   int `json:"left"`
			Top    int `json:"top"`
			Width  int `json:"width"`
			Height int `json:"height"`
		} `json:"position"`
		Row int `json:"row"`
	}

	if err := json.Unmarshal([]byte(content), &blocks); err == nil {
		results := make([]OCRResult, 0, len(blocks))
		for _, b := range blocks {
			results = append(results, OCRResult{
				Text:       b.Text,
				Confidence: b.Confidence,
				Left:       b.Position.Left,
				Top:        b.Position.Top,
				Width:      b.Position.Width,
				Height:     b.Position.Height,
				Row:        b.Row,
			})
		}
		return results
	}

	// Fallback: try parsing as simple text lines
	lines := strings.Split(content, "\n")
	results := make([]OCRResult, 0, len(lines))
	for i, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		results = append(results, OCRResult{
			Text:       line,
			Confidence: 80, // default medium confidence for unparsed
			Row:        i,
		})
	}
	return results
}

// signRequest generates the HMAC-SHA1 signature for Aliyun API request.
func signRequest(params map[string]string, accessSecret string) string {
	// Sort parameters
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	// Build canonical query string
	var buf bytes.Buffer
	for i, k := range keys {
		if i > 0 {
			buf.WriteByte('&')
		}
		buf.WriteString(url.QueryEscape(k))
		buf.WriteByte('=')
		buf.WriteString(url.QueryEscape(params[k]))
	}

	// String to sign
	stringToSign := "POST&" + url.QueryEscape("/") + "&" + url.QueryEscape(buf.String())

	// HMAC-SHA1
	mac := hmac.New(sha1.New, []byte(accessSecret+"&"))
	mac.Write([]byte(stringToSign))
	signature := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	return signature
}
