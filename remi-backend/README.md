# remi-backend

REST API that ingests LangChain and OTLP events, validates them, publishes to Kafka, and serves dashboard queries to the frontend.

---

## What it does

- Accepts event batches from the remi-langchain SDK (`POST /api/v1/events/batch`)
- Accepts OTLP span payloads from the OTel Collector or OpenRouter webhooks (`POST /api/v1/traces`)
- Validates all payloads with Zod schemas and enforces a 256 KB per-event data limit
- Publishes validated events to Kafka (`remi-events`, `remi-sessions` topics)
- Serves paginated reads of sessions and events from Postgres, with Redis caching
- Emits its own OTel traces to the collector

---

## Prerequisites

| Tool       | Version   |
|------------|-----------|
| Bun        | >= 1.0    |
| Node.js    | >= 20     |
| Postgres   | 16        |
| Kafka      | 7.5 (Confluent) |
| Redis      | 7         |

For local development the full infra stack is provided by `docker-compose.yml` in the repo root.

---

## Quick start (local, outside Docker)

```bash
cd remi-backend
bun install

# Create a .env file (see environment variables section below)
cp ../.env.example .env

bun run dev
# Server listens on http://localhost:3100
```

The server starts immediately and returns 503 on data routes until Kafka/Postgres/Redis connect. Health check is always available:

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
| `KAFKA_BROKERS`            | `kafka:29092`      | Comma-separated broker list                                   |
| `KAFKA_EVENT_TOPIC`        | `remi-events`      | Topic for event messages                                      |
| `KAFKA_SESSION_TOPIC`      | `remi-sessions`    | Topic for session messages                                    |
| `KAFKA_MAX_MESSAGE_BYTES`  | `286720`           | Max Kafka message size (280 KB). Must match broker config.    |
| `REDIS_HOST`               | `redis-cache`      | Redis hostname                                                |
| `REDIS_PORT`               | `6379`             | Redis port                                                    |
| `REDIS_PASSWORD`           | `redis_password`   | Redis auth password                                           |
| `REDIS_DB`                 | `0`                | Redis database index                                          |
| `REDIS_MAX_VALUE_BYTES`    | `5242880`          | Max bytes per Redis cached value (5 MB)                       |
| `MAX_EVENT_DATA_BYTES`     | `262144`           | Max bytes for `event.data` JSON payload (256 KB)              |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4318` | OTel collector endpoint                |
| `OTEL_SERVICE_NAME`        | `remi-backend`     | Service name in traces                                        |
| `OPENAI_API_KEY`           | _(none)_           | Optional. Used by the span-analysis (LLM-as-judge) feature.  |
| `OPENAI_BASE_URL`          | `https://api.openai.com/v1` | Base URL for span analysis LLM calls           |
| `OPENAI_MODEL`             | `gpt-4o-mini`      | Model for span analysis                                       |

---

## Key API endpoints

| Method | Path                           | Auth                          | Description                        |
|--------|--------------------------------|-------------------------------|------------------------------------|
| GET    | `/health`                      | None                          | Service health check               |
| POST   | `/api/v1/events/batch`         | Bearer API key                | Ingest batch of LangChain events   |
| GET    | `/api/v1/events`               | Bearer API key                | Paginated event list               |
| GET    | `/api/v1/sessions`             | Bearer API key                | Paginated session list             |
| GET    | `/api/v1/sessions/:id/metrics` | Bearer API key                | Per-session metrics                |
| POST   | `/api/v1/traces`               | Bearer API key or webhook secret | OTLP span ingest               |
| GET    | `/api/v1/analytics`            | Bearer API key                | Cross-session rollup data          |

All data endpoints require `Authorization: Bearer <REMI_API_KEY>`.

---

## How it connects to other components

```
remi-langchain SDK / examples/otel_setup.py
        │ HTTP POST
        ▼
remi-backend
        │ Kafka publish (remi-events, remi-sessions)
        ├──────────────────────────────▶ remi-worker (consumes, writes to Postgres)
        │ Redis cache invalidation
        └──────────────────────────────▶ Redis
                                         Postgres (direct writes for OTLP V2 path)
                                         ◀── remi (frontend) reads via GET endpoints
```

---

## Important constraints

- `REMI_API_KEY` is read at module load time — the process exits if it is not set.
- `src/telemetry.ts` must be the first import in `src/index.ts` — it patches Express/http before anything else loads.
- Kafka messages exceeding `KAFKA_MAX_MESSAGE_BYTES` are rejected before publishing; the backend returns a 413 error.
- The backend returns 207 (not 500) when Kafka is unavailable — events accepted but not queued.
