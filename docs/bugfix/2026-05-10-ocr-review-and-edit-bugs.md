# OCR核效与编辑相关Bug修复

**日期**: 2026-05-10  
**严重程度**: 高  
**状态**: 已修复

## 现象

1. 新建受检者/医院弹窗浮层样式丢失，弹窗内容撑满全屏
2. 新建医院表单有"地址"字段，但不需要；缺少"医院级别"字段
3. OCR核效页面预览文件与上传文件不一致
4. OCR识别后置信度全部为0
5. 行内编辑保存数据错位——只有第一行正确，后续行保存的是上一行数据
6. 修改保存入库后，查看页面数据与修改时不一致
7. 置信度字段不需要展示
8. 提示符(flag)字段在核效阶段不展示，只有入库后才显示
9. 表头映射环节采样日期未自动填入
10. 单元格修复中删除的噪声行(采集时间/医院地址)入库后又显示

## 修复

### Bug 1: 浮层样式丢失

**根因**: `app.css` 中 `.drill-modal > div` 设置了 `flex: 1`，导致弹窗内容区域撑满遮罩层。

**修改**:
- `web/css/app.css` — `.drill-modal` 增加 `align-items: center; justify-content: center`；`.drill-modal > div` 移除 `flex: 1`，增加弹窗样式（白色背景、圆角、阴影、padding、max-height）；新增 `.drill-modal-full` 类用于全屏弹窗
- `web/js/views/ocr-import.js` — 报告详情弹窗添加 `drill-modal-full` 类

### Bug 2: 医院表单字段调整

**修改**:
- `internal/models/models.go` — Hospital 模型增加 `Level` 字段
- `internal/database/migrations.go` — 增加 `ALTER TABLE hospitals ADD COLUMN level` 迁移
- `internal/handlers/subject.go` — ListHospitals/CreateHospital/UpdateHospital 增加 level 字段
- `web/js/views/settings.js` — 前端医院列表"地址"改为"级别"，弹窗表单 address 输入框改为 level 下拉选择（三甲/三乙/二甲/二乙/一甲/一乙/其他）

### Bug 3: 预览文件不一致

**根因**: `GetReportImage` 未设置 `Cache-Control` 响应头，浏览器可能缓存图片响应。

**修改**:
- `internal/handlers/ocr.go` — `GetReportImage` 添加 `Cache-Control: no-cache, no-store, must-revalidate` 等响应头
- `web/js/views/ocr-import.js` — `viewReport` 中使用 `r.data.id` 替代 `id`，添加 `?t=Date.now()` 时间戳参数

### Bug 4: 置信度全部为0

**根因**: `parseContentText`（Path 3）创建 `ParsedLabItem` 时未设置 `Confidence` 字段；`groupIntoItem`（Path 1）依赖文本匹配获取置信度，`mergeSplitDecimals` 合并文本后匹配失败导致置信度为0。

**修改**:
- `internal/services/ocr_parser.go` — `parseContentText` 中设置 `Confidence: 95`；`groupIntoItem` 中改为从同一行所有OCR块中取最大置信度，不依赖文本匹配

### Bug 5: 行编辑保存数据错位

**根因**: 所有调用 `api.updateReportItem` 的地方直接引用 `editForm.value`，但 `editForm.value` 是响应式对象，在异步回调执行时可能已被 `startEdit` 覆盖为下一行数据。

**修改**:
- `web/js/views/ocr-import.js` — `saveEdit`、`saveEditQuiet`、`onEditBlur`、`doConfirm`、`doImport` 中所有 `editForm.value` 传给API前先做浅拷贝快照 `const snapshot = { ...editForm.value }`；`onEditBlur` 移除 `clearTimeout` 取消前一行保存的逻辑，改为每行独立延迟保存

### Bug 6: 入库后查看数据不一致

**根因**: `doConfirm` 成功后调用 `closeReport()` 关闭弹窗而非重新加载；`doImport` 入库后也未重新加载报告详情。

**修改**:
- `web/js/views/ocr-import.js` — `doConfirm` 和 `doImport` 成功后调用 `viewReport()` 重新加载报告详情；确认/入库前先保存当前编辑中的数据

### Bug 7: 取消置信度展示

**修改**:
- `web/js/views/ocr-import.js` — 表头移除"置信度"列，移除置信度数据单元格

### Bug 8: 提示符在核效阶段不显示

**根因**: `flag` 只有在 `ImportReport` 时才计算，`ConfirmReport` 和 `GetReport` 都不计算。

**修改**:
- `internal/handlers/report.go` — 提取 `matchRefAndCalcFlag` 函数；`ConfirmReport` 中调用 `matchRefAndCalcFlag`；`GetReport` 中 review 状态自动调用 `matchRefAndCalcFlag`；`ImportReport` 简化为调用 `matchRefAndCalcFlag`

### Bug 9: 采样日期未自动填入

**根因**: `goStep2` 检测到表内无日期列时只显示手动输入框，未从OCR块中自动提取日期。

**修改**:
- `web/js/views/ocr-mapping-wizard.js` — 新增 `extractDateFromOCRBlocks` 函数，从OCR块中自动提取采样日期（优先匹配"采集时间/采样时间"前缀，回退匹配任意YYYY-MM-DD格式）；`goStep2` 和 `skipToStep2` 中自动调用

### Bug 10: 删除的噪声行入库后又显示

**根因**: `doApplyAndFinish` 只更新 `parsedItems.value` 中存在的行，未删除用户在Step 3中删除的行，数据库中对应记录仍存在。

**修改**:
- `internal/handlers/report.go` — 新增 `DeleteReportItem` API
- `main.go` — 注册路由 `DELETE /reports/:id/items/:itemId`
- `web/js/api.js` — 新增 `deleteReportItem` 前端API方法
- `web/js/views/ocr-mapping-wizard.js` — 新增 `originalItemIds` ref记录Step 3开始时的item id；`doApplyAndFinish` 中对比原始id和当前id，删除不在当前列表中的行

## 涉及文件

| 文件 | 修改类型 |
|------|----------|
| `web/css/app.css` | 修改 |
| `web/js/api.js` | 修改 |
| `web/js/views/ocr-import.js` | 修改 |
| `web/js/views/settings.js` | 修改 |
| `web/js/views/ocr-mapping-wizard.js` | 修改 |
| `internal/models/models.go` | 修改 |
| `internal/database/migrations.go` | 修改 |
| `internal/handlers/subject.go` | 修改 |
| `internal/handlers/ocr.go` | 修改 |
| `internal/handlers/report.go` | 修改 |
| `internal/services/ocr_parser.go` | 修改 |
| `main.go` | 修改 |
