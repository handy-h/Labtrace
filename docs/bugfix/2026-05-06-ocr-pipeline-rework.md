# 2026-05-06：OCR 管线重构 & 核效页面修复

## 概述

全面排查并修复了从 OCR 上传到核效页面展示的整条链路问题，涉及前后端多处代码。同时对 OCR 调用流程进行了架构升级（从旧版手动签名迁移到官方 SDK）。

---

## Bug 1：前端静态文件全部 404

### 现象

```
[GIN] 404 | GET "/js/api.js"
[GIN] 404 | GET "/css/app.css"
[GIN] 404 | GET "/js/views/dashboard.js"
...
```

前端所有 JS/CSS 模块无法加载，页面空白。

### 根因

`main.go` 中静态文件路由：

```go
r.Static("/web", "./web")   // 将 ./web 映射到 URL 前缀 /web
```

但 `web/index.html` 中的引用是**根相对路径**：

```html
<link rel="stylesheet" href="css/app.css">
<script src="js/api.js"></script>
```

浏览器解析为 `/css/app.css`、`/js/api.js`，但 Gin 只有 `/web/css/app.css`、`/web/js/api.js` 这些路由，因此返回 404。

### 修复

在 `web/index.html` `<head>` 中添加 `<base href="/web/">`：

```html
<base href="/web/">
```

所有相对 URL 自动基于 `/web/` 解析：`css/app.css` → `/web/css/app.css` ✓

绝对路径的 API 调用（`/api/v1/...`）不受 `<base>` 影响。

### 涉及文件

| 文件 | 变更 |
|------|------|
| `web/index.html` | +1 行 |

---

## Bug 2：OCR API 不支持 PDF 文件（架构升级）

### 现象

上传 PDF 格式的检验报告后，OCR 状态变为 `failed`。

### 根因

旧代码调用的是阿里云 **RecognizeGeneral**（通用文字识别）接口，该接口**不支持 PDF** 格式输入。PDF 文件直接发送导致阿里云返回错误码。

旧实现（`internal/services/ocr_service.go`）使用手动 HMAC-SHA1 签名构建 HTTP 请求，硬编码 `Action: "RecognizeGeneral"`。

### 修复

从手动签名 HTTP 调用迁移到阿里云 **Go SDK v3**，使用 **RecognizeAllText** 统一识别接口（`Type=Advanced`），原生支持 PDF 多页识别。

**关键改变**：

- 移除 ~100 行手动签名代码（`signRequest`、HMAC-SHA1、URL 编码等）
- 使用 `github.com/alibabacloud-go/ocr-api-20210707/v3` 官方 SDK
- `RecognizeAllText` 通过 `SubImages[].BlockInfo.BlockDetails` 返回结构化文本块
- 新增 Y 坐标分组 → Row 编号 → 按 X 排序的坐标提取逻辑

### 涉及文件

| 文件 | 变更 |
|------|------|
| `internal/services/ocr_service.go` | **重写**（183 → 97 行） |
| `go.mod` / `go.sum` | +13 个阿里云 SDK 依赖 |

---

## Bug 3：核效弹窗面积太小

### 现象

核效弹窗只有约 80vw × 80vh，展示大量检验项目时内容拥挤，需频繁滚动。

### 根因

CSS 和 HTML 双层限制：

```css
/* app.css */
.drill-modal > div { max-width: 800px; max-height: 80vh; }
```

```html
<!-- ocr-import.js -->
<div class="w-[90vw] max-w-5xl max-h-[80vh] overflow-auto ...">
```

两者叠加导致弹窗被硬性约束。

### 修复

弹窗改为全视口 flex 布局：

- 外层遮罩 `display: flex`（移除 `align-items/justify-content` 居中）
- 内层容器 `flex: 1; display: flex; flex-direction: column; overflow: hidden`
- Header（固定高 `shrink-0`）、Content（`flex-1 flex overflow-hidden`）、Footer
- 左侧 45% 文件预览 + 右侧 55% 数据表格，各自独立滚动
- `<thead>` 添加 `sticky top-0` 表头固定

