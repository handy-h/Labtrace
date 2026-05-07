# PDF 坐标信息支持 — 产品方案

## 1. 问题背景

阿里云 OCR 统一识别（RecognizeAllText）API **支持返回 PDF 坐标信息**，但当前 LabTrace 未启用该能力。

### 现状分析

| 维度 | 当前实现 | 问题 |
|------|---------|------|
| API 调用 | `RecognizeAllText`，`Type=Advanced`，**未设置 `OutputCoordinate`** | API 默认不返回坐标 → PDF 的 `BlockRect` 为空 |
| 坐标存储 | `OCRResult.Left/Top/Width/Height` 从 `BlockRect.CenterX/Y/Width/Height` 映射 | PDF 返回无坐标时全部为 0 |
| 前端表现 | `ocr-mapping-wizard.js` 检测到零坐标后进入 `noPositionMode` | 降级为纯文本模式，无法框选区域、无法高亮 |
| 高亮/放大镜 | `ocr-import.js` 中 `v-if="highlightRect && !isPdf"` 禁用 | PDF 永远无法使用高亮呼吸框和放大镜 |
| 自定义映射 | Step 1 强制跳过区域选择 | 丧失了视觉化布局选择的核心价值 |

### 根本原因

`ocr_service.go:47-50` 构建请求时只设置了 `Type` 和 `Body`，**未设置以下关键参数**：

```
OutputCoordinate = "rectangle"   ← 开关：返回矩形坐标
OutputOricoord   = true          ← 返回原始图像坐标（PDF 页面坐标系）
AdvancedConfig.OutputTable = true ← 返回 TableInfo（单元格级坐标）
AdvancedConfig.OutputRow   = true ← 返回 RowInfo（行级分组）
```

---

## 2. 产品目标

1. **PDF 与图片获得同等坐标支持**：PDF 上传后也能在原图上框选区域、高亮单元格、使用放大镜
2. **利用表格识别（TableInfo）提升自动解析率**：API 返回结构化单元格（RowStart/RowEnd/ColumnStart/ColumnEnd），可跳过 Y 轴行分组启发式算法
3. **消除 `noPositionMode` 的降级路径**：仅在 OCR 完全无返回时才降级
4. **向后兼容**：已入库的旧数据（`ocr_raw_json` 中无坐标的块）仍可正常查看，不做迁移

---

## 3. API 参数变更方案

### 3.1 请求参数新增

修改 `internal/services/ocr_service.go` 中 `Recognize()` 函数的请求构建部分：

```go
request := &ocr_api.RecognizeAllTextRequest{
    Body:             strings.NewReader(string(fileBytes)),
    Type:             tea.String("Advanced"),
    OutputCoordinate: tea.String("rectangle"),   // 新增：返回矩形坐标
    OutputOricoord:   tea.Bool(true),             // 新增：原始图像坐标系
    AdvancedConfig: &ocr_api.RecognizeAllTextRequestAdvancedConfig{
        OutputTable: tea.Bool(true),              // 新增：返回表格结构
        OutputRow:   tea.Bool(true),              // 新增：返回行分组
    },
}
```

### 3.2 响应数据增强

启用上述参数后，API 响应将新增以下数据：

| 新增字段 | 层级 | 内容 | 用途 |
|---------|------|------|------|
| `BlockRect.CenterX/Y/Width/Height` | BlockDetails | **PDF 也有值了** | 原有逻辑已处理，无需修改 |
| `TableInfo.TableDetails[]` | SubImages | 表格级结构：行数、列数、表头/表尾 | 自动表格检测和解析 |
| `CellDetails[]` | TableDetails | 单元格级：`CellContent`, `RowStart/End`, `ColumnStart/End`, `CellRect` | 精确行列定位 |
| `RowInfo.RowDetails[]` | SubImages | 行级：`RowContent`, `BlockList[]` | 行分组辅助验证 |

### 3.3 对费用的影响

`OutputCoordinate`、`OutputTable`、`OutputRow` 均不额外计费，仍按 OCR 调用次数计费。但开启 `OutputTable` 可能增加响应体积和延迟（约 10-20%），需在 UI 上做好加载提示。

---

## 4. 数据模型变更

### 4.1 `OCRResult` 扩展

在 `internal/services/ocr_service.go` 中扩展结构体：

