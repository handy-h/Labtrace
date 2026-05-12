# LabTrace — Personal Longitudinal Lab Test Data Platform

A professional data governance platform for managing personal lab test records across multiple healthcare providers.

## Core Features

- **Batch Digitalization of Lab Reports** — Upload images/PDFs; unified OCR recognition via Alibaba Cloud with progressive parsing
- **OCR Confidence Verification** — Three-tier visual feedback (high/medium/low); mandatory manual confirmation for low-confidence items
- **Immersive Comparison View** — Side-by-side layout with synchronized scrolling on the original image and data grid on the right, plus OCR mapping wizard
- **Longitudinal Health Trend Analysis** — Multi-source merged line charts, dynamic reference bands, and drill-down data exploration
- **Dynamic Biological Reference Range Matching** — Automatic matching based on subject's gender and age at sampling date
- **Unit Standardization Engine** — Pre-configured conversion matrix with safety valve validation
- **Calculated Cross-Check** — Pre-validation before database insertion (e.g., Total Protein = Albumin + Globulin)
- **Test Item Classification** — Category management, normalization, and report filtering by category
- **Data Privacy** — Local SQLite storage with AES-256-GCM encrypted backups

## Technology Stack

| Layer | Technology |
|-------|------------|
| Backend | Go 1.25 + Gin v1.12 |
| Database | SQLite3 (WAL mode) |
| Frontend | Vue 3 + Tailwind CSS (CDN) |
| Charts | ECharts 5 |
| OCR | Alibaba Cloud OCR Unified Recognition API |
| Encryption | AES-256-GCM |

## Quick Start

### 1. Prerequisites

- Go 1.25+
- Modern browser (Chromium-based, resolution ≥1024px)

### 2. Configuration

```bash
cp .env.example .env
# Edit .env and fill in DB_KEY and Alibaba Cloud OCR credentials
```

### 3. Build and Run

```bash
# Option 1: Using Makefile (recommended)
make build     # Build the binary
make dev       # Development mode (verbose logging, output to dev.log)
make run       # Production mode

# Option 2: Direct compilation
go build -o labtrace .
./labtrace
```

The service listens on `http://localhost:8080` by default. Open it in your browser to get started.

### 4. Makefile Commands

| Command | Description |
|---------|-------------|
| `make build` | Compile the executable binary |
| `make dev` | Run in development mode (verbose logs, output to dev.log) |
| `make run` | Run in production mode (minimal logs) |
| `make stop` | Graceful shutdown |
| `make clean` | Clean temporary files, caches, and binary (preserves data/) |
| `make rebuild` | Clean then build |
| `make restart` | Stop then start |

### 5. First Launch

The system auto-initializes:
- 43 standard test items (19 hematology + 24 biochemistry)
- 38 biological reference intervals (segmented by gender and age)
- 8 unit conversion rules
- 2 calculated cross-check rules

## Project Structure

