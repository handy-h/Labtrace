# AGENTS.md — LabTrace

## Project overview

Personal longitudinal lab-test data management platform. Single Go binary serving a Vue 3 SPA frontend backed by SQLite. Medical data domain (blood tests, biochemistry panels), OCR ingestion via Alibaba Cloud, unit conversion, reference-range matching, trend charting.

## Essential commands

```bash
cp .env.example .env          # first-time setup (edit DB_KEY and optionally OCR creds)
go build -o labtrace .        # compile single binary
./labtrace                    # start (auto-migrates + seeds DB on first run)
make dev                      # debug mode, logs to dev.log
make run                      # release mode
make stop                     # graceful shutdown via PID file
make clean                    # remove binary + caches, preserves data/
make help                     # list all targets
```

- Default URL: `http://localhost:8080`
- Port from `PORT` in `.env` (default 8080)
- No frontend build step — Vue 3, Tailwind, ECharts loaded from CDN in `web/index.html`

## Architecture

```
main.go              → entry, route registration, graceful shutdown
internal/
  config/            → .env parsing (godotenv), Config struct
  database/          → sqlite3 open, DDL migrations (11 tables), seed data
  models/            → structs + APIResponse helpers (Success/Error)
  handlers/          → HTTP handlers (thin: DB access + response JSON)
  services/          → business logic (OCR, unit convert, ref matching, audit, backup)
  middleware/         → CORS only
web/                 → static frontend (served directly, no bundler)
data/                → runtime: labtrace.db, uploads/, backups/ (all gitignored)
```

**Key patterns:**
- Handlers call `database.DB` directly — no repository/DAO layer
- `models.Success(data)` / `models.Error(msg)` are the **only** response helpers; API always returns `{"code": 0|1, "message":"...", "data":...}`
- Raw SQL with `?` placeholders everywhere; no ORM
- SQLite WAL mode; `SetMaxOpenConns(1)` means single-writer concurrency — never open concurrent write transactions
- Migrations run idempotently on boot (`CREATE TABLE IF NOT EXISTS`); seed data only inserts into empty tables

## Gotchas

- **`.env` is mandatory**: startup panics if `DB_KEY` is missing or not a 64-char hex string
- **No tests exist** — zero `*_test.go` files, no test infrastructure, no CI workflows
- **No codegen, no linter config** — `go build` is the only verification
- **`data/` directory is runtime state**: `make clean` preserves it; never delete it without understanding impact (loss of all user data)
- **OCR credentials are optional**: server starts without them, but OCR upload will fail at runtime
- **Frontend routing is hash-based** (`#dashboard`, `#ocr`, etc.) — no server-side routing for the SPA
- **`GIN_MODE`** (set by Makefile targets) controls Gin log verbosity; not read from `.env`
- **`parseIntParam` helper** in `internal/handlers/subject.go` exists but is unexported and not in a shared package
- **Binary named `labtrace`** is gitignored; Go module name is also `labtrace`
- **`go.sum`** has indirect dependencies pulled in by Gin's transitive deps (base64x, sonic, quic-go, etc.) — don't prune them

## Relevant docs

- `README.md` — full project overview, API table, architecture diagram
- `docs/requirements/` — PRD documents + UI mockup images
- `opencode.json` — code-context MCP semantic search config (Zilliz-backed)