```go
type OCRResult struct {
    Text        string  `json:"text"`
    Confidence  float64 `json:"confidence"`
    Left        int     `json:"left"`       // 语义变更为 top-left X（见 4.2）
    Top         int     `json:"top"`        // 语义变更为 top-left Y
    Width       int     `json:"width"`
    Height      int     `json:"height"`
    Row         int     `json:"row"`
    PageIndex   int     `json:"page_index"`
    // --- 新增字段 ---
    HasPosition bool    `json:"has_position"` // 是否有有效坐标（区分零坐标和无坐标）
    ColIndex    int     `json:"col_index"`    // 表格列索引（-1 = 非表格块）
    RowStart    int     `json:"row_start"`    // CellDetails.RowStart（-1 = 非表格块）
    RowEnd      int     `json:"row_end"`      // CellDetails.RowEnd
    ColStart    int     `json:"col_start"`    // CellDetails.ColumnStart
    ColEnd      int     `json:"col_end"`      // CellDetails.ColumnEnd
}
```

`HasPosition` 字段的关键作用：替代前端当前的 `noPositionMode` 判定逻辑（遍历所有块检查坐标是否全为 0），改为直接检查块中是否有 `HasPosition=true` 的项。

### 4.2 坐标语义修正

当前代码将 `BlockRect.CenterX` 存入 `OCRResult.Left`，命名与语义不符。建议在 `parseOCRResponse()` 中统一转为左上角坐标：

```go
// 之前：r.Left = int(*bd.BlockRect.CenterX)
// 之后：
r.Left = int(*bd.BlockRect.CenterX) - int(*bd.BlockRect.Width)/2
r.Top  = int(*bd.BlockRect.CenterY) - int(*bd.BlockRect.Height)/2
r.HasPosition = true
```

**影响评估**：`AutoDetectTableRegion()` 和 `filterByRegion()` 已自行做 `b.Left - b.Width/2` 转换，修正后需移除这些补偿逻辑，避免双重偏移。涉及文件：
- `internal/services/ocr_mapping.go:43` — `AutoDetectTableRegion()`
- `internal/services/ocr_mapping.go:186` — `filterByRegion()`
- `internal/services/ocr_parser.go` — `sortByX()` 等依赖 Left 为 CenterX 的地方

### 4.3 TableInfo 存储

新增 `OCRTableInfo` 结构体，序列化后存入 `lab_reports.ocr_raw_json` 中（与 OCRResult 数组并列），或新增数据库列。

**推荐方案**：在 `lab_reports` 表新增 `ocr_table_json TEXT` 列，存储 TableInfo 序列化结果。理由：
- `ocr_raw_json` 已存 `[]OCRResult`，混入 TableInfo 会破坏反序列化兼容性
- TableInfo 是可选增强数据，与 OCRResult 分离更清晰

```go
type OCRTableCell struct {
    CellContent string `json:"cell_content"`
    RowStart    int    `json:"row_start"`
    RowEnd      int    `json:"row_end"`
    ColStart    int    `json:"col_start"`
    ColEnd      int    `json:"col_end"`
    Left        int    `json:"left"`
    Top         int    `json:"top"`
    Width       int    `json:"width"`
    Height      int    `json:"height"`
    PageIndex   int    `json:"page_index"`
}

type OCRTable struct {
    TableID   int            `json:"table_id"`
    RowCount  int            `json:"row_count"`
    ColCount  int            `json:"col_count"`
    Header    []string       `json:"header"`
    Cells     []OCRTableCell `json:"cells"`
    Left      int            `json:"left"`
    Top       int            `json:"top"`
    Width     int            `json:"width"`
    Height    int            `json:"height"`
    PageIndex int            `json:"page_index"`
}
```

### 4.4 数据库 DDL 变更

```sql
ALTER TABLE lab_reports ADD COLUMN ocr_table_json TEXT NOT NULL DEFAULT '';
```

迁移在 `internal/database/migrations.go` 中追加，遵循现有 idempotent 模式。

---

## 5. 解析管线增强

### 5.1 当前 4 条解析路径

| 路径 | 函数 | 适用场景 |
|------|------|---------|
| Path 1 | `parseStructured()` | 有坐标、多行、可按行分组 |
| Path 2 | `parseLinear()` | 无坐标、线性状态机 |
| Path 3 | `parseContentText()` | 纯文本 Content |
| Path 4 | `ParseLabResultsWithMapping()` | 用户自定义列映射 |

