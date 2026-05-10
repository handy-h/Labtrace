# 2026-05-10：OCR 多栏表头映射 & ImportReport 死锁 & 核效自动入库

## 概述

修复了三个关联问题：
1. OCR 映射向导不支持多栏（双栏）化验单，识别出两个表头后校验报错无法进入下一步
2. `ImportReport` handler 因 SQLite 连接池死锁导致入库 API 永久阻塞，前端请求超时
3. 核效完成（`doApplyAndFinish`）后未自动调用入库 API，报告状态停留在 `review`

---

## Bug 1：多栏表头映射校验阻止进入下一步

### 现象

医院化验单为双栏布局（左栏/右栏各有独立的"项目/结果/单位/参考范围"表头），OCR 识别出两组表头后，`step2Error` 校验要求 `name` 和 `value` 字段全局唯一，导致报错"项目列重复"无法进入 Step 3。

### 根因

`step2Error` 计算属性中，`nameN`（项目列数量）和 `valN`（结果列数量）大于 1 时直接报错，未考虑多栏场景下每组栏各有自己的 name/value 列。

### 修复

1. 新增 `headerGroups` 计算属性，按 `group` 字段分组
2. `step2Error` 改为逐组校验：每组至少有一个 name 和一个 value，不再要求全局唯一
3. `extractHeaderCandidates` 重写为基于语义角色检测的多栏识别：
   - 对每个表头块调用 `guessField()` 获取语义角色（name/value/unit/range）
   - 若 `name` 或 `value` 角色出现多次，判定为多栏
   - 按 `name` 角色位置分组（每个 name 开始一个新组）
   - 回退策略：X 间距分割
4. Step 2 模板增加分组标签（"第1栏"/"第2栏"）和提示信息
5. `buildMappingConfig` 增加 `header_row_ys` 和 `group` 字段

### 涉及文件

- `web/js/views/ocr-mapping-wizard.js`：`step2Error`、`headerGroups`、`extractHeaderCandidates`、`goStep2`、`buildMappingConfig`、`guessField`、Step 2 模板

---

## Bug 2：多栏数据合并为一条记录

### 现象

左右两栏的解析数据被合并到同一列，如"白细胞计数"（左栏）和"血红蛋白"（右栏）的值合并到同一个结果字段。

### 根因

所有列都分配到 `group: 0`，后端 `ParseLabResultsWithMapping` 将同一行的所有列数据合并为一个 `ParsedLabItem`。

### 修复

1. 前端 `extractHeaderCandidates` 为每个分组分配 `globalGroup` 索引
2. 后端 `ColumnMappingConfig` 增加 `HeaderRowYs []int` 字段
3. 后端 `ColumnDef` 增加 `Group int` 字段
4. `ParseLabResultsWithMapping` 按 `col.Group` 分组，每组独立生成 `ParsedLabItem` 记录
5. 输出顺序：先输出 group 0（左栏）所有行，再输出 group 1（右栏）所有行

### 涉及文件

- `web/js/views/ocr-mapping-wizard.js`：`extractHeaderCandidates`、`goStep2`、`buildMappingConfig`
- `internal/services/ocr_mapping.go`：`ColumnMappingConfig`、`ColumnDef`、`ParseLabResultsWithMapping`

---

## Bug 3：ImportReport handler 数据库连接池死锁

### 现象

调用 `POST /api/v1/reports/:id/import` API 时请求永久阻塞（超时），Gin 日志无记录。前端入库操作无响应，页面刷新后数据消失。

### 根因

`database/db.go` 中 `SetMaxOpenConns(1)` 限制 SQLite 连接池只有 1 个连接。`ImportReport` handler 执行流程：

```
1. DB.QueryRow(...) → 获取报告信息 → Scan 后释放连接
2. DB.QueryRow(...) → 获取受检者信息 → Scan 后释放连接
3. DB.Query(...) → 获取 report_items → 持有连接直到 rows.Close()
4. services.MatchReference(...) → 内部 DB.Query(...) → 等待连接 → 死锁！
```

第 3 步的 `rows`（`defer rows.Close()`）占用唯一连接直到函数返回，第 4 步无法获取新连接，永久阻塞。

### 修复

1. **`database/db.go`**：`SetMaxOpenConns(1)` → `SetMaxOpenConns(2)`，`SetMaxIdleConns(1)` → `SetMaxIdleConns(2)`
   - SQLite WAL 模式支持并发读+写，2 个连接避免同 handler 内查询互相等待
2. **`database/db.go`**：连接字符串添加 `_busy_timeout=5000`，SQLite 遇到写锁时等待 5 秒而非立即报错
3. **`handlers/report.go`**：`ImportReport` 中 `defer rows.Close()` → 显式 `rows.Close()`（遍历完 rows 后立即释放连接，避免后续 DB 调用死锁）

### 涉及文件

- `internal/database/db.go`：`Open` 函数
- `internal/handlers/report.go`：`ImportReport` 函数

---

## Bug 4：核效完成后未自动入库

### 现象

OCR 映射向导 Step 3 点击"完成，进入核效"后，`report_items` 已更新但 `lab_reports.ocr_status` 仍为 `review`，未变为 `imported`。页面刷新后按"已入库"状态筛选查不到数据。

### 根因

`doApplyAndFinish` 函数只逐条 PUT 更新 `report_items`，未调用 `api.importReport()` 完成入库（匹配参考区间、计算提示符、更新状态为 imported）。

### 修复

1. `doApplyAndFinish` 中，更新完 `report_items` 后自动调用 `api.importReport(props.reportId)`
2. 入库失败时弹出错误提示并阻止关闭向导
3. 按钮文字从"完成，进入核效"改为"完成并入库"

### 涉及文件

- `web/js/views/ocr-mapping-wizard.js`：`doApplyAndFinish` 函数、Step 3 模板按钮文字

---

## 验证结果

- 多栏化验单：左右栏表头正确分组，数据独立生成记录，左栏全部行先输出再右栏
- Import API：正常响应（之前超时/死锁），3 个报告全部成功入库
- Dashboard/Subjects/Reports API：入库后数据正常返回
- 核效完成并入库：一键完成，状态自动更新为 `imported`
