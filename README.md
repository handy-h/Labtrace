# 溯源健康 (LabTrace)

个人纵向检验数据管理平台 — 通过专业数据治理手段，解决个人在多医疗机构间的检验数据孤岛问题。

## 核心功能

- **检验报告单批量数字化** — 上传图片/PDF，阿里云OCR统一识别，渐进式解析
- **OCR置信度校核** — 高/中/低三级视觉反馈，强制人工确认低置信度项
- **沉浸式比对视图** — 左侧原图同步滚动 + 右侧数据网格，OCR映射向导辅助字段映射
- **纵向健康趋势分析** — 多源合并折线图，动态参考带，数据下钻
- **生物参考区间动态匹配** — 根据受检者性别/采样当日年龄自动匹配
- **单位标准化引擎** — 预设转换矩阵 + 安全阀验证
- **计算勾稽校验** — 入库前自动校验（如总蛋白=白蛋白+球蛋白）
- **影像报告管理** — 上传影像报告图片/PDF，OCR识别，映射向导辅助字段提取
- **批量导入** — 一次上传多份检验/影像报告，批量OCR识别与入库
- **数据私有化** — 本地SQLite + AES-256-GCM加密备份

## 技术栈

| 层次 | 技术 |
|------|------|
| 后端 | Go 1.25 + Gin v1.12 |
| 数据库 | SQLite3 (WAL模式) |
| 前端 | Vue 3 + Tailwind CSS (CDN) |
| 图表 | ECharts 5 |
| OCR | 阿里云OCR统一识别接口 |
| 加密 | AES-256-GCM |

## 快速开始

### 1. 环境准备

- Go 1.25+
- 现代浏览器 (Chromium内核, 分辨率 ≥1024px)

### 2. 配置

```bash
cp .env.example .env
# 编辑 .env，填入 DB_KEY 和阿里云 OCR 凭证
```

### 3. 构建与运行

```bash
# 方式一：使用 Makefile（推荐）
make build     # 编译
make dev       # 开发模式（带日志）
make run       # 生产模式

# 方式二：直接编译（CGO 必须启用）
CGO_ENABLED=1 go build -o labtrace .
./labtrace
```

> **注意**：Makefile 依赖 bash 等 Linux 工具链，在 Windows 上请使用 PowerShell 脚本 `\labtrace.ps1` 替代。

服务默认监听 `http://localhost:8080`，浏览器打开即可使用。

### 4. Makefile 命令

| 命令 | 说明 |
|------|------|
| `make build` | 编译生成可执行二进制文件 |
| `make dev` | 开发者模式运行（丰富日志，输出到 dev.log） |
| `make run` | 生产模式运行（仅必要日志） |
| `make stop` | 优雅关闭应用 |
| `make test` | 运行单元测试 |
| `make lint` | 代码静态检查（go vet） |
| `make clean` | 清理临时文件、缓存及二进制文件（保留 data/） |
| `make rebuild` | 先清理再编译 |
| `make restart` | 先停止再启动 |

### 5. 首次启动

系统首次启动时会自动创建数据库表结构并建立索引，但不会插入任何预设数据。所有检验项目、参考区间、单位转换及计算规则均需通过界面手动创建或导入。

## 项目结构