### 5.2 新增 Path 0：表格识别优先

当 API 返回 `TableInfo` 时，优先使用结构化单元格数据进行解析，跳过所有启发式算法：

```
输入：TableInfo.CellDetails[]（含行列索引 + 坐标 + 内容）
  ↓
1. 识别表头行：RowStart=0 的行
2. 按行组装 item：同一 RowStart 的所有 cell → 一条 ParsedLabItem
3. 列角色推断：
   - 名词性列（含中文/英文字母为主）→ name
   - 数值性列（含数字+小数点）→ value
   - 含单位关键词（g/L, mmol/L, %, 10^9/L...）→ unit
   - 含范围符号（-、~、–）→ range
   - 其余 → notes
4. 组装 ParsedLabItem，bbox 取 CellRect
5. 置信度取该行所有 cell 对应 BlockConfidence 的最低值
```

### 5.3 解析路径优先级调整

```
Path 0: TableInfo 结构化（新增，优先级最高）
  ↓ 不可用
Path 1: parseStructured()（有坐标 + Y 轴分组）
  ↓ 不可用
Path 2: parseLinear()
  ↓ 不可用
Path 3: parseContentText()
  ↓ 不可用
Path 4: 用户自定义映射
```

### 5.4 自定义映射向导增强

当 `TableInfo` 可用时，自定义映射向导可利用表格结构：

- **Step 1**：自动定位到表格区域（使用 `TableRect`），不再需要用户手动画框
- **Step 2**：表头列直接从 `Header.Contents` 或 `RowStart=0` 的 cells 提取，无需从 Y 坐标启发式推断
- **Step 3**：单元格编辑视图中，每个单元格可精确关联到 CellRect，tooltip 显示原始 OCR 文本更准确

---

## 6. 前端变更

### 6.1 PDF 预览与高亮

**当前**：PDF 使用 `<embed>` 标签，无法叠加 Canvas 高亮层。

**方案**：将 PDF 渲染为 Canvas（使用 `pdf.js`），使 PDF 与图片使用统一的高亮/放大镜机制。

关键步骤：
1. 引入 `pdf.js` CDN（与现有 Vue 3/Tailwind CDN 加载方式一致）
2. 上传 PDF 后，`pdf.js` 渲染指定页面到 `<canvas>`
3. 在 canvas 上叠加高亮层（复用现有 `highlight-breathe` CSS 动画）
4. 放大镜功能改为从 canvas 截取（替代 `drawImage` 从 `<img>` 截取）

### 6.2 坐标系映射

API 返回的坐标基于 PDF 页面的像素空间（由 `OutputOricoord=true` 保证）。`pdf.js` 渲染时需记录缩放比例，将 OCR 坐标乘以缩放比得到 canvas 像素坐标：

```javascript
const scale = canvasWidth / pdfPage.getViewport({ scale: 1 }).width;
const displayX = ocrBlock.left * scale;
const displayY = ocrBlock.top * scale;
const displayW = ocrBlock.width * scale;
const displayH = ocrBlock.height * scale;
```

### 6.3 noPositionMode 判定逻辑

**当前**（`ocr-mapping-wizard.js:394`）：
```javascript
noPositionMode() {
    return this.blocks.every(b => b.left === 0 && b.top === 0);
}
```

**改为**：
```javascript
noPositionMode() {
    return !this.blocks.some(b => b.has_position);
}
```

### 6.4 多页 PDF 页面切换

当前 `ocr_raw_json` 中 `PageIndex` 已存在但前端未使用。需在映射向导和报告详情中增加页面切换控件：

- 报告详情模态框：PDF 页面缩略图导航条
- 映射向导 Step 1：页面选择下拉框，每页独立框选区域

---

## 7. 与界面计划的对齐

参考 `界面计划.md` 中"2.1 自定义列映射功能"的边界情况处理：

