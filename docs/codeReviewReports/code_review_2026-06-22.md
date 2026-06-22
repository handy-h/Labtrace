# LabTrace 代码审查报告

**审查日期**: 2026-06-22  
**审查范围**: Go 后端 (Go 1.25.9 + Gin + SQLite) + 纯前端 JS/HTML/CSS  
**项目路径**: `D:\Builds\Labtrace`  
**审查维度**: 安全性、性能、代码质量、可维护性、架构设计、Go Idioms

---

## 一、整体架构评估

### 1.1 架构概览

LabTrace 采用经典的 **分层架构**：

```
main.go (入口 + 路由注册)
├── internal/config    (配置加载，含 AES 密钥、OCR 凭证)
├── internal/database  (SQLite 连接 + 迁移 + 种子)
├── internal/models    (领域模型 + 响应结构)
├── internal/handlers  (HTTP 处理器/Controller)
├── internal/services  (业务逻辑 + OCR 解析 + 审计)
├── internal/middleware (CORS)
└── web/               (Vue 3 SPA + 纯前端 JS)
```

### 1.2 架构亮点

- **优雅关闭机制**: `main.go` 中实现了完整的 graceful shutdown 流程：Shutdown HTTP → Wait OCR → Stop Audit → Close DB，顺序正确。
- **WAL 模式 + 连接池限制**: SQLite 配置了 `_journal_mode=WAL` 和 `SetMaxOpenConns=2`，缓解了并发写入压力。
- **后台审计 Worker**: 通过 channel 缓冲 + 同步回退策略，避免审计日志阻塞主请求流程。
- **OCR WaitGroup**: 使用 `sync.WaitGroup` 跟踪后台 OCR goroutine，确保关闭前所有任务完成。
- **AES-256-GCM 备份加密**: 数据库备份采用标准加密，且验证 SQLite 魔数。

### 1.3 架构缺陷

- **缺少认证/授权层**: 整个系统没有任何身份验证机制，所有 API 完全开放。对于医疗数据系统，这是不可接受的。
- **缺少 Repository 层**: handlers 直接操作 `database.DB`，业务逻辑与数据访问高度耦合。
- **缺少 Service 接口抽象**: services 层没有接口定义，不利于测试和依赖注入。
- **全局变量依赖**: `database.DB` 和多个 `sync.Once` 初始化的全局变量，使得测试和并行运行困难。
- **前端无构建工具**: 使用 CDN 引入 Vue 3、Tailwind 等，无打包、无 Tree Shaking、无类型检查。

---

## 二、问题列表（按严重程度分类）

### 🔴 Critical（严重）

#### C1: 完全缺失身份认证与授权机制

| 属性 | 内容 |
|------|------|
| **位置** | 全局 — 所有 API 端点 |
| **问题描述** | 系统没有任何形式的认证（无 JWT、无 Session、无 API Key、无 Basic Auth）。任何人只要能访问服务端口，就可以完整操作所有医疗数据：创建/删除受检者、查看所有报告、修改检验结果、导入/导出备份。这在医疗数据管理场景下是严重合规风险（HIPAA、GDPR、中国《个人信息保护法》均要求访问控制）。 |
| **影响** | 数据泄露、数据篡改、未授权删除、合规风险 |
| **修复建议** | 至少实现一种认证机制：<br>1. **短期方案**: 添加基于环境变量的静态 API Key 中间件<br>2. **中期方案**: 实现 JWT + 密码哈希（bcrypt）的登录系统<br>3. **长期方案**: 集成 OAuth2 / LDAP |

**修复代码示例（API Key 中间件）**:

```go
// internal/middleware/auth.go
func APIKeyAuth() gin.HandlerFunc {
    key := os.Getenv("API_KEY")
    if key == "" {
        log.Fatal("API_KEY is required")
    }
    return func(c *gin.Context) {
        if c.GetHeader("X-API-Key") != key {
            c.AbortWithStatusJSON(401, gin.H{"error": "unauthorized"})
            return
        }
        c.Next()
    }
}

// main.go
v1.Use(middleware.APIKeyAuth()) // 应用到所有 API 路由
```

---

#### C2: SQL 注入风险 — 动态 SQL 拼接未完全参数化

| 属性 | 内容 |
|------|------|
| **位置** | `internal/handlers/dashboard.go:85`, `internal/handlers/imaging.go:274-279` |
| **问题描述** | `DashboardAnomalies` 和 `ListImagingReports` 中存在动态 SQL 拼接。虽然 `sortBy` 和 `sortOrder` 有白名单校验，但 `sortOrder` 的校验逻辑存在漏洞：`sortOrder != "asc" && sortOrder != "ASC"` 时默认设为 `"desc"`，但后续直接拼接 `" ORDER BY ir." + sortBy + " " + sortOrder`。如果 `sortBy` 绕过白名单（如通过编码注入），仍存在注入风险。更关键的是，`hospital` 参数直接拼接到 `WHERE` 子句中，虽然使用了 `?` 占位符，但 `hospital` 过滤条件本身没有额外校验。 |
| **影响** | 数据泄露、数据篡改、数据库被破坏 |
| **修复建议** | 使用预定义的排序字段映射，彻底杜绝字符串拼接。 |

