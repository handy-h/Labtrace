# 复核问题整改记录：test_item 匹配修复的回归与加固

- 日期：2026-10-02
- 前置：`2026-10-02-testitem-contains-mismatch.md`（首轮修复）、`2026-10-02-fix-verification-review.md`（复核发现的问题）
- 本轮目标：修复复核报告中的全部 P0/P1/P2/P3 问题
- 结果：`make audit` **FAIL=0 WARN=0**，`go vet` 干净，`go test ./...` 全绿

---

## 一、代码变更清单

| # | 文件 | 变更 | 对应问题 |
|---|---|---|---|
| 1 | `internal/services/testitem_service.go` | 标本前缀守卫由**单侧**改为**双向**：`HasPrefix(input,p) != HasPrefix(std,p)` 即拒绝 | P0：`白细胞`→`尿白细胞` |
| 2 | 同上 | `semanticKeywords` 补 5 个限定词：`离子`/`超敏`/`载脂蛋白`/`游离`/`结合` | P0：`离子钙`→`钙`、`C反应蛋白`→`超敏C反应蛋白`、`脂蛋白a`→`载脂蛋白A1` |
| 3 | 同上 | `LoadTestItemIndex` 候选查询加 `ORDER BY id` | P1：结果随查询计划漂移 |
| 4 | 同上 | `Match` 正/反向包含匹配在**长度并列时按 id 兜底** | P1：并列结果不确定 |
| 5 | 同上 | **删除死代码 `MatchTestItemByName`（95 行）**，全库统一走 `TestItemIndex.Match` | P1/P2：双实现分叉 |
| 6 | 同上 | `specimenPrefixes` → 导出 `SpecimenPrefixes`，供审计工具复用同一份规则 | P2：规则副本会漂移 |
| 7 | `internal/services/reference_service.go` | 新增 `rowQueryer` 接口 + `LoadReferenceIntervalsTx(tx, ids)`，与 DB 版共用同一实现 | P2：事务内查全局连接 |
| 8 | `internal/handlers/report.go` | `runMatchRefInTx` 改用 `LoadReferenceIntervalsTx` | P2：同上 |
| 9 | 同上 | 新增 `loadMatchContext()`：把只读准备（受检者/条目/字典索引/年龄）全部移到事务外 | P2：连接池互等 |
| 10 | 同上 | `ConfirmReport` 重构为「事务外只读（含去重检查）→ 事务内只写」；删除 `matchRefAndCalcFlagWithTx` | P2：`MaxOpenConns=2` 下并发 confirm 永久阻塞 |
| 11 | 同上 | 去重拦截**保留 HTTP 200 + code≠0** 并写入注释固化理由（前端 `api.js` 对 `!res.ok` 直接 throw 且 `doConfirmApi` 无 catch，只有 `code!=0` 才会 `alert(r.message)`） | P3：状态码认知 |
| 12 | `internal/services/dedup_service.go` | 新增 `normalizeSigPart`：去全部空白 + 转小写；**全空白噪声行不参与指纹**；数值**不做**等价归一化 | P3：OCR 细微差异漏拦 |
| 13 | `internal/database/migrations.go` | 新增 `idx_test_items_std_name_uniq`（`standard_name` 唯一索引），**容错创建**：老库有重名时仅告警不阻断启动 | P2：缺 DB 层防线 |
| 14 | `internal/services/dedup_service_test.go` | 新增 `TestContentSignatureNormalization`、`TestContainsMatchAllowedSpecimenPrefix`（20 组守卫断言）、`TestTestItemIndexMatchDeterministicTieBreak`、`TestTestItemIndexAliasBeatsContains` | 回归保护 |
| 15 | `cmd/audit/main.go`（新增） | 只读审计工具：字典完整性 + 全库回放一致性 + 标本前缀陷阱扫描 + 15 条已知陷阱回归断言，失败退出码 1 | P2：一键复扫 |
| 16 | `Makefile` | 新增 `make audit` 目标 | 同上 |

### 关于守卫双向收紧为何不会造成漏匹配

尿/粪类新项目下**已登记 23 条别名**覆盖省略标本字的写法：

```
比重→尿比重   浊度→尿浊度   隐血→尿潜血   酮体→尿酮体   颜色→尿颜色
蛋白质→尿蛋白质 亚硝酸盐→尿亚硝酸盐  pH值→尿酸碱度  白细胞酯酶→尿白细胞酯酶
性状→粪便性状  …（共 23 条）
```

