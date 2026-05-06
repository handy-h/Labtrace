# 2026-05-07：OCR 解析器分类逻辑修复 & 单位继承 & 列顺序调整

## 概述

修复了 OCR 解析器（`ocr_parser.go`）中多个分类逻辑缺陷，导致检验报告解析结果全部显示在"结果"列、单位缺失、说明文字误解析等问题。同时调整了核效页面表格列顺序。

---

## Bug 1：`<220`/`<500` 等 `<X` 格式被错误分类为 `range`

### 现象

D-二聚体报告的 `<220`（结果值）和 `<500`（参考区间）都被分类为 `range`，导致状态机无法正确识别项目结构，`ParseLabResults` 返回 0 个 item，走 fallback 路径将每个 OCR 文本块单独插入数据库。

### 根因

`isRangeStr` 函数使用正则 `^[<>]?\s*\d+...` 匹配范围，将 `<X` 和 `>X` 格式也匹配为参考区间。但在检验报告中，`<220` 是结果值，`<500` 是参考区间上限，两者格式相同，需要通过位置上下文区分。

### 修复

1. `isRangeStr` 仅匹配 `X-Y` 或 `X~Y` 区间格式，不再匹配 `<X`/`>X`
2. 新增 `isBoundValue` 函数，将 `<X`/`>X`/`≤X`/`≥X` 分类为 `value`
3. `groupIntoItem` 使用位置上下文：第一个 value = 结果值，第二个 value = 参考区间
4. `parseLinear` 状态机 `sVal` 状态下，第二个 value 视为参考区间

### 涉及文件

- `internal/services/ocr_parser.go`：`isRangeStr`、`isBoundValue`、`classifyText`、`groupIntoItem`、`parseLinear`

---

## Bug 2：`ug/L FEU` 等单位不在已知单位列表中

### 现象

D-二聚体单位 `ug/L FEU` 被分类为 `noise` 而非 `unit`，导致解析结果缺少单位。

### 根因

`isKnownUnitStr` 的 `knownUnits` 列表缺少 D-二聚体常用单位 `ug/L FEU`、`μg/L FEU`、`mg/L FEU`、`ug/L`、`FEU` 等。

### 修复

扩展 `knownUnits` 列表，添加：
- `ug/L FEU`、`μg/L FEU`、`mg/L FEU`、`ug/L`、`FEU`
- `umol/L`、`nmol/L`、`pmol/L`
- `U/ml`、`mU/ml`、`IU/ml`
- `cells/μL`、`cells/uL`
- `s`、`sec`、`min`、`Ratio`

### 涉及文件

- `internal/services/ocr_parser.go`：`isKnownUnitStr`

---

## Bug 3：噪声过滤不足——人名、说明文字、日期时间未被过滤

### 现象

- 人名"王靖程"被分类为 `name`，与检验项目名混淆
- 说明文字"※D-二聚体<500 ug/L FEU，有99.7%概率可排除静脉血栓栓塞症"被分类为 `name`
- OCR 合并的日期时间"2026-04-2703：49"未被过滤

### 根因

`isHeaderFooterNoise` 缺少以下过滤规则：
- 中文人名（2-3 个汉字，以常见姓氏开头）
- ※ 开头的临床说明文字
- 超过 10 个汉字的长文本（几乎总是说明/免责声明）
- OCR 合并的日期时间格式
- 含"概率"、"排除"、"血栓发"等关键词的说明文字

### 修复

1. 新增 `isPersonNameLike` 函数，识别常见姓氏开头的 2-3 字中文名
2. 添加 `※`/`*` 开头文本过滤
3. 添加超过 10 个汉字的长文本过滤
4. 添加 OCR 合并日期时间正则 `^\d{4}\d{2}\d{2}\d{2}[：:]\d{2}`
5. 扩展 `noisePatterns` 添加"概率"、"排除"、"血栓发"、"静脉血栓"等

### 涉及文件

- `internal/services/ocr_parser.go`：`isHeaderFooterNoise`、`isPersonNameLike`

---

## Bug 4：`parseLinear` 被跳过——`hasMergeableBlocks` 误判

### 现象

当 OCR 返回的所有文本块 Row=0、坐标=0 时，`parseStructured` 返回 nil，`parseLinear` 也被跳过（因部分文本含空格+中文被误判为"合并行"），最终 `parseContentText` 也返回 0。

