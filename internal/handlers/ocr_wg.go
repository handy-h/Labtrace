package handlers

import "sync"

// OCRWaitGroup 跟踪所有后台 OCR goroutine，供优雅关闭时等待。
var OCRWaitGroup sync.WaitGroup
