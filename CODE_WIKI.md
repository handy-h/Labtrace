# LabTrace Code Wiki

## 目录

- [项目概述](#项目概述)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [架构设计](#架构设计)
- [核心模块](#核心模块)
- [API接口](#api接口)
- [数据库设计](#数据库设计)
- [前端架构](#前端架构)
- [配置与部署](#配置与部署)

---

## 项目概述

### 项目简介
LabTrace（溯源健康）是一个个人纵向检验数据管理平台，通过专业数据治理手段，解决个人在多医疗机构间的检验数据孤岛问题。

### 核心功能
1. **检验报告单批量数字化** - 上传图片/PDF，阿里云OCR统一识别，渐进式解析
2. **OCR置信度校核** - 高/中/低三级视觉反馈，强制人工确认低置信度项
3. **沉浸式比对视图** - 左侧原图同步滚动 + 右侧数据网格，OCR映射向导辅助字段映射
4. **纵向健康趋势分析** - 多源合并折线图，动态参考带，数据下钻
5. **生物参考区间动态匹配** - 根据受检者性别/采样当日年龄自动匹配
6. **单位标准化引擎** - 预设转换矩阵 + 安全阀验证
7. **计算勾稽校验** - 入库前自动校验（如总蛋白=白蛋白+球蛋白）
8. **检验项目分类** - 支持分类管理、归一化、按分类筛选报告
9. **数据私有化** - 本地SQLite + AES-256-GCM加密备份

---

## 技术栈

| 层次 | 技术 |
|------|------|
| **后端** | Go 1.25 + Gin v1.12 |
| **数据库** | SQLite3 (WAL模式) |
| **前端** | Vue 3 + Tailwind CSS (CDN) |
| **图表** | ECharts 5 |
| **OCR** | 阿里云OCR统一识别接口 |
| **加密** | AES-256-GCM |

### 依赖管理

```
module labtrace

go 1.25.9

require (
	github.com/alibabacloud-go/darabonba-openapi/v2 v2.0.11
	github.com/alibabacloud-go/ocr-api-20210707/v3 v3.1.3
	github.com/alibabacloud-go/tea v1.2.2
	github.com/gin-gonic/gin v1.12.0
	github.com/joho/godotenv v1.5.1
	github.com/mattn/go-sqlite3 v1.14.44
)
```

---

## 项目结构

```
LabTrace/
├── main.go                          # 入口文件，路由注册，优雅关闭
├── Makefile                         # 构建脚本
├── go.mod/go.sum                    # Go模块依赖
├── .env.example                     # 环境变量示例
├── AGENTS.md                        # 开发指南
├── CLAUDE.md                        # 详细架构文档
├── README.md                        # 项目说明
│
├── internal/                        # 后端核心代码
│   ├── config/
│   │   └── config.go                # 配置加载与管理
│   ├── database/
│   │   ├── db.go                    # SQLite连接管理
│   │   ├── migrations.go            # 数据库迁移
│   │   └── seed.go                  # 初始数据植入
│   ├── models/
│   │   └── models.go                # 数据模型定义
│   ├── handlers/                    # HTTP处理器层
│   │   ├── ping.go                  # 健康检查
│   │   ├── subject.go               # 受检者管理
│   │   ├── testitem.go              # 检验项目管理
│   │   ├── unit.go                  # 单位转换
│   │   ├── calc.go                  # 计算规则
│   │   ├── category.go              # 报告分类
│   │   ├── ocr.go                   # OCR处理
│   │   ├── ocr_quota.go             # OCR配额
│   │   ├── report.go                # 报告管理
│   │   ├── rule.go                  # 医院规则
│   │   ├── trend.go                 # 趋势分析
│   │   ├── dashboard.go             # 仪表盘
│   │   ├── backup.go                # 备份恢复
│   │   ├── audit.go                 # 审计日志
│   │   └── helpers.go               # 辅助函数
│   ├── services/                    # 业务逻辑层
│   │   ├── ocr_service.go           # OCR识别服务
│   │   ├── ocr_parser.go            # OCR结果解析
│   │   ├── ocr_quota.go             # 配额管理
│   │   ├── unit_service.go          # 单位转换引擎
│   │   ├── reference_service.go     # 参考区间匹配
│   │   ├── flag_service.go          # 异常标志计算
│   │   ├── calc_service.go          # 计算勾稽校验
│   │   ├── dict_service.go          # 数据字典
│   │   ├── testitem_service.go      # 检验项目服务
│   │   ├── trend_service.go         # 趋势数据服务
│   │   ├── backup_service.go        # 加密备份
│   │   └── audit_service.go         # 审计日志
│   └── middleware/
│       └── cors.go                  # CORS中间件
│
├── web/                             # 前端代码（CDN加载，无构建）
│   ├── index.html                   # HTML入口
│   ├── css/
│   │   └── app.css                  # 全局样式 + 设计系统
│   └── js/
│       ├── app.js                   # Vue 3应用入口 + 路由
│       ├── api.js                   # API请求封装
│       ├── utils.js                 # 工具函数
│       ├── views/                   # 视图组件
│       │   ├── dashboard.js         # 仪表盘
│       │   ├── ocr-import.js        # OCR上传视图
│       │   ├── ocr-mapping-wizard.js# OCR映射向导
│       │   ├── subjects.js          # 受检者管理
│       │   ├── test-items.js        # 检验项目库
│       │   ├── trend.js             # 趋势分析
│       │   └── settings.js          # 设置页
│       └── components/              # 可复用组件
│           ├── data-table.js        # 数据表格
│           ├── crud-modal.js        # CRUD弹窗
│           ├── search-dropdown.js   # 搜索下拉
│           ├── subject-selector.js  # 受检者选择器
│           ├── sparkline.js         # 迷你图表
│           └── drilldown-popup.js   # 数据下钻弹窗
│
├── data/                            # 运行时数据（gitignore）
│   ├── labtrace.db                  # SQLite数据库
│   ├── uploads/                     # 上传文件目录
│   └── backups/                     # 备份文件目录
│
├── docs/                            # 文档
│   ├── requirements/                # 需求文档
│   └── bugfix/                      # 修复记录
│
└── example/                         # 示例数据
    ├── *.pdf                        # 示例报告
    └── ocr.txt                      # OCR结果示例
```

---

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                        前端 (Vue 3)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   仪表盘     │  │   OCR上传    │  │  趋势分析    │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  受检者管理  │  │  检验项目库  │  │    设置      │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                  后端 (Go + Gin)                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │              HTTP 路由层 (handlers)                 │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │              业务逻辑层 (services)                  │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │              数据访问层 (database)                  │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│              SQLite3 (WAL 模式 + 外键约束)                 │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                    阿里云 OCR API                         │
└─────────────────────────────────────────────────────────┘
```

### 设计原则

1. **简洁架构** - 无复杂ORM/DAO层，直接使用`database/sql`
2. **统一API响应** - 所有接口返回`{code, message, data}`格式
3. **幂等迁移** - 使用`CREATE TABLE IF NOT EXISTS` + `ALTER TABLE`安全升级
4. **前端无构建** - Vue 3/Tailwind/ECharts全部通过CDN加载
5. **数据安全** - AES-256-GCM加密备份，本地存储

---

## 核心模块

### 1. 配置管理

**文件**: [internal/config/config.go](file:///c:/Users/handy/Builds/Labtrace/internal/config/config.go)

**功能**:
- 加载环境变量（`.env`文件或系统环境变量）
- 验证必填配置（`DB_KEY`）
- 提供默认值

**Config 结构体**:

```go
type Config struct {
	DBKey           []byte   // 32字节AES-256密钥（16进制字符串）
	AliAccessKeyID  string   // 阿里云AccessKey ID
	AliAccessSecret string   // 阿里云AccessKey Secret
	Port            string   // HTTP服务端口（默认8080）
	UploadDir       string   // 上传文件目录（默认data/uploads）
	BackupDir       string   // 备份文件目录（默认data/backups）
	DBPath          string   // 数据库文件路径（默认data/labtrace.db）
	OCRQuotaMonthly int      // 月度OCR配额（默认200）
}
```

### 2. 数据库管理

**文件**: [internal/database/db.go](file:///c:/Users/handy/Builds/Labtrace/internal/database/db.go)

**关键特性**:
- SQLite WAL模式（Write-Ahead Logging）
- `SetMaxOpenConns(2)` - 允许并发读+写
- 自动执行迁移和数据植入

**连接参数**:

```go
DB, err = sql.Open("sqlite3", dbPath+
    "?_journal_mode=WAL"+        // WAL日志模式
    "&_foreign_keys=on"+         // 启用外键约束
    "&_busy_timeout=5000")       // 锁等待超时5秒
```

### 3. 数据模型

**文件**: [internal/models/models.go](file:///c:/Users/handy/Builds/Labtrace/internal/models/models.go)

#### 核心实体

| 模型 | 说明 |
|------|------|
| `Subject` | 受检者（姓名、性别、出生日期） |
| `Hospital` | 医院（名称、等级） |
| `TestItem` | 检验项目（编码、标准名、分类、默认单位、值类型） |
| `TestItemAlias` | 检验项目别名（支持医院级别名） |
| `ReferenceInterval` | 参考区间（性别、年龄分段、值范围） |
| `UnitConversion` | 单位转换规则（公式、示例） |
| `CalculationRule` | 计算勾稽规则 |
| `ReportCategory` | 报告分类 |
| `LabReport` | 检验报告单（受检者、医院、采样日期、OCR状态） |
| `ReportItem` | 报告数据项（原始值、标准化值、置信度、参考区间、标志） |
| `HospitalRule` | 医院解析规则（列映射） |
| `Backup` | 备份记录 |
| `AuditLog` | 审计日志 |

#### API响应

```go
type APIResponse struct {
	Code    int         `json:"code"`    // 0=成功, 1=失败
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

func Success(data interface{}) APIResponse  // 成功响应
func Error(msg string) APIResponse         // 错误响应
```

### 4. OCR服务

**文件**: [internal/services/ocr_service.go](file:///c:/Users/handy/Builds/Labtrace/internal/services/ocr_service.go)

**功能**:
- 调用阿里云OCR RecognizeAllText API
- 支持图片和PDF（多页）
- 解析OCR结果，返回结构化文本块
- 坐标转换（中心点 → 左上角）
- 行号分组

**OCRResult 结构体**:

```go
type OCRResult struct {
	Text        string  // 识别文本
	Confidence  float64 // 置信度
	Left        int     // 左上角X坐标
	Top         int     // 左上角Y坐标
	Width       int     // 宽度
	Height      int     // 高度
	Row         int     // 行号
	PageIndex   int     // 页索引（0-based）
	HasPosition bool    // 是否有有效坐标
	ColIndex    int     // 表格列索引
	RowStart    int     // 表格行起始
	RowEnd      int     // 表格行结束
	ColStart    int     // 表格列起始
	ColEnd      int     // 表格列结束
}
```

**OCR请求配置**:

```go
request := &ocr_api.RecognizeAllTextRequest{
	Body:             fileBytes,
	Type:             "Advanced",           // 高精度模式
	OutputCoordinate: "rectangle",          // 返回矩形坐标
	OutputOricoord:   true,                 // 原图坐标
	AdvancedConfig: &AdvancedConfig{
		OutputTable: true,                  // 输出表格结构
		OutputRow:   true,                  // 输出行信息
	},
}
```

### 5. 业务服务

| 服务 | 文件 | 功能 |
|------|------|------|
| `unit_service.go` | 单位转换引擎，公式计算 |
| `reference_service.go` | 参考区间动态匹配（性别/年龄） |
| `flag_service.go` | 异常标志计算（H/L/阳性/阴性） |
| `calc_service.go` | 计算勾稽校验（如总蛋白=白蛋白+球蛋白） |
| `testitem_service.go` | 检验项目回填、别名匹配 |
| `trend_service.go` | 趋势数据聚合 |
| `backup_service.go` | AES-256-GCM加密备份/恢复 |
| `audit_service.go` | 审计日志记录 |

---

## API接口

### 路由概览

**文件**: [main.go](file:///c:/Users/handy/Builds/Labtrace/main.go)

所有路由前缀为 `/api/v1`

#### 健康检查
- `GET /ping` - 健康检查

#### 受检者管理
- `GET /subjects` - 列表
- `POST /subjects` - 创建
- `GET /subjects/:id` - 详情
- `PUT /subjects/:id` - 更新
- `DELETE /subjects/:id` - 删除

#### 医院管理
- `GET /hospitals` - 列表
- `POST /hospitals` - 创建
- `PUT /hospitals/:id` - 更新
- `DELETE /hospitals/:id` - 删除

#### 检验项目管理
- `GET /test-items` - 列表
- `POST /test-items` - 创建
- `PUT /test-items/:id` - 更新
- `DELETE /test-items/:id` - 删除
- `GET /test-items/:id/aliases` - 别名列表
- `POST /test-items/:id/aliases` - 创建别名
- `DELETE /test-item-aliases/:aliasId` - 删除别名
- `GET /test-items/:id/reference-intervals` - 参考区间列表
- `POST /test-items/:id/reference-intervals` - 创建参考区间
- `PUT /reference-intervals/:refId` - 更新参考区间
- `DELETE /reference-intervals/:refId` - 删除参考区间

#### 单位转换
- `GET /unit-conversions` - 列表
- `POST /unit-conversions` - 创建
- `PUT /unit-conversions/:id` - 更新
- `DELETE /unit-conversions/:id` - 删除

#### 计算规则
- `GET /calculation-rules` - 列表
- `POST /calculation-rules` - 创建
- `PUT /calculation-rules/:id` - 更新
- `DELETE /calculation-rules/:id` - 删除

#### 报告分类
- `GET /categories` - 列表
- `POST /categories` - 创建
- `PUT /categories/:id` - 更新
- `DELETE /categories/:id` - 删除
- `POST /categories/normalize` - 归一化

#### OCR与报告
- `POST /ocr/upload` - 上传并识别
- `GET /reports` - 报告列表
- `GET /reports/:id` - 报告详情
- `PUT /reports/:id` - 更新报告
- `PUT /reports/:id/items/:itemId` - 更新报告项
- `DELETE /reports/:id/items/:itemId` - 删除报告项
- `POST /reports/:id/confirm` - 确认报告
- `POST /reports/:id/import` - 导入报告
- `POST /reports/:id/re-ocr` - 重新OCR
- `GET /reports/:id/image` - 获取报告图片
- `GET /reports/:id/ocr-blocks` - 获取OCR块
- `POST /reports/:id/apply-mapping` - 应用列映射

#### OCR配额
- `GET /ocr/quota` - 获取配额
- `PUT /ocr/quota` - 更新配额

#### 医院规则
- `GET /hospital-rules` - 列表
- `POST /hospital-rules` - 创建
- `PUT /hospital-rules/:id` - 更新
- `DELETE /hospital-rules/:id` - 删除
- `GET /hospitals/:id/mapping-template` - 获取映射模板
- `POST /hospitals/:id/mapping-template` - 保存映射模板

#### 趋势分析
- `GET /trend/data` - 获取趋势数据

#### 仪表盘
- `GET /dashboard/summary` - 统计摘要
- `GET /dashboard/anomalies` - 异常列表

#### 备份
- `POST /backups/export` - 导出备份
- `POST /backups/import` - 导入备份
- `GET /backups` - 备份列表
- `DELETE /backups/:id` - 删除备份

#### 审计日志
- `GET /audit-logs` - 审计日志列表

---

## 数据库设计

**文件**: [internal/database/migrations.go](file:///c:/Users/handy/Builds/Labtrace/internal/database/migrations.go)

### 表结构

#### 1. subjects（受检者表）
```sql
CREATE TABLE subjects (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	gender TEXT NOT NULL CHECK(gender IN ('男','女')),
	birth_date TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### 2. hospitals（医院表）
```sql
CREATE TABLE hospitals (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL UNIQUE,
	level TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### 3. test_items（检验项目表）
```sql
CREATE TABLE test_items (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	code TEXT NOT NULL UNIQUE,
	standard_name TEXT NOT NULL,
	category TEXT NOT NULL DEFAULT '',
	default_unit TEXT NOT NULL DEFAULT '',
	value_type TEXT NOT NULL DEFAULT 'numeric' 
		CHECK(value_type IN ('numeric','titer','qualitative')),
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### 4. test_item_aliases（检验项目别名表）
```sql
CREATE TABLE test_item_aliases (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	test_item_id INTEGER NOT NULL REFERENCES test_items(id) ON DELETE CASCADE,
	hospital_id INTEGER REFERENCES hospitals(id) ON DELETE SET NULL,
	alias_name TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### 5. reference_intervals（参考区间表）
```sql
CREATE TABLE reference_intervals (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	test_item_id INTEGER NOT NULL REFERENCES test_items(id) ON DELETE CASCADE,
	gender TEXT NOT NULL DEFAULT '不限' CHECK(gender IN ('男','女','不限')),
	age_min REAL,
	age_max REAL,
	age_unit TEXT NOT NULL DEFAULT '岁' CHECK(age_unit IN ('岁','天')),
	value_min REAL,
	value_max REAL,
	value_type TEXT NOT NULL DEFAULT 'numeric' 
		CHECK(value_type IN ('numeric','titer','qualitative')),
	qualitative_value TEXT DEFAULT '',
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### 6. unit_conversions（单位转换表）
```sql
CREATE TABLE unit_conversions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	test_item_id INTEGER NOT NULL REFERENCES test_items(id) ON DELETE CASCADE,
	source_unit TEXT NOT NULL,
	target_unit TEXT NOT NULL,
	formula TEXT NOT NULL,
	example_input REAL NOT NULL DEFAULT 0,
	example_output REAL NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### 7. calculation_rules（计算规则表）
```sql
CREATE TABLE calculation_rules (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	formula TEXT NOT NULL,
	threshold REAL NOT NULL DEFAULT 1.0,
	test_item_ids TEXT NOT NULL DEFAULT '[]',
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### 8. lab_reports（检验报告单表）
```sql
CREATE TABLE lab_reports (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
	hospital_id INTEGER REFERENCES hospitals(id) ON DELETE SET NULL,
	sample_date TEXT NOT NULL,
	file_path TEXT NOT NULL DEFAULT '',
	file_md5 TEXT NOT NULL DEFAULT '',
	ocr_status TEXT NOT NULL DEFAULT 'pending' 
		CHECK(ocr_status IN ('pending','processing','review','imported','failed')),
	ocr_raw_json TEXT NOT NULL DEFAULT '',
	whole_report_notes TEXT NOT NULL DEFAULT '',
	column_mapping_json TEXT NOT NULL DEFAULT '',
	ocr_table_json TEXT NOT NULL DEFAULT '',
	category_id INTEGER REFERENCES report_categories(id) ON DELETE SET NULL,
	mismatch_category TEXT DEFAULT '',
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_reports_md5 ON lab_reports(file_md5) WHERE file_md5 != '';
```

#### 9. report_items（报告数据项表）
```sql
CREATE TABLE report_items (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	report_id INTEGER NOT NULL REFERENCES lab_reports(id) ON DELETE CASCADE,
	test_item_id INTEGER REFERENCES test_items(id) ON DELETE SET NULL,
	test_item_name TEXT NOT NULL DEFAULT '',
	original_value TEXT NOT NULL DEFAULT '',
	normalized_value REAL,
	original_unit TEXT NOT NULL DEFAULT '',
	normalized_unit TEXT NOT NULL DEFAULT '',
	confidence INTEGER NOT NULL DEFAULT 100 CHECK(confidence >= 0 AND confidence <= 100),
	ref_interval_id INTEGER REFERENCES reference_intervals(id) ON DELETE SET NULL,
	ref_interval_text TEXT NOT NULL DEFAULT '',
	flag TEXT NOT NULL DEFAULT '' 
		CHECK(flag IN ('','H','L','阳性','阴性','normal')),
	row_notes TEXT NOT NULL DEFAULT '',
	ocr_bbox TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### 10. hospital_rules（医院规则表）
```sql
CREATE TABLE hospital_rules (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	hospital_id INTEGER NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
	rule_name TEXT NOT NULL DEFAULT '',
	column_mappings TEXT NOT NULL DEFAULT '{}',
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### 11. report_categories（报告分类表）
```sql
CREATE TABLE report_categories (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL UNIQUE,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### 12. backups（备份表）
```sql
CREATE TABLE backups (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	filename TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	file_size INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### 13. audit_logs（审计日志表）
```sql
CREATE TABLE audit_logs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	action TEXT NOT NULL,
	action_label TEXT NOT NULL DEFAULT '',
	entity_type TEXT NOT NULL DEFAULT '',
	entity_id INTEGER NOT NULL DEFAULT 0,
	details TEXT NOT NULL DEFAULT '{}',
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### 14. ocr_quotas（OCR配额表）
```sql
CREATE TABLE ocr_quotas (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	year_month TEXT NOT NULL UNIQUE,
	total_quota INTEGER NOT NULL DEFAULT 200,
	used_count INTEGER NOT NULL DEFAULT 0,
	success_count INTEGER NOT NULL DEFAULT 0,
	fail_count INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 迁移策略

1. **初始创建** - `CREATE TABLE IF NOT EXISTS`
2. **增量升级** - `ALTER TABLE`（忽略列已存在错误）
3. **向后兼容** - 旧数据保持可读

---

## 前端架构

**文件**: 
- [web/index.html](file:///c:/Users/handy/Builds/Labtrace/web/index.html) - HTML入口
- [web/js/app.js](file:///c:/Users/handy/Builds/Labtrace/web/js/app.js) - Vue应用入口

### 技术特点

1. **无构建流程** - 所有库通过CDN加载
2. **Vue 3 Composition API** - 现代化Vue开发
3. **Tailwind CSS** - 实用优先的CSS框架
4. **Hash路由** - 无服务端路由依赖
5. **ECharts 5** - 强大的图表库

### 加载的CDN库

```html
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://unpkg.com/vue@3.5.13/dist/vue.global.prod.js"></script>
<script src="https://cdn.jsdelivr.net/npm/echarts@5.6.0/dist/echarts.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
```

### 应用结构

```
Vue 3 App
├── 全局状态
│   ├── currentView          # 当前视图
│   ├── currentSubjectId     # 当前选中受检者
│   ├── globalSearchQuery    # 全局搜索
│   └── allSubjects          # 受检者缓存
│
├── 路由（Hash-based）
│   ├── #dashboard           → DashboardView
│   ├── #ocr                 → OCRImportView
│   ├── #subjects            → SubjectsView
│   ├── #test-items          → TestItemsView
│   ├── #trend               → TrendView
│   └── #settings            → SettingsView
│
├── 视图组件 (Views)
│   ├── DashboardView        # 仪表盘
│   ├── OCRImportView        # OCR上传与比对
│   ├── OCRMappingWizard     # 映射向导
│   ├── SubjectsView         # 受检者管理
│   ├── TestItemsView        # 检验项目库
│   ├── TrendView            # 趋势分析
│   └── SettingsView         # 设置
│
└── 可复用组件 (Components)
    ├── DataTable            # 数据表格
    ├── CrudModal            # CRUD弹窗
    ├── SearchDropdown       # 搜索下拉
    ├── SubjectSelector      # 受检者选择器
    ├── SparklineChart       # 迷你图表
    └── DrilldownPopup       # 数据下钻
```

### 设计系统

**文件**: [web/css/app.css](file:///c:/Users/handy/Builds/Labtrace/web/css/app.css)

CSS变量定义的设计系统：
- 颜色系统（主题色、语义色、中性色）
- 间距变量
- 阴影变量
- 圆角变量
- 组件样式复用

### API封装

**文件**: [web/js/api.js](file:///c:/Users/handy/Builds/Labtrace/web/js/api.js)

统一的API请求封装，自动处理：
- JSON序列化/反序列化
- 错误处理
- 响应解析（`code`/`message`/`data`）

---

## 配置与部署

### 环境配置

**文件**: `.env`（从`.env.example`复制）

```env
# 必填配置
DB_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# 可选配置
PORT=8080
DB_PATH=data/labtrace.db
UPLOAD_DIR=data/uploads
BACKUP_DIR=data/backups

# 阿里云OCR（可选，不配置则OCR功能不可用）
ALI_ACCESS_KEY_ID=your_access_key_id
ALI_ACCESS_KEY_SECRET=your_access_key_secret
OCR_QUOTA_MONTHLY=200
```

**注意**:
- `DB_KEY`必须是64个字符的16进制字符串（对应32字节AES-256密钥）
- 可以使用 `openssl rand -hex 32` 生成

### Makefile命令

| 命令 | 说明 |
|------|------|
| `make build` | 编译二进制（release模式） |
| `make dev` | 开发模式运行（日志到`dev.log`） |
| `make run` | 生产模式运行 |
| `make stop` | 优雅关闭 |
| `make clean` | 清理二进制和缓存（保留data/） |
| `make rebuild` | 清理后重新编译 |
| `make restart` | 重启服务 |

### 手动构建运行

```bash
# 1. 配置环境
cp .env.example .env
# 编辑 .env，设置 DB_KEY

# 2. 编译
go build -o labtrace .

# 3. 运行
./labtrace  # Linux/Mac
labtrace.exe  # Windows
```

服务默认地址: `http://localhost:8080`

### 首次启动

系统自动执行：
1. 创建SQLite数据库文件
2. 执行DDL迁移（创建14张表）
3. 植入种子数据
   - 43项标准检验项目
   - 38条参考区间
   - 8条单位转换规则
   - 2条计算规则

### 目录权限

确保以下目录可写：
- `data/` - 数据库和上传文件
- `data/uploads/` - 上传的报告文件
- `data/backups/` - 备份文件

### 数据备份

**备份策略**:
- AES-256-GCM加密
- 导出为`.labtrace`文件
- 通过设置页的备份功能操作

---

## 开发指南

### 添加新API端点

1. 在 `internal/handlers/` 中创建或修改handler文件
2. 在 `main.go` 中注册路由
3. 在 `web/js/api.js` 中添加前端调用封装

### 数据库修改

1. 在 `internal/database/migrations.go` 的 `alterStmts` 中添加 `ALTER TABLE` 语句
2. （可选）在 `internal/database/seed.go` 中添加种子数据

### 前端开发

1. 修改 `web/js/views/` 或 `web/js/components/` 中的文件
2. 更新HTML中的版本号 `?v=2` → `?v=3` 以避免浏览器缓存

### 测试

项目目前无自动化测试，使用以下手动验证：

```bash
# 编译检查
go build -o labtrace .

# 运行检查
./labtrace  # 检查启动是否正常
```

---

## 常见问题

### Q: 如何重置数据库？

A: 删除 `data/labtrace.db` 文件，重启应用即可自动重建。注意：这会丢失所有数据！

### Q: OCR配额不足怎么办？

A: 在设置页可以手动调整当月配额，或在 `.env` 中设置 `OCR_QUOTA_MONTHLY`。

### Q: 如何迁移数据到另一台机器？

A: 使用设置页的备份功能导出`.labtrace`文件，在新机器上导入。

### Q: 支持哪些图片/PDF格式？

A: 支持JPG、PNG、PDF（多页），由阿里云OCR API处理。

---

## 相关文档

- [README.md](file:///c:/Users/handy/Builds/Labtrace/README.md) - 项目说明
- [AGENTS.md](file:///c:/Users/handy/Builds/Labtrace/AGENTS.md) - 开发指南
- [CLAUDE.md](file:///c:/Users/handy/Builds/Labtrace/CLAUDE.md) - 详细架构文档
- [docs/requirements/](file:///c:/Users/handy/Builds/Labtrace/docs/requirements/) - 需求文档
- [docs/bugfix/](file:///c:/Users/handy/Builds/Labtrace/docs/bugfix/) - 修复记录

---

## 许可证

MIT License © LabTrace 2025