### 根因

`ParseLabResults` 中 `hasMergeableBlocks` 检测逻辑：只要有一个文本块含空格和中文就跳过 `parseLinear`。但大部分文本块是单 token，`parseLinear` 才是正确路径。

### 修复

简化 `ParseLabResults` 入口逻辑：始终先尝试 `parseStructured`，再尝试 `parseLinear`，最后 fallback 到 `parseContentText`。移除 `hasMergeableBlocks` 判断。

### 涉及文件

- `internal/services/ocr_parser.go`：`ParseLabResults`

---

## Bug 5：数据库缺少 `test_item_name` 和 `ref_interval_text` 列

### 现象

INSERT 语句引用 `test_item_name` 列，但 `report_items` 表 schema 中不存在该列，导致 SQL 错误。

### 根因

`migrations.go` 中 `report_items` 表定义未包含 `test_item_name` 和 `ref_interval_text` 列，但 `ocr.go` 和 `ocr_quota.go` 的 INSERT 语句使用了这些列。

### 修复

1. `migrations.go` 添加 ALTER TABLE 迁移：
   - `ALTER TABLE report_items ADD COLUMN test_item_name TEXT NOT NULL DEFAULT ''`
   - `ALTER TABLE report_items ADD COLUMN ref_interval_text TEXT NOT NULL DEFAULT ''`
2. `report.go` 的 `loadReportItems` 查询改为 `COALESCE(ri.test_item_name, ti.standard_name, '')` 优先使用 OCR 原始项目名
3. INSERT 语句同时填充 `ref_interval_text` 和 `row_notes`

### 涉及文件

- `internal/database/migrations.go`
- `internal/handlers/ocr.go`
- `internal/handlers/ocr_quota.go`
- `internal/handlers/report.go`

---

## Bug 6：血小板分布宽度和平均血小板体积单位缺失

### 现象

PDW 和 MPV 的 `original_unit` 为空，因为 OCR 识别时多行共享同一单位列，只识别了第一个出现的 "fl"。

### 根因

OCR 对共享单位列只输出一次单位文本块，后续行没有单位块。解析器无单位继承/默认单位机制。

### 修复

在 `parseLinear` 的 `tryEmit` 中添加：
1. **已知项目默认单位映射** `defaultUnitMap`：PDW→fl, MPV→fl, MCV→fl, MCH→pg, RDW→%, PCT→% 等
2. 当 OCR 未识别出单位时，优先查表获取默认单位
3. 其次继承上一个 item 的单位（fallback）

### 涉及文件

- `internal/services/ocr_parser.go`：`parseLinear`

---

## Bug 7：核效页面表格列顺序不合理

### 现象

表格列顺序为：项目→结果→单位→置信度→提示符→参考区间

用户期望：项目→结果→参考区间→单位→提示符→置信度

### 修复

调整 `ocr-import.js` 中 `<thead>` 和 `<tbody>` 的列顺序。

### 涉及文件

- `web/js/views/ocr-import.js`

---

## 修改文件汇总

| 文件 | 修改类型 |
|------|----------|
| `internal/services/ocr_parser.go` | 重写：修复分类逻辑、添加单位继承、增强噪声过滤 |
| `internal/services/ocr_parser_test.go` | 新增：8 个单元测试 |
| `internal/database/migrations.go` | 修改：添加 ALTER TABLE 迁移 |
| `internal/handlers/ocr.go` | 修改：INSERT 添加 ref_interval_text |
| `internal/handlers/ocr_quota.go` | 修改：INSERT 添加 ref_interval_text |
| `internal/handlers/report.go` | 修改：查询优先使用 ri.test_item_name |
| `web/js/views/ocr-import.js` | 修改：调整表格列顺序 |

---

## 验证结果

### D-二聚体报告（报告 #2）

修复前：35 个 item，每个 OCR 文本块单独成行，`test_item_name` 为空

修复后：1 个 item
```
name=1.D-二聚体., value=<220, unit=ug/L FEU, ref=<500, conf=99
```

### 血常规报告（报告 #1）

修复前：PDW 和 MPV 单位为空

修复后：
```
name=血小板分布宽度, value=15.5, unit=fl, ref=9.3-18.1
name=平均血小板体积, value=7.6, unit=fl, ref=7.4-12.5
```
