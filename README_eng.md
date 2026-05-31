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
- **Imaging Report Management** — Upload imaging report images/PDFs, OCR recognition, mapping wizard for field extraction
- **Batch Import** — Upload multiple lab/imaging reports at once with bulk OCR recognition and ingestion
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

# Option 2: Direct compilation (CGO is required)
CGO_ENABLED=1 go build -o labtrace .
./labtrace
```

> **Note**: The Makefile relies on bash and Linux utilities. On Windows, use the PowerShell script `.\labtrace.ps1` instead.

The service listens on `http://localhost:8080` by default. Open it in your browser to get started.

### 4. Makefile Commands

| Command | Description |
|---------|-------------|
| `make build` | Compile the executable binary |
| `make dev` | Run in development mode (verbose logs, output to dev.log) |
| `make run` | Run in production mode (minimal logs) |
| `make stop` | Graceful shutdown |
| `make test` | Run unit tests |
| `make lint` | Static code check (go vet) |
| `make clean` | Clean temporary files, caches, and binary (preserves data/) |
| `make rebuild` | Clean then build |
| `make restart` | Stop then start |

### 5. First Launch

On the first startup the system automatically creates the database schema and indexes, but does **not** insert any preset data. All test items, reference intervals, unit conversions, and calculation rules must be created or imported manually through the UI.

## Project Structure

```
LabTrace/
├── main.go                          # Entry point, route registration
├── Makefile                         # Build scripts (build/dev/run/stop/clean)
├── internal/
│   ├── config/config.go             # Configuration loading
│   ├── database/
│   │   ├── db.go                    # SQLite connection management
│   │   ├── migrations.go            # DDL migrations (15 tables)
│   │   └── seed.go                  # Seed data initialization
│   ├── models/
│   │   ├── models.go                # Data model definitions
│   │   └── imaging.go               # Imaging report data models
│   ├── handlers/                    # HTTP handlers
│   │   ├── ping.go                  # Health check
│   │   ├── subject.go               # Subject & hospital CRUD
│   │   ├── testitem.go              # Test items, aliases & reference intervals CRUD
│   │   ├── unit.go                  # Unit conversion CRUD
│   │   ├── calc.go                  # Calculated cross-check rules CRUD
│   │   ├── ocr.go                   # OCR upload & recognition
│   │   ├── ocr_quota.go             # OCR quota query/update + re-OCR
│   │   ├── ocr_wg.go                # OCR background goroutine wait group (graceful shutdown)
│   │   ├── report.go                # Lab report CRUD / verification / ingestion
│   │   ├── imaging.go               # Imaging report CRUD / OCR / mapping / ingestion
│   │   ├── rule.go                  # Hospital parsing rules & mapping templates CRUD
│   │   ├── helpers.go               # Common helper functions (param parsing, etc.)
│   │   ├── trend.go                 # Trend data queries
│   │   ├── dashboard.go             # Dashboard statistics & anomaly filtering
│   │   ├── batch_import.go          # Lab report batch import
│   │   ├── batch_import_imaging.go  # Imaging report batch import
│   │   ├── backup.go                # Backup export & import
│   │   └── audit.go                 # Audit log queries
│   ├── services/                    # Business logic layer
│   │   ├── ocr_service.go           # Alibaba Cloud OCR integration
│   │   ├── ocr_parser.go            # OCR result parsing
│   │   ├── ocr_mapping.go           # OCR field mapping
│   │   ├── ocr_quota.go             # OCR quota management
│   │   ├── imaging_ocr_service.go   # Imaging report OCR processing
│   │   ├── rule_service.go          # Parsing rule matching
│   │   ├── unit_service.go          # Unit conversion engine
│   │   ├── reference_service.go     # Dynamic reference range matching
│   │   ├── flag_service.go          # Flag calculation
│   │   ├── calc_service.go          # Calculated cross-check
│   │   ├── dict_service.go          # Data dictionary mapping
│   │   ├── testitem_service.go      # Test item service (Backfill, etc.)
│   │   ├── trend_service.go         # Trend data aggregation
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
│       ├── views/                   # 11 view components
│       │   ├── dashboard.js         # Dashboard
│       │   ├── ocr-import.js        # OCR upload & comparison view
│       │   ├── ocr-mapping-wizard.js# Lab report OCR mapping wizard
│       │   ├── imaging-mapping-wizard.js # Imaging report OCR mapping wizard
│       │   ├── batch_import.js      # Lab report batch import
│       │   ├── batch_import_imaging.js   # Imaging report batch import
│       │   ├── reports.js           # Ingested report management
│       │   ├── subjects.js          # Subject management
│       │   ├── test-items.js        # Test item library
│       │   ├── trend.js             # Trend analysis
│       │   └── settings.js          # Settings
│       └── components/              # 6 reusable components
│           ├── data-table.js        # Data table
│           ├── crud-modal.js        # CRUD modal
│           ├── search-dropdown.js   # Search dropdown
│           ├── subject-selector.js  # Subject selector
│           ├── sparkline.js         # Sparkline chart
│           └── drilldown-popup.js   # Drill-down popup
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
| OCR / Lab Reports | 12 | Upload / recognize / verify / ingest / re-OCR / blocks / mapping / image |
| OCR Quota | 2 | Query / update monthly usage |
| Imaging Reports | 15 | Upload / recognize / verify / ingest / re-OCR / mapping / templates |
| Batch Import (Lab) | 2 | Batch upload / batch confirm ingestion |
| Batch Import (Imaging) | 2 | Batch upload / batch confirm ingestion |
| Hospital Rules | 4 | CRUD |
| Hospital Mapping Templates | 4 | Lab / imaging template query & save |
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

8 main views:
1. **Dashboard** — Stat cards, anomaly filtering, summary table
2. **OCR Upload (Lab)** — File upload + immersive comparison view (synchronized original image + data grid) + mapping wizard
3. **OCR Upload (Imaging)** — Imaging report upload + OCR recognition + imaging mapping wizard
4. **Batch Import** — Multi-file bulk upload, OCR recognition and one-click ingestion (lab & imaging)
5. **Subject Management** — List + detail panel + auto age calculation
6. **Test Item Library** — Standard items + alias mapping + reference ranges + unit conversion + calculated rules
7. **Trend Analysis** — ECharts line charts + dynamic reference bands + drill-down
8. **Settings** — Key management, backup & restore, OCR quota, audit log

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