这些走**第 2 级别名精确匹配**，优先级高于第 5 级包含匹配，因此双向收紧后仍能正常命中；
而 `白细胞` 未登记尿类别名（血的归血、尿的归尿），守卫得以正确拒绝。

---

## 二、数据变更

| 操作 | 内容 |
|---|---|
| 新建标准项目 | `C反应蛋白`(#275, mg/L)、`离子钙`(#276, mmol/L) —— 各含 1–2 条别名 |
| 撤销重复建项 | 删除本轮误建的 `脂蛋白a`(#277)；经审计工具发现 `脂蛋白(a)`(#58) 已存在且有 2 条数据，改为登记别名 `脂蛋白a` → #58 |
| 泛称别名 | `血糖` → `葡萄糖`(#14)、`肌酸激酶同工酶` → `肌酸激酶同工酶(质量法）`(#19) |

- 备份：`data/backups/labtrace-pre-auditfix-20261002.db`
- 结果：标准项目 276 项、别名 199 条、报告 188 份、条目 2262 条（其中 14 条 QC 对照行有意保留 NULL）

---

## 三、验证证据

### 3.1 单元测试（`go test ./...` 全绿）

```
TestContainsMatchAllowedSpecimenPrefix   20 组断言，含 P0 回归（白细胞↔尿白细胞）
TestTestItemIndexMatchDeterministicTieBreak  候选正序/逆序都必须取 id 较小者
TestTestItemIndexAliasBeatsContains      别名必须压过包含匹配
TestContentSignatureNormalization        噪声行/空格/大小写不影响指纹；数值等价写法不归一化
```

### 3.2 全库审计（`make audit`）

```
[1] 项目字典完整性            OK 无重名标准项目 / 无别名一名多主 / 无别名遮蔽标准名
[2] 数据 ↔ 规则一致性          OK 无「未映射但可匹配」/ 无「已映射但规则拒绝」/ 归属与规则完全一致
[3] 标本前缀短名陷阱           OK 未发现未登记别名的标本前缀吸附
[4] 已知陷阱回归断言           OK 15 条全部通过
汇总: FAIL=0  WARN=0
```

审计工具在本轮**真实发挥作用**：第一次运行时即 FAIL 出「别名 `脂蛋白(a)` 遮蔽他人标准名」，
暴露了我刚写入的重复建项，随即撤销修正。

### 3.3 端到端（服务已重建并重启，端口 8080）

| 验证项 | 结果 |
|---|---|
| 唯一索引已创建 | `idx_test_items_std_name_uniq` 存在，启动无告警 |
| 肌酐趋势回归 | 25 条、全为「肌酐」、91.0~130.0 μmol/L、日期唯一 |
| 重复内容确认 | 克隆 #34 → `code:1`「已有内容完全一致的报告（#34）」→ 状态停留 `review` |
| 改一个值后确认 | `code:0` → 状态 `imported`、`confidence=100`（证明重构后 matchRef/写回/提交链路完好） |
| 测试数据清理 | 删除克隆 #227，恢复 188 份报告，复跑审计仍 FAIL=0 |

---

## 四、遗留与已知边界（不再阻塞）

1. **去重仍是精确指纹**：归一化只处理空白与大小写。若同一报告两次 OCR 的结果差异较大
   （如识别出的行数不同、数值识别错位），指纹不同仍会漏拦。要彻底解决需引入相似度阈值
   （如条目集合的 Jaccard 相似度），属功能增强而非缺陷修复。
2. **拦截后需人工删除**：被拦报告停留 `review`，需用户在界面手动删除。提示语已明确说明。
3. **血糖分析物拆分仍保留**：`葡萄糖`(#14) 与 `空腹血糖`(#65) 是有意拆分（避免空腹/随机混趋势）。
   本轮只把泛称 `血糖` 显式归到 `葡萄糖`，未合并两者。若要合并，把 `空腹血糖` 登记为
   `葡萄糖` 的别名即可（一行数据操作）。
4. **同名不同方法学项目**：`肌酸激酶同工酶(质量法）`(#19) 与 `（酶法）`(#54) 并存。
   本轮通过别名让泛称落回主力项 #19，两者仍可分别看趋势。
5. `test_items.standard_name` 唯一索引为**容错创建**：若未来库中出现重名，启动只告警不拦截，
   需要跑 `make audit` 定位后人工合并。

---

## 五、日常使用建议

改动匹配规则（`internal/services/testitem_service.go`）、批量导入或重映射数据之后，
**先跑 `make audit`**，再考虑发布：

```bash
make audit     # 只读，不修改任何数据；FAIL 时退出码为 1
```
