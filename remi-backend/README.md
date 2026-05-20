# remi-backend

Express 5 REST API that ingests OpenTelemetry spans, stores them in Postgres, and serves dashboard queries to the frontend.

---

## What it does

- Accepts OTLP span payloads from the OTel Collector or OpenRouter webhooks (`POST /api/v1/traces`)
- Normalizes spans to an internal format, resolves session/org/agent identity, writes directly to Postgres
- Serves paginated reads of sessions, spans, and analytics from Postgres, with Redis caching
- Emits its own OTel traces to the collector for self-observability

---

## Prerequisites

| Tool       | Version   |
|------------|-----------|
| Bun        | >= 1.0    |
| Postgres   | 16        |
| Redis      | 7         |

For local development the full infra stack is provided by `docker-compose.yml` in the repo root.

---

## Quick start (local, outside Docker)

```bash
cd remi-backend
bun install

cp ../.env.example .env
# Edit .env — set REMI_API_KEY and DB/Redis connection vars

bun run dev
# Server listens on http://localhost:3100
```

The server starts immediately and returns 503 on data routes until Postgres/Redis connect. Health check is always available:

```bash
curl http://localhost:3100/health
```

---

## Development commands

```bash
bun run dev          # watch mode — restarts on src/ changes
bun run build        # tsc → dist/
bun run start        # run built dist/index.js
bun run type-check   # tsc --noEmit (strict mode)
bun run lint         # eslint src/
bun run lint:fix     # eslint src/ --fix
bun run format       # prettier --write src/**/*.ts
bun test             # run all tests in test/
bun test test/validation.test.js   # single test file
```

> Tests run against `dist/`. Run `bun run build` first if you changed `src/types/validation.ts` or any module imported by the test files.

---

## Environment variables

| Variable                   | Default            | Purpose                                                       |
|----------------------------|--------------------|---------------------------------------------------------------|
| `REMI_API_KEY`             | _(required)_       | Bearer token checked on every data endpoint. Process exits if unset. |
| `REMI_WEBHOOK_SECRET`      | _(none)_           | Optional. Enables OpenRouter webhook auth on `/api/v1/traces`. |
| `PORT`                     | `3100`             | HTTP listen port                                              |
| `HOST`                     | `0.0.0.0`          | HTTP listen address                                           |
| `NODE_ENV`                 | `development`      | `development` / `production`                                  |
| `LOG_LEVEL`                | `INFO`             | Logging verbosity                                             |
| `CORS_ORIGINS`             | `http://localhost:3000,...` | Comma-separated allowed origins               |
| `DB_HOST`                  | `postgres-primary` | Postgres write host                                           |
| `DB_PORT`                  | `5432`             | Postgres write port                                           |
| `DB_USER`                  | `remi_user`        | Postgres user                                                 |
| `DB_PASSWORD`              | `remi_password`    | Postgres password                                             |
| `DB_NAME`                  | `remi_db`          | Postgres database name                                        |
| `DB_READ_HOST`             | `postgres-primary` | Read replica host (set to primary for single-node dev)        |
| `DB_READ_PORT`             | `5432`             | Read replica port                                             |
| `DB_POOL_MIN`              | `5`                | Min connections in pool                                       |
| `DB_POOL_MAX`              | `20`               | Max connections in pool                                       |
| `DB_CONNECTION_TIMEOUT_MS` | `5000`             | Connection acquire timeout                                    |
| `DB_QUERY_TIMEOUT_MS`      | `30000`            | Query execution timeout                                       |
| `REDIS_HOST`               | `redis-cache`      | Redis hostname                                                |
| `REDIS_PORT`               | `6379`             | Redis port                                                    |
| `REDIS_PASSWORD`           | `redis_password`   | Redis auth password                                           |
| `REDIS_DB`                 | `0`                | Redis database index                                          |
| `REDIS_MAX_VALUE_BYTES`    | `5242880`          | Max bytes per Redis cached value (5 MB)                       |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4318` | OTel collector endpoint                |
| `OTEL_SERVICE_NAME`        | `remi-backend`     | Service name in traces                                        |
| `OPENAI_API_KEY`           | _(none)_           | Optional. Used by the span-analysis (LLM-as-judge) feature.  |
| `OPENAI_BASE_URL`          | `https://api.openai.com/v1` | Base URL for span analysis LLM calls           |
| `OPENAI_MODEL`             | `gpt-4o-mini`      | Model for span analysis                                       |

---

## Key API endpoints

| Method | Path                                  | Auth                             | Description                        |
|--------|---------------------------------------|----------------------------------|------------------------------------|
| GET    | `/health`                             | None                             | Service health check               |
| POST   | `/api/v1/traces`                      | Bearer API key or webhook secret | OTLP span ingest                   |
| GET    | `/api/v1/sessions`                    | Bearer API key                   | Paginated session list             |
| GET    | `/api/v1/sessions/:id`                | Bearer API key                   | Session detail                     |
| GET    | `/api/v1/sessions/:id/metrics`        | Bearer API key                   | Per-session metrics                |
| POST   | `/api/v1/sessions/:id/analyze-span`   | Bearer API key                   | LLM-as-judge span analysis         |
| GET    | `/api/v1/events/sessions/:id/events`  | Bearer API key                   | Spans for a session                |
| GET    | `/api/v1/events/spans/:id/attributes` | Bearer API key                   | Span attributes                    |
| GET    | `/api/v1/analytics`                   | Bearer API key                   | Cross-session rollup data          |

All data endpoints require `Authorization: Bearer <REMI_API_KEY>`.

---

## How it connects to other components

```
OTel Collector / OpenRouter webhook
        │ POST /api/v1/traces
        ▼
remi-backend
        │ direct write (asyncpg)
        ├──────────────────────────────▶ Postgres
        │ cache invalidation
        └──────────────────────────────▶ Redis
                                         ◀── remi (frontend) reads via GET endpoints
```

---

## Important constraints

- `REMI_API_KEY` is read at module load time — the process exits if it is not set.
- `src/telemetry.ts` must be the first import in `src/index.ts` — it patches Express/http before anything else loads.