```
LabTrace/
├── main.go                          # 入口，路由注册
├── Makefile                         # 构建脚本（build/dev/run/stop/clean）
├── internal/
│   ├── config/config.go             # 配置加载
│   ├── database/
│   │   ├── db.go                    # SQLite连接管理
│   │   ├── migrations.go            # DDL迁移（15张表）
│   │   └── seed.go                  # 预置数据初始化
│   ├── models/
│   │   ├── models.go                # 数据模型定义
│   │   └── imaging.go               # 影像报告数据模型
│   ├── handlers/                    # HTTP处理器
│   │   ├── ping.go                  # 健康检查
│   │   ├── subject.go               # 受检者+医院CRUD
│   │   ├── testitem.go              # 检验项目+别名+参考区间CRUD
│   │   ├── unit.go                  # 单位转换CRUD
│   │   ├── calc.go                  # 计算校验规则CRUD
│   │   ├── ocr.go                   # OCR上传/识别
│   │   ├── ocr_quota.go             # OCR配额查询/更新 + 重新OCR
│   │   ├── ocr_wg.go                # OCR后台goroutine等待组（优雅关闭）
│   │   ├── report.go                # 检验报告CRUD/核效/入库
│   │   ├── imaging.go               # 影像报告CRUD/OCR/映射/入库
│   │   ├── rule.go                  # 医院解析规则+映射模板CRUD
│   │   ├── helpers.go               # 公共辅助函数（参数解析等）
│   │   ├── trend.go                 # 趋势数据查询
│   │   ├── dashboard.go             # 仪表盘统计+异常筛选
│   │   ├── batch_import.go          # 检验报告批量导入
│   │   ├── batch_import_imaging.go  # 影像报告批量导入
│   │   ├── backup.go                # 备份导出/导入
│   │   └── audit.go                 # 审计日志查询
│   ├── services/                    # 业务逻辑层
│   │   ├── ocr_service.go           # 阿里云OCR调用
│   │   ├── ocr_parser.go            # OCR结果解析
│   │   ├── ocr_mapping.go           # OCR字段映射
│   │   ├── ocr_quota.go             # OCR配额管理
│   │   ├── imaging_ocr_service.go   # 影像报告OCR处理
│   │   ├── rule_service.go          # 解析规则匹配
│   │   ├── unit_service.go          # 单位转换引擎
│   │   ├── reference_service.go     # 参考区间动态匹配
│   │   ├── flag_service.go          # 提示符计算
│   │   ├── calc_service.go          # 计算勾稽校验
│   │   ├── dict_service.go          # 数据字典映射
│   │   ├── testitem_service.go      # 检验项目服务（Backfill等）
│   │   ├── trend_service.go         # 趋势数据聚合
│   │   ├── backup_service.go        # 加密备份
│   │   └── audit_service.go         # 审计日志
│   └── middleware/cors.go           # CORS中间件
├── web/                             # 前端（CDN加载Vue3，无需构建）
│   ├── index.html                   # 入口HTML
│   ├── css/app.css                  # 全局样式+设计系统
│   └── js/
│       ├── app.js                   # Vue3应用入口+路由
│       ├── api.js                   # API请求封装
│       ├── utils.js                 # 工具函数
│       ├── views/                   # 11个视图组件
│       │   ├── dashboard.js         # 仪表盘
│       │   ├── ocr-import.js        # OCR上传+比对视图
│       │   ├── ocr-mapping-wizard.js# 检验报告OCR映射向导
│       │   ├── imaging-mapping-wizard.js # 影像报告OCR映射向导
│       │   ├── batch_import.js      # 检验报告批量导入
│       │   ├── batch_import_imaging.js   # 影像报告批量导入
│       │   ├── reports.js           # 已入库报告管理
│       │   ├── subjects.js          # 受检者管理
│       │   ├── test-items.js        # 检验项目库
│       │   ├── trend.js             # 趋势分析
│       │   └── settings.js          # 设置
│       └── components/              # 6个可复用组件
│           ├── data-table.js        # 数据表格
│           ├── crud-modal.js        # CRUD弹窗
│           ├── search-dropdown.js   # 搜索下拉
│           ├── subject-selector.js  # 受检者选择器
│           ├── sparkline.js         # 迷你折线图
│           └── drilldown-popup.js   # 数据下钻弹窗
├── data/                            # 数据目录（运行时生成，已gitignore）
│   ├── labtrace.db                  # SQLite数据库
│   └── uploads/                     # 上传文件
├── docs/                            # 文档
│   ├── requirements/                # 需求文档+原型图
│   └── bugfix/                      # 修复记录
└── example/                         # 示例数据
    ├── 134954174_2079561093.pdf     # 示例检验报告PDF
    └── ocr.txt                      # OCR识别结果示例
```