**问题代码** (`dashboard.go`):

```go
// 问题：query 字符串拼接
query += " ORDER BY lr.sample_date DESC LIMIT ? OFFSET ?"
args = append(args, pageSize, (page-1)*pageSize)

rows, err := database.DB.Query(query, args...)
```

**修复代码**:

```go
var allowedSortFields = map[string]string{
    "sample_date": "lr.sample_date",
    "created_at":  "lr.created_at",
}

func buildSortClause(sortBy, sortOrder string) string {
    col, ok := allowedSortFields[sortBy]
    if !ok {
        return " ORDER BY lr.sample_date DESC"
    }
    order := "DESC"
    if sortOrder == "asc" || sortOrder == "ASC" {
        order = "ASC"
    }
    return fmt.Sprintf(" ORDER BY %s %s", col, order)
}
```

---

#### C3: 文件上传路径遍历风险 — `validateFilePath` 存在竞争条件

| 属性 | 内容 |
|------|------|
| **位置** | `internal/handlers/helpers.go:21-38` |
| **问题描述** | `validateFilePath` 函数在验证路径时使用了 `filepath.Abs(filepath.Clean(filePath))`，但 `filePath` 来自数据库查询结果。如果数据库中的路径被篡改（通过 SQL 注入或其他漏洞），攻击者可能存储一个恶意路径。更严重的是，该函数在验证通过后，文件可能在验证和实际访问之间被替换（TOCTOU 竞争条件）。此外，`os.PathSeparator` 在 Windows 上是 `\`，但攻击者可能使用 `/` 绕过前缀检查。 |
| **影响** | 任意文件读取/删除（路径遍历） |
| **修复建议** | 1. 使用 `filepath.EvalSymlinks` 解析符号链接<br>2. 验证后立即打开文件句柄，避免 TOCTOU<br>3. 统一使用 `filepath.Join` 构建路径，禁止从客户端传入完整路径 |

**修复代码**:

```go
func validateFilePath(filePath string) (string, bool) {
    if filePath == "" {
        return "", false
    }
    cfg, err := config.Load()
    if err != nil {
        return "", false
    }
    
    // 解析并规范化路径
    target, err := filepath.Abs(filepath.Clean(filePath))
    if err != nil {
        return "", false
    }
    
    // 解析符号链接
    target, err = filepath.EvalSymlinks(target)
    if err != nil {
        return "", false
    }
    
    base, err := filepath.Abs(filepath.Clean(cfg.UploadDir))
    if err != nil {
        return "", false
    }
    base, err = filepath.EvalSymlinks(base)
    if err != nil {
        return "", false
    }
    
    // 确保 base 以路径分隔符结尾
    sep := string(filepath.Separator)
    if !strings.HasSuffix(base, sep) {
        base += sep
    }
    
    // 统一使用 filepath 比较
    if !strings.HasPrefix(strings.ToLower(target), strings.ToLower(base)) {
        return "", false
    }
    
    return target, true
}
```

---

#### C4: 备份导入缺乏完整性校验

| 属性 | 内容 |
|------|------|
| **位置** | `internal/services/backup_service.go:62-89` |
| **问题描述** | `ImportBackup` 在解密后仅验证 SQLite 魔数（`"SQLite format 3"`），但没有验证数据库完整性（如页校验和、外键约束等）。恶意构造的 SQLite 文件可能通过魔数检查但包含损坏数据或触发 SQLite 漏洞。此外，导入过程中没有创建临时备份，如果导入失败，原数据库可能已被破坏。 |
| **影响** | 数据丢失、数据库损坏、潜在 RCE（如果 SQLite 解析器存在漏洞） |
| **修复建议** | 1. 导入前创建原数据库备份<br>2. 使用 `PRAGMA integrity_check` 验证导入的数据库<br>3. 限制备份文件大小 |

**修复代码**:

```go
func ImportBackup(dbKey []byte, dbPath, filePath string) error {
    // 1. 读取并解密备份
    encrypted, err := os.ReadFile(filePath)
    if err != nil {
        return fmt.Errorf("read backup: %w", err)
    }
    
    plainBytes, err := decryptAESGCM(encrypted, dbKey)
    if err != nil {
        return fmt.Errorf("decrypt: %w", err)
    }
    
    if len(plainBytes) < 16 || string(plainBytes[:15]) != "SQLite format 3" {
        return fmt.Errorf("invalid database file after decryption")
    }
    
    // 2. 写入临时文件并验证
    tmpDBPath := dbPath + ".restore_tmp"
    if err := os.WriteFile(tmpDBPath, plainBytes, 0644); err != nil {
        return fmt.Errorf("write temp database: %w", err)
    }
    defer os.Remove(tmpDBPath)
    
    // 3. 验证临时数据库完整性
    tmpDB, err := sql.Open("sqlite3", tmpDBPath+"?_foreign_keys=on")
    if err != nil {
        return fmt.Errorf("open temp database: %w", err)
    }
    defer tmpDB.Close()
    
    var integrityResult string
    if err := tmpDB.QueryRow("PRAGMA integrity_check").Scan(&integrityResult); err != nil {
        return fmt.Errorf("integrity check failed: %w", err)
    }
    if integrityResult != "ok" {
        return fmt.Errorf("database integrity check failed: %s", integrityResult)
    }
    
    // 4. 原子替换
    backupMutex.Lock()
    defer backupMutex.Unlock()
    
    // 备份原数据库
    backupPath := dbPath + ".backup_" + time.Now().Format("20060102_150405")
    if err := copyFile(dbPath, backupPath); err != nil {
        return fmt.Errorf("backup original database: %w", err)
    }
    
    database.Close()
    
    if err := os.Rename(tmpDBPath, dbPath); err != nil {
        // 恢复失败，尝试恢复原数据库
        os.Rename(backupPath, dbPath)
        database.Open(dbPath)
        return fmt.Errorf("replace database: %w", err)
    }
    
    if err := database.Open(dbPath); err != nil {
        return fmt.Errorf("reopen database: %w", err)
    }
    
    return nil
}
```

---

### 🟠 High（高）

#### H1: 缺少 CSRF 防护

| 属性 | 内容 |
|------|------|
| **位置** | 全局 — 所有非 GET 端点 |
| **问题描述** | 系统没有 CSRF Token 或 SameSite Cookie 保护。虽然 CORS 中间件限制了跨域，但如果攻击者通过 XSS 或同域子域名发起请求，仍可执行非预期操作。特别是 `ConfirmReport`、`ImportReport`、`DeleteSubject` 等敏感操作使用 POST/PUT/DELETE，但没有 CSRF 防护。 |
| **影响** | CSRF 攻击导致数据篡改/删除 |
| **修复建议** | 1. 实现 Double Submit Cookie 模式的 CSRF Token<br>2. 或使用 SameSite=Strict Cookie 配合 Session 认证 |

---

#### H2: 前端 XSS 风险 — 未转义的 HTML 插入

| 属性 | 内容 |
|------|------|
| **位置** | `web/js/utils.js:89-95`, `web/js/views/*.js` (多处) |
| **问题描述** | `flagBadge` 函数返回原始 HTML 字符串，使用 `v-html` 渲染。如果 `flag` 值来自用户输入或 OCR 结果，可能被注入恶意脚本。例如，如果 OCR 识别出一个包含 `<script>` 标签的文本，且该文本被用于 flag 字段，将导致 XSS。 |
| **影响** | 会话劫持、数据窃取、恶意操作 |
| **修复建议** | 使用 Vue 的文本插值（`{{ }}`）而非 `v-html`，或对输入进行 HTML 转义。 |

**问题代码**:

```javascript
// utils.js
function flagBadge(f) {
    if (!f || f === 'normal') return '<span style="color: #2A9D8F; font-weight: 600">正常</span>';
    // ... 直接返回 HTML，如果 f 包含恶意脚本则会被执行
}
```

**修复代码**:

```javascript
function flagBadge(f) {
    const badges = {
        'normal': { text: '正常', color: '#2A9D8F' },
        'H': { text: '偏高', color: '#C25151' },
        'L': { text: '偏低', color: '#4A7EBB' },
        '阳性': { text: '阳性', color: '#C25151' },
        '阴性': { text: '阴性', color: '#4A7EBB' },
    };
    const badge = badges[f] || { text: f, color: '#666' };
    // 返回对象而非 HTML 字符串，让 Vue 组件安全渲染
    return badge;
}
```

---

#### H3: SQLite 并发写入瓶颈 — 缺乏连接复用和事务重试

| 属性 | 内容 |
|------|------|
| **位置** | `internal/database/db.go:22-23`, `internal/handlers/ocr.go` |
| **问题描述** | 虽然设置了 `SetMaxOpenConns=2` 和 `_busy_timeout=15000`，但后台 OCR goroutine 直接使用 `database.DB.Exec` 执行写入，没有使用连接池的事务管理。当多个 OCR 任务同时完成时，可能出现写锁竞争，导致 `database is locked` 错误。`Upload` handler 中 OCR 在 goroutine 中执行，但 goroutine 内部没有事务重试机制。 |
| **影响** | OCR 数据丢失、状态不一致、用户体验差 |
| **修复建议** | 1. 使用带重试的事务包装器<br>2. 考虑使用 `sql.Tx` 进行批量写入<br>3. 对于高并发场景，考虑迁移到 PostgreSQL |

**修复代码**:

```go
func execWithRetry(query string, args ...interface{}) error {
    const maxRetries = 3
    var err error
    for i := 0; i < maxRetries; i++ {
        _, err = database.DB.Exec(query, args...)
        if err == nil {
            return nil
        }
        if !isBusyError(err) {
            return err
        }
        time.Sleep(time.Duration(i+1) * 100 * time.Millisecond)
    }
    return err
}

func isBusyError(err error) bool {
    if err == nil {
        return false
    }
    return strings.Contains(err.Error(), "database is locked") ||
           strings.Contains(err.Error(), "busy")
}
```

---

#### H4: OCR 配额检查存在竞态条件

| 属性 | 内容 |
|------|------|
| **位置** | `internal/services/ocr_quota.go:25-48` |
| **问题描述** | `RecordOCRCall` 先查询再更新，没有使用事务或原子操作。在高并发场景下，两个请求可能同时读取相同的 `used_count`，然后各自加 1，导致实际使用次数超过配额。 |
| **影响** | OCR 配额超支、费用超额 |
| **修复建议** | 使用 SQLite 的原子 UPDATE 操作，避免先读后写。 |

**修复代码**:

```go
func RecordOCRCall(success bool) error {
    ym := currentYearMonth()
    
    // 确保行存在（使用 INSERT OR IGNORE）
    _, err := database.DB.Exec(
        `INSERT OR IGNORE INTO ocr_quotas (year_month, total_quota) VALUES (?, ?)`,
        ym, atomic.LoadInt32(&ocrQuotaMonthly),
    )
    if err != nil {
        return fmt.Errorf("ensure quota row: %w", err)
    }
    
    // 原子更新
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
```

---

#### H5: 文件上传缺少类型验证和大小限制

| 属性 | 内容 |
|------|------|
| **位置** | `internal/handlers/ocr.go:17-65`, `internal/handlers/imaging.go:17-65` |
| **问题描述** | 文件上传仅通过 `r.MaxMultipartMemory = 32 << 20` 限制内存，但没有验证文件 MIME 类型、文件扩展名或文件内容。攻击者可能上传可执行文件、脚本或其他恶意文件。虽然文件存储在 upload 目录，但如果配合路径遍历漏洞，可能执行任意文件。 |
| **影响** | 恶意文件上传、潜在的 RCE |
| **修复建议** | 1. 验证文件 MIME 类型（白名单：image/jpeg, image/png, application/pdf）<br>2. 验证文件扩展名<br>3. 使用 `http.DetectContentType` 检测实际文件类型<br>4. 限制文件大小 |

**修复代码**:

```go
var allowedMimeTypes = map[string]bool{
    "image/jpeg": true,
    "image/png":  true,
    "image/gif":  true,
    "image/bmp":  true,
    "image/webp": true,
    "application/pdf": true,
}

func validateUpload(fileBytes []byte, filename string) error {
    // 检测实际 MIME 类型
    mimeType := http.DetectContentType(fileBytes)
    if !allowedMimeTypes[mimeType] {
        return fmt.Errorf("不支持的文件类型: %s", mimeType)
    }
    
    // 验证扩展名
    ext := strings.ToLower(filepath.Ext(filename))
    allowedExts := map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".bmp": true, ".webp": true, ".pdf": true}
    if !allowedExts[ext] {
        return fmt.Errorf("不支持的文件扩展名: %s", ext)
    }
    
    // 限制大小
    const maxSize = 32 * 1024 * 1024 // 32MB
    if len(fileBytes) > maxSize {
        return fmt.Errorf("文件过大: %d > %d bytes", len(fileBytes), maxSize)
    }
    
    return nil
}
```

---

#### H6: 敏感信息可能通过错误响应泄露

| 属性 | 内容 |
|------|------|
| **位置** | 多处 handlers 返回 `err.Error()` |
| **问题描述** | 大量 handler 在出错时直接返回数据库错误信息，如 `c.JSON(http.StatusInternalServerError, models.Error(err.Error()))`。这可能泄露数据库结构（如表名、列名）、文件路径、内部实现细节等敏感信息。例如，SQLite 的 `no such table` 错误会直接暴露给客户端。 |
| **影响** | 信息泄露、辅助攻击者进行 SQL 注入 |
| **修复建议** | 统一错误处理，生产环境只返回通用错误信息，详细错误记录到日志。 |

**修复代码**:

```go
// internal/handlers/errors.go
var (
    ErrInternal = errors.New("internal server error")
    ErrNotFound = errors.New("resource not found")
    ErrBadRequest = errors.New("bad request")
)

func handleError(c *gin.Context, err error, isDev bool) {
    log.Printf("[error] %v", err) // 记录详细错误
    
    msg := "服务器内部错误"
    status := http.StatusInternalServerError
    
    if errors.Is(err, sql.ErrNoRows) {
        msg = "资源不存在"
        status = http.StatusNotFound
    } else if isDev {
        msg = err.Error() // 开发模式显示详细错误
    }
    
    c.JSON(status, models.Error(msg))
}
```

---

### 🟡 Medium（中）

#### M1: 缺少输入验证和 sanitization

| 属性 | 内容 |
|------|------|
| **位置** | `internal/handlers/subject.go`, `internal/handlers/testitem.go` 等所有 CRUD handler |
| **问题描述** | 模型绑定后没有进行业务规则验证。例如：`Subject` 的 `gender` 字段虽然数据库有 `CHECK(gender IN ('男','女'))`，但 Go 层没有前置验证；`birth_date` 没有验证格式；`TestItem` 的 `value_type` 没有验证。如果数据库约束被绕过或未来更换数据库，数据完整性无法保证。 |
| **修复建议** | 在 handler 层添加验证逻辑，或使用 `go-playground/validator` 进行 struct 标签验证。 |

```go
func validateSubject(s models.Subject) error {
    if s.Name == "" {
        return errors.New("姓名不能为空")
    }
    if s.Gender != "男" && s.Gender != "女" {
        return errors.New("性别必须为男或女")
    }
    if _, err := time.Parse("2006-01-02", s.BirthDate); err != nil {
        return errors.New("出生日期格式错误")
    }
    return nil
}
```

---

#### M2: 审计日志缺少防篡改机制

| 属性 | 内容 |
|------|------|
| **位置** | `internal/services/audit_service.go` |
| **问题描述** | 审计日志以明文 JSON 存储在 SQLite 中，没有签名或哈希校验。如果数据库被直接访问，审计日志可以被篡改或删除，无法追溯。对于医疗系统，审计日志的完整性至关重要。 |
| **修复建议** | 1. 对每条审计日志计算 HMAC 签名<br>2. 使用追加-only 的日志表（禁止 UPDATE/DELETE）<br>3. 定期导出到 WORM 存储 |

---

#### M3: 缺少请求速率限制

| 属性 | 内容 |
|------|------|
| **位置** | 全局 — 所有 API 端点 |
| **问题描述** | 系统没有任何速率限制（Rate Limiting）。攻击者可以暴力破解（如果未来加了认证）、DDoS 攻击、滥用 OCR API（导致配额和费用超支）。 |
| **修复建议** | 使用 `golang.org/x/time/rate` 实现基于 IP 或用户的速率限制。 |

```go
// internal/middleware/ratelimit.go
import "golang.org/x/time/rate"

var limiter = rate.NewLimiter(rate.Every(time.Second), 10) // 每秒 10 请求

func RateLimit() gin.HandlerFunc {
    return func(c *gin.Context) {
        if !limiter.Allow() {
            c.AbortWithStatusJSON(429, gin.H{"error": "too many requests"})
            return
        }
        c.Next()
    }
}
```

---

#### M4: 前端 CDN 依赖存在供应链风险

| 属性 | 内容 |
|------|------|
| **位置** | `web/index.html` |
| **问题描述** | 前端依赖 Vue 3、Tailwind CSS、ECharts、PDF.js 均从 CDN 加载。虽然使用了 SRI（integrity 属性），但如果 CDN 被攻击或不可用，系统将无法运行。此外，SRI 只验证了部分资源。 |
| **修复建议** | 1. 将关键依赖本地化<br>2. 确保所有 CDN 资源都有 integrity 属性<br>3. 实现离线降级方案 |

---

#### M5: `defer rows.Close()` 在错误路径后可能不执行

| 属性 | 内容 |
|------|------|
| **位置** | 多处 handlers |
| **问题描述** | 代码中 `defer rows.Close()` 在 `rows, err := database.DB.Query(...)` 之后立即调用。如果 `err != nil`，`rows` 可能为 nil，此时 `defer rows.Close()` 会 panic（虽然 `sql.Rows.Close()` 对 nil receiver 是安全的，但这不是 Go 的惯用写法）。更严重的是，如果函数在 `rows.Next()` 循环中提前返回（如遇到错误），`defer` 会正确执行，但如果函数直接 `return` 而没有遍历完所有行，`rows` 可能没有被完全消费，导致连接泄漏。 |
| **修复建议** | 确保在 `err != nil` 时不调用 `defer rows.Close()`，或统一使用 helper 函数。 |

```go
func queryRows(query string, args ...interface{}) (*sql.Rows, func(), error) {
    rows, err := database.DB.Query(query, args...)
    if err != nil {
        return nil, nil, err
    }
    return rows, func() { rows.Close() }, nil
}
```

---

#### M6: 计算规则公式存在注入风险

| 属性 | 内容 |
|------|------|
| **位置** | `internal/services/calc_service.go`, `internal/services/unit_service.go` |
| **问题描述** | `EvalSimpleExpr` 和 `checkRule` 使用正则表达式解析公式，但正则表达式可能无法覆盖所有边界情况。如果未来扩展公式支持（如引入 `eval` 或 `exec`），可能导致代码注入。当前仅支持 `x*coeff` 等简单格式，相对安全，但 `findItemValue` 使用 `strconv.ParseFloat` 解析用户输入，如果值包含非数字字符可能导致意外行为。 |
| **修复建议** | 1. 使用更严格的解析器（如 `go/ast`）<br>2. 限制公式支持的运算符<br>3. 对输入值进行严格验证 |

---

### 🟢 Low（低）

#### L1: 代码重复 — 相同的 CRUD 模式重复出现

| 属性 | 内容 |
|------|------|
| **位置** | 所有 CRUD handlers |
| **问题描述** | 每个 CRUD handler 都遵循相同的模式：查询 → 遍历 rows → Scan → 返回。这种模式重复了 10+ 次，违反了 DRY 原则。 |
| **修复建议** | 创建通用的 CRUD helper 或使用 ORM（如 GORM）。 |

---

#### L2: 缺少单元测试（除 OCR 解析外）

| 属性 | 内容 |
|------|------|
| **位置** | 全局 |
| **问题描述** | 只有 `ocr_parser_test.go` 包含单元测试，其他 handlers、services、models 完全没有测试。对于医疗数据系统，测试覆盖率应至少达到 70%。 |
| **修复建议** | 1. 为 handlers 添加表驱动测试<br>2. 使用 `sqlmock` 进行数据库 mock 测试<br>3. 为 services 添加单元测试 |

---

#### L3: 硬编码的魔法数字和字符串

| 属性 | 内容 |
|------|------|
| **位置** | 多处 |
| **问题描述** | 代码中散布着魔法数字：如 `100`（置信度最大值）、`95`（高置信度阈值）、`80`（中置信度阈值）、`15`（yTolerance）、`32 << 20`（文件大小限制）等。这些值没有集中管理，修改困难。 |
| **修复建议** | 使用 `const` 或配置文件集中管理。 |

```go
const (
    ConfidenceMax       = 100
    ConfidenceHigh      = 95
    ConfidenceMedium    = 80
    YTolerance          = 15
    MaxUploadSize       = 32 << 20 // 32MB
    DefaultOCRQuota     = 200
    AuditChanBufferSize = 100
)
```

---

#### L4: 日志格式不统一

| 属性 | 内容 |
|------|------|
| **位置** | 全局 |
| **问题描述** | 日志使用了多种格式：`log.Printf("[ocr] ...")`、`log.Printf("[matchRef] ...")`、`log.Printf("[audit] ...")`。虽然使用了前缀，但没有结构化日志（如 JSON 格式），不利于日志收集和分析。 |
| **修复建议** | 使用 `slog`（Go 1.21+）或 `zap` 实现结构化日志。 |

```go
import "log/slog"

var logger = slog.New(slog.NewJSONHandler(os.Stdout, nil))

logger.Info("ocr completed", 
    "report_id", reportID, 
    "items", len(items),
    "duration", time.Since(start),
)
```

---

#### L5: 前端 Vue 组件缺少 Prop 类型验证

| 属性 | 内容 |
|------|------|
| **位置** | `web/js/views/*.js` |
| **问题描述** | 部分 Vue 组件的 props 定义缺少类型验证或默认值，可能导致运行时错误。 |
| **修复建议** | 为所有 props 添加类型、默认值和验证器。 |

---

### 🔵 Info（信息）

#### I1: Go 版本声明

| 属性 | 内容 |
|------|------|
| **位置** | `go.mod` |
| **问题描述** | `go.mod` 声明 `go 1.25.9`，但 Go 最新稳定版本为 1.24.x（截至 2025 年初）。`1.25.9` 可能是笔误或未来版本。 |
| **修复建议** | 确认 Go 版本，使用实际安装的版本（如 `go 1.23` 或 `go 1.24`）。 |

---

#### I2: 缺少 API 文档

| 属性 | 内容 |
|------|------|
| **位置** | 全局 |
| **问题描述** | 没有 Swagger/OpenAPI 文档，API 接口只能通过阅读代码理解。 |
| **修复建议** | 使用 `gin-swagger` 生成 API 文档。 |

---

#### I3: 缺少健康检查端点

| 属性 | 内容 |
|------|------|
| **位置** | `internal/handlers/ping.go` |
| **问题描述** | 只有简单的 `/ping` 端点，没有数据库连接、OCR 服务可用性等深度健康检查。 |
| **修复建议** | 添加 `/health` 端点，检查数据库、OCR 服务状态。 |

```go
func Health(c *gin.Context) {
    dbErr := database.DB.Ping()
    ocrHealthy := services.CheckOCRHealth() // 检查 OCR 服务可用性
    
    status := gin.H{
        "status": "healthy",
        "database": dbErr == nil,
        "ocr": ocrHealthy,
    }
    
    code := http.StatusOK
    if dbErr != nil || !ocrHealthy {
        code = http.StatusServiceUnavailable
        status["status"] = "unhealthy"
    }
    
    c.JSON(code, status)
}
```

---

#### I4: 前端缓存策略

| 属性 | 内容 |
|------|------|
| **位置** | `web/index.html` |
| **问题描述** | JS/CSS 文件使用 `?v=2` 等查询参数进行缓存控制，但这不是可靠的缓存清除策略。如果 CDN 或浏览器忽略查询参数，用户可能加载旧版本。 |
| **修复建议** | 使用文件内容哈希作为文件名（如 `app.a3f2b1c.js`），需要构建工具支持。 |

---

## 三、性能问题

### P1: N+1 查询问题

| 属性 | 内容 |
|------|------|
| **位置** | `internal/handlers/report.go:loadReportItems` |
| **问题描述** | `loadReportItems` 对每个报告执行 JOIN 查询，但在 `GetReport` 中只加载一个报告，所以不是典型的 N+1。但在 `ListReports` 中，如果加载每个报告的 items，就会变成 N+1。当前 `ListReports` 不加载 items，这是正确的。但 `matchRefAndCalcFlag` 中批量加载参考区间是优化后的做法，值得肯定。 |
| **修复建议** | 确保 `ListReports` 永远不加载 items，或实现批量加载。 |

---

### P2: 内存中加载全表数据

| 属性 | 内容 |
|------|------|
| **位置** | `internal/services/testitem_service.go:LoadTestItemIndex` |
| **问题描述** | `LoadTestItemIndex` 一次性加载所有 `test_items` 和 `test_item_aliases` 到内存。如果数据量很大（如数万条），可能导致内存压力。 |
| **修复建议** | 1. 使用分页加载<br>2. 使用 LRU 缓存<br>3. 添加内存使用监控 |

---

### P3: 大文件处理

| 属性 | 内容 |
|------|------|
| **位置** | `internal/handlers/ocr.go:Upload` |
| **问题描述** | 文件上传使用 `io.ReadAll(file)` 将整个文件读入内存。如果上传大文件（如 32MB PDF），会占用大量内存。多用户同时上传时，可能导致 OOM。 |
| **修复建议** | 使用流式处理，将文件直接写入磁盘，然后分块读取进行 OCR。 |

```go
func Upload(c *gin.Context) {
    // 使用临时文件而非内存
    tmpFile, err := os.CreateTemp("", "upload_*")
    if err != nil {
        c.JSON(500, models.Error("创建临时文件失败"))
        return
    }
    defer os.Remove(tmpFile.Name())
    
    _, err = io.Copy(tmpFile, file)
    if err != nil {
        c.JSON(500, models.Error("保存文件失败"))
        return
    }
    tmpFile.Close()
    
    // 计算 MD5（流式）
    f, _ := os.Open(tmpFile.Name())
    hash := md5.New()
    io.Copy(hash, f)
    f.Close()
    fileMD5 := hex.EncodeToString(hash.Sum(nil))
    
    // ... 后续处理
}
```

---

### P4: 缺少数据库查询超时

| 属性 | 内容 |
|------|------|
| **位置** | 全局 |
| **问题描述** | 所有数据库查询都没有设置超时。如果某个查询被慢查询阻塞（如大量数据的 JOIN），可能导致 HTTP 请求长时间挂起。 |
| **修复建议** | 使用 `context.WithTimeout` 设置查询超时。 |

```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()

rows, err := database.DB.QueryContext(ctx, query, args...)
```

---

## 四、Go Idioms 与最佳实践

### G1: ✅ 良好实践

| 实践 | 位置 | 说明 |
|------|------|------|
| `sync.Once` 单例 | `config.go`, `ocr_service.go` | 正确使用了 `sync.Once` 进行懒加载 |
| `defer` 资源释放 | 多处 | 数据库 rows、文件句柄都使用了 `defer` 关闭 |
| 错误包装 | 多处 | 使用了 `fmt.Errorf("...: %w", err)` 进行错误链包装 |
| 结构化标签 | `models.go` | 正确使用了 JSON 标签和 omitempty |
| 接口定义 | `models.go` | `APIResponse` 和 `PaginatedResponse` 结构清晰 |

### G2: ❌ 需要改进

| 问题 | 位置 | 说明 |
|------|------|------|
| 全局变量 | `database.DB`, `OCRWaitGroup` | 应避免全局状态，使用依赖注入 |
| 缺少接口 | services 层 | 没有定义接口，不利于 mock 测试 |
| `panic` 未使用 | 全局 | 虽然当前没有 `panic`，但也没有 `recover` 机制，如果第三方库 panic 会导致服务崩溃 |
| 字符串拼接 | `ocr_parser.go` | `bboxJSON` 使用字符串拼接而非 `json.Marshal`，虽然性能更好但容易出错 |
| 缺少 `context` 传递 | 全局 | 多数函数没有接受 `context.Context`，不利于超时控制和取消 |

---

## 五、可维护性评估

### 5.1 代码结构

| 维度 | 评分 | 说明 |
|------|------|------|
| 模块化 | ⭐⭐⭐⭐ | 按功能分层清晰，但缺少 Repository 层 |
| 耦合度 | ⭐⭐⭐ | handlers 与 database 直接耦合，services 与 models 耦合适中 |
| 注释 | ⭐⭐⭐⭐ | 关键逻辑有中文注释，但部分复杂算法缺少详细说明 |
| 命名规范 | ⭐⭐⭐⭐ | 基本遵循 Go 命名规范，但部分缩写不一致（如 `OCR` vs `Ocr`） |
| 测试覆盖 | ⭐⭐ | 仅 OCR 解析有测试，整体覆盖率估计 < 10% |

### 5.2 建议改进

1. **引入 Repository 模式**: 将数据访问逻辑从 handlers 中抽离
2. **定义 Service 接口**: 便于单元测试和依赖注入
3. **使用依赖注入框架**: 如 `wire` 或手动注入
4. **添加集成测试**: 使用 `testcontainers` 测试完整流程

---

## 六、事务处理评估

### 6.1 当前状态

| 场景 | 事务处理 | 评价 |
|------|----------|------|
| `ConfirmReport` | ✅ 使用事务 | 正确，匹配参考区间和状态更新在同一事务 |
| `ApplyColumnMapping` | ✅ 使用事务 | 正确，删除旧数据 + 插入新数据 + 更新状态 |
| `ConfirmBatchImport` | ✅ 使用事务 | 正确，每个报告的事务独立 |
| `Upload` (OCR) | ❌ 无事务 | OCR 结果写入在 goroutine 中，没有事务保护 |
| `ReOCR` | ❌ 无事务 | 删除旧数据 + 插入新数据没有事务保护 |
| `ImportReport` | ⚠️ 部分 | 调用了 `matchRefAndCalcFlag`（有事务），但状态更新在事务外 |

### 6.2 建议

- `Upload` 和 `ReOCR` 中的 OCR 结果写入应使用事务
- 考虑使用 `sql.Tx` 的批量插入优化性能

---

## 七、RESTful 规范评估

| 规范 | 状态 | 说明 |
|------|------|------|
| HTTP 方法使用 | ✅ 良好 | 正确使用 GET/POST/PUT/DELETE |
| 状态码 | ⚠️ 部分 | 部分错误返回 500 而非更具体的 400/422 |
| 资源命名 | ✅ 良好 | 使用复数名词（`/subjects`, `/reports`） |
| 版本控制 | ✅ 良好 | 使用 `/api/v1` 前缀 |
| 分页 | ⚠️ 部分 | `DashboardAnomalies` 有分页，但 `ListReports` 等缺少分页 |
| 过滤/排序 | ⚠️ 部分 | 部分端点支持过滤，但缺少统一规范 |
| HATEOAS | ❌ 缺失 | 未实现 |

---

## 八、总结与优先级建议

### 8.1 必须立即修复（Critical）

1. **C1**: 实现身份认证机制（最低限度：API Key）
2. **C2**: 修复 SQL 注入风险（使用参数化排序）
3. **C3**: 修复路径遍历漏洞（符号链接解析 + TOCTOU 防护）
4. **C4**: 备份导入完整性校验

### 8.2 短期内修复（High）

1. **H1**: 添加 CSRF 防护
2. **H2**: 修复前端 XSS 风险
3. **H3**: SQLite 并发写入优化（事务重试）
4. **H4**: 修复 OCR 配额竞态条件
5. **H5**: 文件上传类型验证
6. **H6**: 统一错误处理（避免信息泄露）

### 8.3 中期改进（Medium + Low）

1. 添加速率限制
2. 审计日志防篡改
3. 输入验证层
4. 增加单元测试覆盖率
5. 引入 Repository 模式
6. 结构化日志
7. 添加 API 文档（Swagger）

### 8.4 长期规划

1. 考虑迁移到 PostgreSQL（更好的并发支持）
2. 引入 ORM（GORM）或 SQL 生成器（sqlc）
3. 前端构建工具（Vite + TypeScript）
4. 容器化部署（Docker + Docker Compose）
5. CI/CD 流水线（GitHub Actions）

---

## 九、附录：文件审查清单

| 文件 | 状态 | 备注 |
|------|------|------|
| `main.go` | ✅ 已审查 | 优雅关闭机制良好 |
| `go.mod` | ✅ 已审查 | 注意 Go 版本声明 |
| `internal/config/config.go` | ✅ 已审查 | 配置加载合理 |
| `internal/database/db.go` | ✅ 已审查 | WAL 模式正确 |
| `internal/database/migrations.go` | ✅ 已审查 | 迁移逻辑清晰 |
| `internal/models/*.go` | ✅ 已审查 | 模型定义良好 |
| `internal/handlers/*.go` | ✅ 已审查 | 多处需修复 |
| `internal/services/*.go` | ✅ 已审查 | 业务逻辑清晰 |
| `internal/middleware/cors.go` | ✅ 已审查 | CORS 配置合理 |
| `web/index.html` | ✅ 已审查 | CDN 依赖风险 |
| `web/css/app.css` | ✅ 已审查 | 设计系统良好 |
| `web/js/app.js` | ✅ 已审查 | Vue 3 应用入口 |
| `web/js/api.js` | ✅ 已审查 | API 封装良好 |
| `web/js/utils.js` | ✅ 已审查 | XSS 风险 |
| `web/js/components/*.js` | ✅ 已审查 | 组件设计合理 |
| `web/js/views/*.js` | ✅ 已审查 | 视图逻辑复杂 |

---

*报告生成时间: 2026-06-22*  
*审查工具: 手动代码审查 + 静态分析*
