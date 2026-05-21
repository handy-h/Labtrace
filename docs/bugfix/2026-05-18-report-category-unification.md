# 报告分类体系统一 + 多项 Bug 修复

**日期**: 2026-05-18  
**严重程度**: 高  
**状态**: 已修复

## 现象

1. **分类显示缺失** — 批量导入时虽已选择了分类，但报告单查看、上传 OCR 查看时分类字段显示为空
2. **基本信息格式异常** — 报告单详情中受检者、采样日期、医院、分类的 label 缺少冒号和空格分隔符，值紧贴 label
3. **提示符未中文化** — 正常值显示为灰色 `—`，异常值显示为英文 H/L，用户期望看到中文"正常/偏高/偏低"
4. **分类体系混淆** — 设置页面同时存在"检验项目分类"（report_categories 管理）和"检验项目分类（标准项目库）"两个区块，功能重叠且命名易混淆
5. **报告列表查询失败** — 数据库中有数据但报告单页面显示"暂无检验报告"
6. **报告详情分类空白** — 详情弹窗中分类仍为 `-`
7. **确认核效不更新状态** — 点击"确认核效"后报告状态仍是"待核效"，未变为"已入库"
8. **核效流程不连续** — 确认核效后仍停留在当前报告，需手动关闭再选下一条

## 修复

### Bug 1: 表单缺少分类选择器

**根因**: 
- `web/js/views/ocr-import.js` 的实验室检查上传表单只提供受检者、医院字段，缺少分类选择器
- `web/js/views/batch_import.js` 的 Step 1 也只提供受检者、医院，缺少分类选择器
- 后端 `ocr.go` 和 `batch_import.go` 虽已支持 `category_id`，但前端从未发送该字段

**修改**:
- `web/js/views/ocr-import.js` — 在医院和文件选择器之间添加分类 `<select>` 下拉框
- `web/js/views/batch_import.js` — 在 Step 1 医院选择器后添加分类 `<select>` 下拉框

### Bug 2: 基本信息分隔符丢失

**根因**: `web/js/views/reports.js` 第 133-136 行的 info-label 缺少 `:&nbsp;&nbsp;` 后缀（影像报告区域为 `: ` 一个空格，也不统一）。

**修改** (`web/js/views/reports.js`):
- 检验报告基本信息 label 统一添加 `:&nbsp;&nbsp;` 分隔符
- 影像报告基本信息 label 统一为 `:&nbsp;&nbsp;`

### Bug 3: 提示符中文化

**根因**: `flagBadge` 函数直接返回英文标志（H/L）或只显示 `—`，未映射为中文。

**修改**:
- `web/js/views/reports.js` — `flagBadge` 函数改为返回中文：normal → 绿色"正常"，H/h → 红色"偏高"，L/l → 蓝色"偏低"，阳性/阴性 → 保留中文加颜色
- `web/js/utils.js` — 共享的 `flagBadge` 函数同上修改

### Bug 4: 报告分类体系统一

**根因**: 系统存在两套分类：`report_categories` 表（报告级分类）和 `test_items.category` 字段（检验项目级分类），两者独立维护，经常出现报告分类为空的情况。

**修改**: 删除报告级分类，统一使用检验项目分类。