| 界面计划描述 | 当前实现 | 本方案变更 |
|-------------|---------|-----------|
| "PDF 文件（无坐标）：OCR 降级路径只返回纯文本块" | 确实如此 | **启用 `OutputCoordinate` 后 PDF 也有坐标**，降级场景大幅减少 |
| "切换到 Step 2 时自动从 OCR 文本提取候选表头词" | 已实现 | 保留作为 fallback，但优先使用 `TableInfo.Header` |
| "使用虚拟列边界（按列序号等距分布）供用户调整" | 已实现 | 保留作为 fallback，有 TableInfo 时直接用 CellRect 列边界 |
| "左侧显示原始图像，高亮呼吸框" | 仅图片支持 | **PDF 也支持**（via pdf.js → canvas） |
| "鼠标框选功能：允许用户框选列头/列区域" | 仅图片支持 | **PDF 也支持** |

---

## 8. 实施分阶段计划

### Phase 1：基础坐标支持（后端最小变更）

**目标**：PDF 获得坐标，消除 `noPositionMode` 降级

1. `ocr_service.go`：请求增加 `OutputCoordinate=rectangle` + `OutputOricoord=true`
2. `ocr_service.go`：坐标语义修正（CenterX/Y → 左上角 X/Y）
3. `ocr_service.go`：`OCRResult` 新增 `HasPosition` 字段
4. `ocr_mapping.go`：移除坐标偏移补偿逻辑
5. `ocr_parser.go`：适配新坐标语义
6. `handlers/ocr.go`：`GetOCRBlocks` 响应包含 `HasPosition`
7. 前端 `noPositionMode` 判定改为检查 `has_position`

**验证**：上传 PDF 后，映射向导 Step 1 可正常显示 OCR 块分布图和框选功能。

### Phase 2：表格结构化识别

**目标**：利用 TableInfo 提升自动解析准确率

1. `ocr_service.go`：请求增加 `AdvancedConfig.OutputTable=true` + `OutputRow=true`
2. 新增 `OCRTable`/`OCRTableCell` 模型 + `ocr_table_json` 数据库列
3. `parseOCRResponse()` 提取 TableInfo 并序列化
4. 新增 Path 0 解析器 `parseTableInfo()`
5. `handlers/ocr.go`：`GetOCRBlocks` 响应新增 `tables` 字段
6. 映射向导 Step 2：优先使用 TableInfo 表头

**验证**：包含表格的 PDF 上传后自动解析率显著提升。

### Phase 3：PDF 原生高亮与放大镜

**目标**：PDF 预览页获得与图片同等的高亮和放大镜功能

1. 引入 `pdf.js` CDN
2. `ocr-import.js`：PDF 预览从 `<embed>` 改为 `pdf.js` Canvas 渲染
3. 复用高亮呼吸框 + 放大镜逻辑，适配 Canvas 坐标映射
4. 多页 PDF 页面切换控件

**验证**：报告详情页中，PDF 文件也能点击表格行后高亮对应区域。

### Phase 4：完整自定义映射增强

**目标**：映射向导全面利用 TableInfo

1. Step 1：自动框选到 TableRect，支持多表格选择
2. Step 3：单元格 tooltip 关联 CellRect 精确高亮
3. 医院模板保存时包含 TableInfo 映射策略
4. 多页 PDF 每页独立映射

---

## 9. 风险与约束

| 风险 | 影响 | 缓解 |
|------|------|------|
| 坐标语义修正导致旧数据偏移 | 已入库数据的 `ocr_bbox` 基于 CenterX 语义 | 旧数据读取时检测格式版本，或保持旧数据不动（高亮偏移可接受） |
| `pdf.js` 增加前端体积 | 加载时间增加约 500KB | 按需加载，仅在打开 PDF 报告时加载 |
| `OutputTable` 增加响应延迟 | OCR 识别时间增加 10-20% | 前端增加"正在识别表格结构…"提示 |
| 部分扫描版 PDF 仍无 BlockRect | API 对扫描质量极差的 PDF 可能不返回坐标 | 保留 `noPositionMode` 降级路径不变 |
| TableInfo 与 BlockInfo 行列不一致 | 两种识别引擎可能给出不同分组 | Path 0 优先使用 TableInfo；用户可切换回 BlockInfo 模式 |

---

## 10. 成功指标

1. PDF 上传后 `noPositionMode` 触发率从 **~90%** 降至 **<10%**（仅极低质量扫描件降级）
2. 自定义映射向导 Step 1 的 PDF 可用率从 **0%** 提升至 **>90%**
3. 含标准表格的 PDF 自动解析准确率（对比人工核效）提升 **30%+**
4. PDF 报告详情页高亮功能可用