### 涉及文件

| 文件 | 变更 |
|------|------|
| `web/css/app.css` | `.drill-modal` + `.drill-modal > div` 完全重写 |
| `web/js/views/ocr-import.js` | 弹窗模板重构 |

---

## Bug 4：左侧 PDF 文件预览不显示

### 现象

上传 PDF 后进入核效页面，左侧预览区域空白。

### 根因

`<img>` 标签无法渲染 PDF 文件。`GetReportImage` handler 直接用 `c.File(filePath)` 返回文件内容，浏览器收到 PDF 但 `<img>` 无法作为图片渲染。

### 修复

新增 `isPdf` 计算属性（检测 `file_path` 后缀），PDF 用 `<embed type="application/pdf">` 渲染，图片继续用 `<img>`：

```html
<embed :src="reportImageUrl" v-if="reportImageUrl && isPdf"
       type="application/pdf" class="w-full border-0"
       style="height: 100%; min-height: 100%;">
```

高亮呼吸框和放大镜仅在图片模式下启用。

### 涉及文件

| 文件 | 变更 |
|------|------|
| `web/js/views/ocr-import.js` | +`isPdf` computed + `<embed>` 分支 |

---

## Bug 5：右侧检验项目全部列为一行（解析器设计缺陷）

### 现象

OCR 识别完成后，核效页面右侧表格中所有文本每个单独成行（如"白细胞计数"、"5.2"、"10^9/L"、"3.5-9.5" 各占一行），没有分组为完整的检验项目。

### 根因

两个层面：

**层面一**：OCR block → report_item 的直接映射

旧 handler 对每个 OCR 文本块直接插入一条 `report_items` 记录，把 `r.Text` 填入 `original_value`，`test_item_name` 留空。没有将同一检验项目的名称/数值/单位/范围组合为一条记录。

**层面二**：状态机解析器不支持两种字段顺序

化验单排版存在两种常见顺序：
- `名称 → 数值 → 范围 → 单位`（状态机支持 ✓）
- `名称 → 数值 → 单位 → 范围`（状态机遇到 `unit` 立即 emit，后面的 `range` 被当作噪声丢弃 ✗）

### 修复

创建了 `internal/services/ocr_parser.go`，实现三级递进解析策略：

**Path 1: 结构化解析** — 利用 OCR 坐标信息（Row + X），按行→列分组，每行内分类字段组合为 item。

**Path 2: 线性状态机** — 无坐标时的 fallback，新增双态支持：
- `sValUnit`：已有 name + value + unit，等待 range 或下一个 name
- `sValRng`：已有 name + value + range，等待 unit 或下一个 name

**Path 3: 文本行级解析** — 当 block 包含整行文本时的最终 fallback，按 `\n` 分行 → `strings.Fields` 分列 → 逐行分类组合。

另外增加了：
- 英文缩写库（ALT / AST / WBC / HbA1c 等 50+）
- 小数合并（`"50" + ".7"` → `"50.7"`）
- 噪声过滤（页眉、页脚、日期、序号）
- 文本分类器：`name` / `value` / `range` / `unit` / `noise`

### 涉及文件

| 文件 | 变更 |
|------|------|
| `internal/services/ocr_parser.go` | **新增**（853 行） |
| `internal/handlers/ocr.go` | 更新 INSERT 逻辑 |

---

## Bug 6：重新识别后右侧仍为空（解析器 fallback + 删除顺序缺陷）

### 现象

点击"重新识别"按钮后，OCR 状态变回 `review`，但核效页面右侧依然空白，无任何数据。

### 根因

复合问题，两个 bug 叠加：

