# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

LabTrace (溯源健康) — personal longitudinal lab-test data management platform. Single Go binary serving a Vue 3 SPA frontend backed by SQLite. Users batch-digitize lab reports via Alibaba Cloud OCR, normalize units, match reference intervals, and visualize health trends over time. Chinese UI throughout.

## Commands

```bash
cp .env.example .env          # first-time setup (must set DB_KEY to 64-char hex)
go build -o labtrace .        # compile
make build                    # compile with -ldflags "-s -w"
make dev                      # debug mode (GIN_MODE=debug, logs to dev.log)
make run                      # release mode
make stop                     # graceful shutdown via PID file
make clean                    # remove binary + caches, preserves data/
go test ./internal/services/  # run tests (only ocr_parser_test.go exists)
```

Default URL: `http://localhost:8080` (port configurable via `PORT` in `.env`).

## Architecture

```
main.go              → entry, route registration (all /api/v1/*), graceful shutdown
internal/
  config/            → .env parsing via godotenv, Config struct
  database/          → sqlite3 open/close, idempotent DDL migrations, seed data
  models/            → domain structs + APIResponse helpers (Success/Error)
  handlers/          → 13 handler files — thin HTTP layer, call DB or services directly
  services/          → business logic (OCR, unit convert, ref matching, flag calc, backup, audit)
  middleware/         → CORS only
web/                 → static frontend (CDN-loaded Vue 3 + Tailwind + ECharts, no build step)
  js/views/          → 6 view components (dashboard, ocr-import, subjects, test-items, trend, settings)
  js/components/     → 7 reusable components (data-table, crud-modal, search-dropdown, etc.)
data/                → runtime state: labtrace.db, uploads/ — gitignored, never delete carelessly
```

## Key Patterns

- **No repository/DAO layer**: handlers access `database.DB` (package-level global `*sql.DB`) directly
- **Raw SQL everywhere**: `?` placeholders, no ORM
- **Uniform API responses**: `models.Success(data)` / `models.Error(msg)` → `{"code": 0|1, "message": "...", "data": ...}`
- **SQLite WAL mode**: `SetMaxOpenConns(2)` — single-writer concurrency, never open concurrent write transactions
- **Idempotent migrations**: run on boot via `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE` ignoring "column already exists"
- **Seed data**: only inserts into empty tables (checked via `SELECT COUNT(*)`)
- **Frontend**: hash-based routing (`#dashboard`, `#ocr`, etc.), Vue 3 components via CDN `<script>` tags with cache-busting `?v=N` params — no webpack/vite/bundler
- **Frontend API client**: `web/js/api.js` wraps all fetch calls; add new endpoints there first
- **UI design system**: CSS variables in `web/css/app.css` define a design token system (colors, spacing, shadows); components in `web/js/components/data-table.js`, `crud-modal.js` etc. implement a shared visual style

## Gotchas

- **`DB_KEY` is mandatory**: server panics at startup without it. Must be 64-char hex (32 bytes for AES-256-GCM)
- **OCR credentials optional**: server starts without them, OCR upload fails at runtime
- **`data/` directory is runtime state**: `make clean` preserves it; deleting it destroys all user data
- **No linter config, no CI**: `go build` is the only verification step
- **`parseIntParam` helper** in `internal/handlers/subject.go` is unexported and not in a shared package
- **Binary named `labtrace`** is gitignored; Go module name is also `labtrace`
- **`GIN_MODE`** set by Makefile targets, not read from `.env`
- **`go.sum` indirect deps**: Gin pulls in sonic, quic-go, base64x etc. — don't prune them

## API Routes

All routes are under `/api/v1`. Key groups: `/subjects`, `/hospitals`, `/test-items`, `/test-items/:id/aliases`, `/test-items/:id/reference-intervals`, `/unit-conversions`, `/calculation-rules`, `/ocr/upload`, `/reports`, `/reports/:id/confirm`, `/reports/:id/import`, `/reports/:id/re-ocr`, `/hospital-rules`, `/trend/data`, `/dashboard/summary`, `/dashboard/anomalies`, `/backups`, `/audit-logs`. Full route list in `main.go` lines 51-137.

## Relevant Docs

- `docs/requirements/` — PRD documents + UI mockup images
- `docs/bugfix/` — bug fix documentation
- `example/` — sample PDF and OCR result