```
LabTrace/
├── main.go                          # Entry point, route registration
├── Makefile                         # Build scripts (build/dev/run/stop/clean)
├── internal/
│   ├── config/config.go             # Configuration loading
│   ├── database/
│   │   ├── db.go                    # SQLite connection management
│   │   ├── migrations.go            # DDL migrations (12 tables)
│   │   └── seed.go                  # Seed data initialization
│   ├── models/models.go             # Data model definitions
│   ├── handlers/                    # HTTP handlers
│   │   ├── ping.go                  # Health check
│   │   ├── subject.go               # Subject & hospital CRUD
│   │   ├── testitem.go              # Test items, aliases & reference intervals CRUD
│   │   ├── unit.go                  # Unit conversion CRUD
│   │   ├── calc.go                  # Calculated cross-check rules CRUD
│   │   ├── category.go              # Report category CRUD
│   │   ├── ocr.go                   # OCR upload & recognition
│   │   ├── ocr_quota.go             # OCR quota query/update + re-OCR
│   │   ├── report.go                # Lab report CRUD / verification / ingestion
│   │   ├── rule.go                  # Hospital parsing rules & mapping templates CRUD
│   │   ├── trend.go                 # Trend data queries
│   │   ├── dashboard.go             # Dashboard statistics & anomaly filtering
│   │   ├── backup.go                # Backup export & import
│   │   └── audit.go                 # Audit log queries
│   ├── services/                    # Business logic layer
│   │   ├── ocr_service.go           # Alibaba Cloud OCR integration
│   │   ├── rule_service.go          # Parsing rule matching
│   │   ├── unit_service.go          # Unit conversion engine
│   │   ├── reference_service.go     # Dynamic reference range matching
│   │   ├── flag_service.go          # Flag calculation
│   │   ├── calc_service.go          # Calculated cross-check
│   │   ├── dict_service.go          # Data dictionary mapping
│   │   ├── testitem_service.go      # Test item service (Backfill, etc.)
│   │   ├── backup_service.go        # Encrypted backup
│   │   └── audit_service.go         # Audit log service
│   └── middleware/cors.go           # CORS middleware
├── web/                             # Frontend (Vue 3 via CDN, no build step)
│   ├── index.html                   # Entry HTML
│   ├── css/app.css                  # Global styles & design system
│   └── js/
│       ├── app.js                   # Vue 3 app entry & router
│       ├── api.js                   # API request wrapper
│       ├── utils.js                 # Utility functions
│       ├── views/                   # 6 view components
│       │   ├── dashboard.js         # Dashboard
│       │   ├── ocr-import.js        # OCR upload & comparison view
│       │   ├── ocr-mapping-wizard.js# OCR mapping wizard
│       │   ├── subjects.js          # Subject management
│       │   ├── test-items.js        # Test item library
│       │   ├── trend.js             # Trend analysis
│       │   └── settings.js          # Settings
│       └── components/              # 8 reusable components
│           ├── data-table.js        # Data table
│           ├── crud-modal.js        # CRUD modal
│           ├── search-dropdown.js   # Search dropdown
│           ├── subject-selector.js  # Subject selector
│           ├── sparkline.js         # Sparkline chart
│           ├── sync-scroll.js       # Synchronized scroll panels
│           ├── drilldown-popup.js   # Drill-down popup
│           └── ocr-mapping-wizard.js# OCR mapping wizard
├── data/                            # Runtime data directory (gitignored)
│   ├── labtrace.db                  # SQLite database
│   └── uploads/                     # Uploaded files
├── docs/                            # Documentation
│   ├── requirements/                # Requirements & mockups
│   └── bugfix/                      # Bug fix records
└── example/                         # Example data
    ├── 134954174_2079561093.pdf     # Sample lab report PDF
    └── ocr.txt                      # Sample OCR result
```

## API Overview

Base path: `/api/v1`. Unified response format: `{"code":0,"message":"ok","data":...}`

| Module | Endpoints | Description |
|--------|-----------|-------------|
| Subjects | 5 | CRUD + search |
| Hospitals | 4 | CRUD |
| Test Items | 4 | CRUD + category filtering |
| Aliases | 3 | List / create / delete |
| Reference Intervals | 4 | CRUD |
| Unit Conversion | 4 | CRUD + safety valve validation |
| Calculated Rules | 4 | CRUD |
| Report Categories | 5 | CRUD + normalization |
| OCR / Reports | 10 | Upload / recognize / verify / ingest / re-OCR / blocks / mapping |
| OCR Quota | 2 | Query / update monthly usage |
| Hospital Rules | 4 | CRUD |
| Hospital Mapping Templates | 2 | Query / save |
| Trend Analysis | 1 | Data query |
| Dashboard | 2 | Statistics & anomaly list |
| Backup | 4 | Export / import / list / delete |
| Audit Log | 1 | Query |

## OCR Configuration

Uses Alibaba Cloud OCR Unified Recognition API (`RecognizeGeneral`). Configure in `.env`:

```
ALI_ACCESS_KEY_ID=yourAccessKeyID
ALI_ACCESS_KEY_SECRET=yourAccessKeySecret
OCR_QUOTA_MONTHLY=500    # Optional: monthly API call limit
```

**OCR Quota Management**: The system automatically tracks monthly OCR API call counts. View usage and manually calibrate on the Settings page.

Reference: https://help.aliyun.com/zh/ocr/product-overview/ocr-unified-identification/

## UI Views

7 main views:
1. **Dashboard** — Stat cards, anomaly filtering, summary table
2. **OCR Upload** — File upload + immersive comparison view (synchronized original image + data grid) + mapping wizard
3. **Subject Management** — List + detail panel + auto age calculation
4. **Test Item Library** — Standard items + alias mapping + reference ranges + unit conversion + calculated rules
5. **Trend Analysis** — ECharts line charts + dynamic reference bands + drill-down
6. **Settings** — Key management, backup & restore, OCR quota, audit log

## Design System

A unified frontend design system (CSS variables in `web/css/app.css`) includes:
- Color system (primary, semantic, neutral)
- Spacing / shadow / border-radius variables
- Reusable component styles (data table, modal, search input, etc.)

## License

MIT License

Copyright (c) 2025 LabTrace

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.