**Bug 6a**：阿里云 RecognizeAllText 返回的 `SubImages[].BlockInfo.BlockDetails[]` 中，每个文本块可能是**一整行**（如 `"白细胞计数 5.2 10^9/L 3.5-9.5"`）。此时：
- `parseStructured`：一整行被分类为单个 "name"，无独立 "value" → 返回 0
- `parseLinear`：两行都是 "name" → 状态机卡在 `sName` → 返回 0  
- `parseContentText`：`strings.Join(texts, " ")` 将多行用空格拼接为一大行 → `\n` 分行只有一行 → 只解析出第 1 个 item，后续全部丢失

**Bug 6b**：`ReOCR` handler 中 `DELETE FROM report_items` 在解析前执行。如果新版 OCR 返回 0 个文本块，旧数据已被删光而新数据为 0 → 永久空白。

### 修复

**修复 6a**：`ParseLabResults` 入口增加检测：
- 先扫描是否有"包含空格的整行文本块"（`containsWhitespace && containsChinese`）
- 如果有，跳过 `parseLinear`，直接用 `"\n"` 拼接传给 `parseContentText`
- `"\n"` 拼接确保每个 block 独占一行 → 按 `\n` 分行正确

**修复 6b**：
- 在 ReOCR handler 中新增 `len(ocrResults) == 0` 检查，零结果时不删除旧数据、标记 `failed` 返回
- 将 `DELETE` 移到确认有新数据后的位置
- 同样在初始 Upload goroutine 中添加零结果保护

### 涉及文件

| 文件 | 变更 |
|------|------|
| `internal/services/ocr_parser.go` | `ParseLabResults` 入口重写 |
| `internal/handlers/ocr_quota.go` | ReOCR 零结果保护 + DELETE 顺序调整 |
| `internal/handlers/ocr.go` | Upload 零结果保护 |

---

## 汇总：变更文件清单

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| 1 | `web/index.html` | 修改 | 添加 `<base href="/web/">` |
| 2 | `web/css/app.css` | 修改 | 弹窗布局重写 |
| 3 | `web/js/views/ocr-import.js` | 修改 | 全视口弹窗 + PDF 预览 + 重新识别按钮 + 配额条 |
| 4 | `web/js/views/dashboard.js` | 修改 | 添加 OCR 配额卡片 |
| 5 | `web/js/views/settings.js` | 修改 | 添加配额编辑 |
| 6 | `web/js/api.js` | 修改 | 添加 3 个 API 方法 |
| 7 | `internal/services/ocr_service.go` | **重写** | 从手动签名 → SDK v3 RecognizeAllText |
| 8 | `internal/services/ocr_parser.go` | **新增** | 三级递进 OCR 解析器 |
| 9 | `internal/services/ocr_quota.go` | **新增** | OCR 月度配额管理 |
| 10 | `internal/handlers/ocr_quota.go` | **新增** | ReOCR + 配额 handlers |
| 11 | `internal/handlers/ocr.go` | 修改 | 零结果保护 + 配额记录 + 审计日志 |
| 12 | `internal/database/migrations.go` | 修改 | 新增 `ocr_quotas` 表 |
| 13 | `main.go` | 修改 | 注册 3 条新路由 |
| 14 | `go.mod` / `go.sum` | 修改 | 阿里云 SDK 依赖 |

## 技术债务 / 待改进

1. **`parseContentText` 对无换行文本的处理**：当所有 block 无换行时，`"\n"` 拼接后仍为单行，只产生一个 item。需要更智能的边界检测。
2. **解析器缺少单元测试**：`ocr_parser.go` 目前零测试覆盖，各类文本分类和状态机逻辑依赖手动验证。
3. **OCR 响应缺乏调试面板**：当前通过 `log.Printf` 输出解析日志，无前端界面查看原始 OCR JSON。
4. **ApplyRule 接口已停用**：`handlers/ocr.go` 中移除了 `services.ApplyRule` 调用，`rule_service.go` 中的 `groupByRow` 逻辑与新版解析器功能重叠，后续可考虑整合或移除。
