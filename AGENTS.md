# AGENTS.md — LabTrace

## Project overview

Personal longitudinal lab-test data management platform. Single Go binary serving a Vue 3 SPA frontend backed by SQLite. Medical data domain (blood tests, biochemistry panels), OCR ingestion via Alibaba Cloud, unit conversion, reference-range matching, trend charting, imaging report management.

## Essential commands

```bash
cp .env.example .env          # first-time setup (edit DB_KEY and optionally OCR creds)
CGO_ENABLED=1 go build -o labtrace .   # compile (CGO required for sqlite3)
./labtrace                    # start (auto-migrates + seeds DB on first run)
make build                    # compile with -ldflags "-s -w" and CGO_ENABLED=1
make dev                      # debug mode (GIN_MODE=debug, logs to dev.log)
make run                      # release mode (auto-builds if binary missing)
make stop                     # graceful shutdown via PID file
make clean                    # remove binary + caches, preserves data/
make test                     # run `go test -v ./...`
make lint                     # run `go vet ./...` (no external linter config)
make rebuild                  # clean + build
make restart                  # stop + run
make help                     # list all targets
```

- Default URL: `http://localhost:8080`; port from `PORT` in `.env` (default 8080)
- No frontend build step — Vue 3, Tailwind, ECharts, pdf.js loaded from CDN in `web/index.html`
- **CGO is mandatory** for `mattn/go-sqlite3`; cross-compilation requires a C cross-compiler

## Architecture

```
main.go              → entry, route registration (~50+ API routes), graceful shutdown
internal/
  config/            → .env parsing (godotenv), Config struct
  database/          → sqlite3 open/close (WAL mode, MaxOpenConns=2), idempotent DDL migrations (~16 tables), seed data
  models/            → domain structs + APIResponse helpers (Success/Error)
  handlers/          → 17 handler files — thin HTTP layer, call DB or services directly
  services/          → business logic (OCR, unit convert, ref matching, flag calc, backup, audit, calc validation, imaging OCR, dict mapping)
  middleware/         → CORS only
web/                 → static frontend (served directly, no bundler)
  index.html         → entry (loads everything via CDN <script> tags with ?v=N cache busting)
  js/views/          → 10 view components (dashboard, ocr-import, ocr-mapping-wizard, subjects, test-items, trend, settings, reports, batch_import, batch_import_imaging)
  js/components/     → 7 reusable components (data-table, crud-modal, search-dropdown, subject-selector, sparkline, sync-scroll, drilldown-popup)
  css/app.css        → design token system (CSS variables for colors, spacing, shadows)
data/                → runtime: labtrace.db, uploads/, backups/ (all gitignored)
```

**Key patterns:**
- Handlers call `database.DB` (package-level global `*sql.DB`) directly — no repository/DAO layer
- `models.Success(data)` / `models.Error(msg)` are the **only** response helpers; API always returns `{"code": 0|1, "message":"...", "data":...}`
- Raw SQL with `?` placeholders everywhere; no ORM
- SQLite WAL mode; `SetMaxOpenConns(2)` — single-writer concurrency, never open concurrent write transactions
- Migrations run idempotently on boot (`CREATE TABLE IF NOT EXISTS` + `ALTER TABLE` ignoring "column already exists" errors); seed data only inserts into empty tables
- Frontend: hash-based routing (`#dashboard`, `#ocr`, etc.), Vue 3 SFC-like components via CDN `<script>` tags, no webpack/vite/bundler
- Frontend API client: `web/js/api.js` wraps all fetch calls; add new endpoints there first

## Gotchas

- **`.env` is mandatory**: startup panics if `DB_KEY` is missing or not a 64-char hex string (32 bytes for AES-256-GCM)
- **OCR credentials are optional**: server starts without them, but OCR upload fails at runtime
- **`data/` directory is runtime state**: `make clean` preserves it; deleting it destroys all user data
- **No linter config, no CI** — `go build` and `make lint` (`go vet`) are the only verification steps
- **Only one test file exists**: `internal/services/ocr_parser_test.go` — run with `go test ./internal/services/`
- **Frontend routing is hash-based** — no server-side routing for the SPA
- **`GIN_MODE`** is set by Makefile targets (debug/release), not read from `.env`
- **`parseIntParam` helper** in `internal/handlers/subject.go` is unexported and not in a shared package — don't look for it in a `helpers` package
- **Binary named `labtrace`** is gitignored; Go module name is also `labtrace`
- **`go.sum`** has indirect deps pulled in by Gin's transitive deps (sonic, quic-go, base64x, etc.) — don't prune them
- **CGO_ENABLED=1 is required** — sqlite3 driver (`mattn/go-sqlite3`) uses CGO; `make build` handles this, bare `go build` does not

## Relevant docs

- `README.md` — full project overview, API table, architecture diagram
- `docs/requirements/` — PRD documents + UI mockup images
- `docs/bugfix/` — bug fix documentation
- `example/` — sample PDF and OCR result
- `opencode.json` — code-context MCP semantic search config
- `CODE_WIKI.md` — in-depth design notes (884 lines)
