# 趋势分析查询无结果

**日期**: 2026-05-10  
**严重程度**: 高  
**状态**: 已修复

## 现象

趋势分析页面中，选择受检者后，无论是否选择检验项目，点击"查询"按钮都没有任何结果。

## 根因

`report_items` 表中所有记录的 `test_item_id` 字段均为 `NULL`。

### 为什么 test_item_id 全为 NULL？

OCR 导入流程存在设计缺陷：

1. **OCR 上传** (`internal/handlers/ocr.go:118-121`) — 解析报告后插入 `report_items`，只写入 `test_item_name`（OCR 识别出的文本），未写入 `test_item_id`
2. **列映射** (`internal/handlers/ocr.go:239-242`) — `ApplyColumnMapping` 重新插入 `report_items` 时同样未设置 `test_item_id`
3. **导入确认** (`internal/handlers/report.go:190-274`) — `ImportReport` 只处理参考区间匹配和 flag 计算，跳过了 `test_item_id` 为 NULL 的项（`if it.TestItemID == nil { continue }`），从未回填

### 为什么查询不到数据？

趋势查询 SQL (`internal/services/trend_service.go:38`):
```sql
WHERE lr.subject_id = ? AND ri.test_item_id = ? AND lr.ocr_status = 'imported'
```
`ri.test_item_id = NULL` 永远不匹配任何 `?` 参数值，因此查询结果始终为空。

## 修复

### 1. 新增 `internal/services/testitem_service.go`
- `MatchTestItemByName(name)` — 级联匹配策略：
  1. 精确匹配 `test_items.standard_name`
  2. 精确匹配 `test_item_aliases.alias_name`
  3. 大小写不敏感匹配
  4. 标准化匹配（处理 `(%)` ↔ `百分比` 等后缀差异）
  5. 包含匹配（名称互相包含）
- `BackfillTestItemIDs()` — 启动时自动回填存量数据中 `test_item_id` 为 NULL 的记录

### 2. 修改 `internal/handlers/report.go`
- `ImportReport` 中新增自动匹配逻辑：导入时遍历每个 `report_item`，若 `test_item_id` 为 NULL 则调用 `MatchTestItemByName` 自动匹配并更新

### 3. 修改 `internal/services/trend_service.go`
- `TrendDataPoint` 新增 `test_item_id` 和 `test_item_name` 字段
- `GetTrendData` 支持 `test_item_id=0`（不选项目）时返回该受检者所有已录入项目的趋势数据

### 4. 修改 `internal/handlers/trend.go`
- `test_item_id` 从必填改为可选（仅 `subject_id` 为必填）

### 5. 修改 `web/js/views/trend.js`
- 不选检验项目时查询该受检者所有已录入项目的趋势
- 图表自动按项目分多条曲线展示（不同颜色）
- 表格动态显示"检验项目"列
- CSV 导出包含项目名
- 迷你趋势图支持多项目数据

### 6. 修改 `main.go`
- 启动时自动执行 `BackfillTestItemIDs()`，首次启动回填了 22/23 个项目（仅"血小板压积"缺少对应 `test_items` 记录）

## 回滚方案

如需回滚：
```bash
# 还原代码
git checkout -- internal/services/testitem_service.go internal/handlers/report.go internal/services/trend_service.go internal/handlers/trend.go web/js/views/trend.js main.go
# 回滚数据库（将 test_item_id 重置为 NULL）
sqlite3 data/labtrace.db "UPDATE report_items SET test_item_id = NULL;"
```

## 后续建议

1. `test_items` 表缺少"乳酸脱氢酶"、"磷酸肌酸激酶"、"肌酸激酶同工酶"、"D-二聚体"、"血小板压积"等常用项目，需补充 seed 数据
2. 考虑在 `ApplyColumnMapping` 环节也加入自动匹配逻辑
3. 考虑添加 `test_item_aliases` 条目以提高匹配率（如"血小板压积"→"PCT"）