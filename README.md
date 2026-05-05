# 溯源健康 (LabTrace)

个人纵向检验数据管理平台 — 通过专业数据治理手段，解决个人在多医疗机构间的检验数据孤岛问题。

## 核心功能

- **检验报告单批量数字化** — 上传图片/PDF，阿里云OCR统一识别，渐进式解析
- **OCR置信度校核** — 高/中/低三级视觉反馈，强制人工确认低置信度项
- **纵向健康趋势分析** — 多源合并折线图，动态参考带，数据下钻
- **生物参考区间动态匹配** — 根据受检者性别/采样当日年龄自动匹配
- **单位标准化引擎** — 预设转换矩阵 + 安全阀验证
- **计算勾稽校验** — 入库前自动校验（如总蛋白=白蛋白+球蛋白）
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
go build -o labtrace .
./labtrace
```

服务默认监听 `http://localhost:8080`，浏览器打开即可使用。

### 4. 首次启动

系统自动初始化：
- 43项标准检验项目（血常规19项 + 生化24项）
- 38条生物参考区间（按性别/年龄分段）
- 8条单位转换规则
- 2条计算校验规则

## 项目结构

```
LabTrace/
├── main.go                          # 入口，路由注册
├── internal/
│   ├── config/config.go             # 配置加载
│   ├── database/
│   │   ├── db.go                    # SQLite连接管理
│   │   ├── migrations.go            # DDL迁移（11张表）
│   │   └── seed.go                  # 预置数据初始化
│   ├── models/models.go             # 数据模型定义
│   ├── handlers/                    # HTTP处理器
│   │   ├── ping.go                  # 健康检查
│   │   ├── subject.go               # 受检者+医院CRUD
│   │   ├── testitem.go              # 检验项目+别名+参考区间CRUD
│   │   ├── unit.go                  # 单位转换CRUD
│   │   ├── calc.go                  # 计算校验规则CRUD
│   │   ├── ocr.go                   # OCR上传/识别
│   │   ├── report.go                # 检验报告CRUD/核效/入库
│   │   ├── rule.go                  # 医院解析规则CRUD
│   │   ├── trend.go                 # 趋势数据查询
│   │   ├── dashboard.go             # 仪表盘统计+异常筛选
│   │   ├── backup.go                # 备份导出/导入
│   │   └── audit.go                 # 审计日志查询
│   ├── services/                    # 业务逻辑层
│   │   ├── ocr_service.go           # 阿里云OCR调用
│   │   ├── rule_service.go          # 解析规则匹配
│   │   ├── unit_service.go          # 单位转换引擎
│   │   ├── reference_service.go     # 参考区间动态匹配
│   │   ├── flag_service.go          # 提示符计算
│   │   ├── calc_service.go          # 计算勾稽校验
│   │   ├── dict_service.go          # 数据字典映射
│   │   ├── trend_service.go         # 趋势数据聚合
│   │   ├── backup_service.go        # 加密备份
│   │   └── audit_service.go         # 审计日志
│   └── middleware/cors.go           # CORS中间件
├── web/                             # 前端
│   ├── index.html                   # 入口HTML
│   ├── css/app.css                  # 全局样式
│   └── js/
│       ├── app.js                   # Vue3应用+6个视图组件
│       └── api.js                   # API请求封装
├── data/                            # 数据目录（运行时生成）
│   ├── labtrace.db                  # SQLite数据库
│   ├── uploads/                     # 上传文件
│   └── backups/                     # 备份文件
├── docs/                            # 文档
│   └── requirements/                # 需求文档+原型图
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
| OCR/报告 | 7 | 上传/识别/核效/入库/图片 |
| 医院规则 | 4 | CRUD |
| 趋势分析 | 1 | 数据查询 |
| 仪表盘 | 2 | 统计/异常列表 |
| 备份 | 4 | 导出/导入/列表/删除 |
| 审计日志 | 1 | 查询 |

## OCR 配置

使用阿里云OCR统一识别接口（RecognizeGeneral），需在 `.env` 中配置：

```
ALI_ACCESS_KEY_ID=你的AccessKeyID
ALI_ACCESS_KEY_SECRET=你的AccessKeySecret
```

参考文档：https://help.aliyun.com/zh/ocr/product-overview/ocr-unified-identification/

## 界面

6个主要视图：
1. **仪表盘** — 统计卡片 + 异常筛选 + 结果摘要表
2. **OCR上传** — 文件上传 + 沉浸式比对视图（左原图+右数据网格）
3. **受检者管理** — 列表 + 详情面板 + 年龄自动计算
4. **检验项目库** — 标准项目 + 别名映射 + 参考区间 + 单位转换 + 计算规则
5. **趋势分析** — ECharts折线图 + 动态参考带 + 数据下钻
6. **设置** — 密钥管理 + 备份恢复 + 审计日志

## 许可证

私有项目，未授权禁止使用。