## API 概览

基础路径：`/api/v1`，统一响应格式：`{"code":0,"message":"ok","data":...}`

| 模块 | 端点数 | 说明 |
|------|--------|------|
| 受检者 | 5 | CRUD + 搜索 |
| 医院 | 4 | CRUD |
| 检验项目 | 4 | CRUD + 分类筛选 |
| 项目别名 | 3 | 列表/创建/删除 |
| 参考区间 | 4 | CRUD |
| 单位转换 | 4 | CRUD + 安全阀验证 |
| 计算规则 | 4 | CRUD |
| OCR/检验报告 | 12 | 上传/识别/核效/入库/重新OCR/OCR块/映射/图片 |
| OCR配额 | 2 | 查询/更新当月使用量 |
| 影像报告 | 15 | 上传/识别/核效/入库/重新OCR/映射/模板 |
| 批量导入（检验） | 2 | 批量上传/批量确认入库 |
| 批量导入（影像） | 2 | 批量上传/批量确认入库 |
| 医院规则 | 4 | CRUD |
| 医院映射模板 | 4 | 检验/影像模板查询/保存 |
| 趋势分析 | 1 | 数据查询 |
| 仪表盘 | 2 | 统计/异常列表 |
| 备份 | 4 | 导出/导入/列表/删除 |
| 审计日志 | 1 | 查询 |

## OCR 配置

使用阿里云OCR统一识别接口（RecognizeGeneral），需在 `.env` 中配置：

```
ALI_ACCESS_KEY_ID=你的AccessKeyID
ALI_ACCESS_KEY_SECRET=你的AccessKeySecret
OCR_QUOTA_MONTHLY=500    # 可选，每月OCR调用配额上限
```

**OCR配额管理**：系统自动记录每月OCR API调用次数，可在设置页面查看用量并手动校准。

参考文档：https://help.aliyun.com/zh/ocr/product-overview/ocr-unified-identification/

## 界面

8个主要视图：
1. **仪表盘** — 统计卡片 + 异常筛选 + 结果摘要表
2. **OCR上传（检验）** — 文件上传 + 沉浸式比对视图（左原图同步滚动+右数据网格）+ 映射向导
3. **OCR上传（影像）** — 影像报告上传 + OCR识别 + 影像映射向导
4. **批量导入** — 多文件批量上传、OCR识别与一键入库（检验/影像）
5. **受检者管理** — 列表 + 详情面板 + 年龄自动计算
6. **检验项目库** — 标准项目 + 别名映射 + 参考区间 + 单位转换 + 计算规则
7. **趋势分析** — ECharts折线图 + 动态参考带 + 数据下钻
8. **设置** — 密钥管理 + 备份恢复 + OCR配额 + 审计日志

## 设计系统

前端采用统一的设计系统（`web/css/app.css` 中的CSS变量），包含：
- 颜色系统（主题色、语义色、中性色）
- 间距/阴影/圆角变量
- 组件样式复用（数据表格、弹窗、搜索框等）

## 许可证

本项目采用 MIT 开源协议，版权归属 LabTrace (c) 2025。

任何人都可以免费获取本软件及其相关文档文件的副本，并在不受限制的情况下使用、复制、修改、合并、发布、分发、再许可和/或销售本软件的副本，但须满足以下条件：

上述版权声明和本许可声明应包含在所有副本或重要部分的软件中。

本软件按"原样"提供，不附带任何形式的明示或暗示担保，包括但不限于适销性、特定用途适用性和非侵权性的担保。在任何情况下，作者或版权持有人均不对因使用本软件或与之相关的任何合同、侵权或其他行为而产生的任何索赔、损害或其他责任承担责任。