| 文件 | 修改内容 |
|------|---------|
| `internal/database/migrations.go` | 删除 `CREATE TABLE report_categories`；删除 `category_id`/`mismatch_category` 的 ALTER 语句 |
| `internal/models/models.go` | 从 `LabReport` 删除 `CategoryID`、`CategoryName`、`MismatchCategory`；从 `AuditLog` 删除 `CategoryName`；新增 `Categories` 字段（逗号分隔的检验项目分类） |
| `internal/handlers/category.go` | **整文件删除**（5 个 API 全部移除） |
| `internal/handlers/report.go` | `ListReports`/`GetReport` 移除 category_id JOIN；`UpdateReport` 整函数删除；`ListReports` 新增子查询聚合 items 的 `ti.category` |
| `internal/handlers/batch_import.go` | 删除 `category_id` 请求字段和 INSERT 列 |
| `internal/handlers/ocr.go` | 删除 `category_id` 表单参数和处理逻辑 |
| `internal/handlers/audit.go` | 删除 `LEFT JOIN report_categories` |
| `main.go` | 删除 5 条 `/categories` 路由和 `UpdateReport` 路由 |
| `web/js/api.js` | 删除 5 个 category API 方法 |
| `web/js/views/reports.js` | 移除筛选下拉、列定义、详情中的 category_id 逻辑；新增 `categories` 列显示检验项目分类 |
| `web/js/views/ocr-import.js` | 移除上传表单分类选择器、列表分类列、详情编辑 UI、归一化模态框 |
| `web/js/views/batch_import.js` | 移除 Step 1 分类选择器、categories 加载 |
| `web/js/views/ocr-mapping-wizard.js` | 移除 mismatchCategory 引用 |
| `web/js/views/settings.js` | 删除"检验项目分类管理"区块和弹窗，仅保留"检验项目分类（标准项目库）" |

### Bug 5: SQLite GROUP_CONCAT 语法错误

**根因**: `GROUP_CONCAT(DISTINCT ti.category, ', ')` 中 `DISTINCT` 只能接受单参数，SQLite 报错 `DISTINCT aggregates must have exactly one argument`，导致 `ListReports` 查询失败，返回空结果。

**修改** (`internal/handlers/report.go`):
```sql
-- 错误写法
GROUP_CONCAT(DISTINCT ti.category, ', ')
-- 正确写法
(SELECT GROUP_CONCAT(cat, ', ') FROM (SELECT DISTINCT ti.category as cat FROM report_items ri LEFT JOIN test_items ti ON ti.id = ri.test_item_id WHERE ri.report_id = lr.id AND ti.category != ''))
```

### Bug 6: GetReport 未返回分类

**根因**: 只给 `ListReports` 添加了 categories 子查询，`GetReport` 遗漏了。

**修改** (`internal/handlers/report.go`): `GetReport` SQL 同步添加 categories 子查询，Scan 增加 `&r.Categories`。

### Bug 7: 确认核效不更新报告状态

**根因**: `ConfirmReport` handler 只执行了 `UPDATE report_items SET confidence = 100`，**漏掉了** `UPDATE lab_reports SET ocr_status = 'imported'`，导致报告状态始终为 `review`。

**修改** (`internal/handlers/report.go`): `ConfirmReport` 函数新增：
```go
database.DB.Exec(`UPDATE lab_reports SET ocr_status = 'imported' WHERE id = ?`, id)
```

### Bug 8: 核效流程不连续

**根因**: 确认核效后，前端 `doConfirmApi` 只是 `viewReport(selectedReport.value.id)` 重看同一条报告，没有跳转到下一条待核效报告。

**修改** (`web/js/views/ocr-import.js`): `doConfirmApi` 在核效成功后查找 `labReports` 中下一条 `ocr_status === 'review'` 的报告；若找到则自动跳转，若已是最后一条则关闭弹窗。

## 涉及文件

| 文件 | 修改类型 |
|------|---------|
| `internal/database/migrations.go` | 修改 |
| `internal/models/models.go` | 修改 |
| `internal/handlers/category.go` | **删除** |
| `internal/handlers/report.go` | 修改 |
| `internal/handlers/batch_import.go` | 修改 |
| `internal/handlers/ocr.go` | 修改 |
| `internal/handlers/audit.go` | 修改 |
| `main.go` | 修改 |
| `web/js/api.js` | 修改 |
| `web/js/utils.js` | 修改 |
| `web/js/views/reports.js` | 修改 |
| `web/js/views/ocr-import.js` | 修改 |
| `web/js/views/ocr-mapping-wizard.js` | 修改 |
| `web/js/views/batch_import.js` | 修改 |
| `web/js/views/settings.js` | 修改 |
