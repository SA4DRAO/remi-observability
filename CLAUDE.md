# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Remi is an LLM observability platform that collects, processes, and visualizes events from LangChain agents and OTLP-instrumented applications. The repo is a monorepo with four independent packages plus shared infra config.

## Package Map

| Directory | Language | Purpose |
|-----------|----------|---------|
| `remi-backend/` | TypeScript / Bun / Express 5 | REST API — ingest events, serve dashboard queries |
| `remi/remi/` | React 19 / Vite / TailwindCSS | Observability dashboard UI |
| `remi-worker/` | Python 3.9+ / asyncio | Kafka consumer — batch-flush events to Postgres |
| `examples/` | Python / LangChain | Demo scripts exercising the full pipeline |
| `remi-marketing/` | React / Tailwind | Marketing site (independent) |

There is no shared build system — each package is built and tested independently.

## Infrastructure (docker-compose.yml)

All services run in Podman/Docker:
- **Postgres 16** (primary `:5432`, replica `:5433`) — schema initialized from `scripts/init-db.sql`
- **Kafka** (KRaft, no Zookeeper) — topics `remi-events` and `remi-sessions`, Kafka message cap **280 KB**
- **Redis 7** — LRU cache, max 512MB, password `redis_password`
- **Backend** → port 3100, mounts `remi-backend/src` live
- **Frontend** → port 3000
- **Worker** → 256MB RAM limit
- **Jaeger** → port 16686 (tracing UI)
- **OTel Collector** → port 4318 (OTLP HTTP)

Start everything: `docker-compose up -d` (or `podman-compose up -d`).

## Commands

### Backend (`remi-backend/`)
```bash
bun install
bun run dev          # watch mode
bun run type-check   # tsc --noEmit
bun run lint         # eslint src
bun run lint:fix
bun test             # runs all test/*.test.js files
# Run a single test file:
bun test test/validation.test.js
```

### Frontend (`remi/remi/`)
```bash
bun install
bun run dev          # Vite dev server (hot reload)
bun run type-check
bun run lint
bun run build
```

### Worker (`remi-worker/`)
```bash
pip install -e ".[dev]"
python -m remi_worker          # run the worker directly
pytest                         # run all tests
pytest tests/test_consumer.py  # run a single test file
mypy src/                      # type checking
```

### Examples (`examples/`)
```bash
cd examples && python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python simple_chain_agent.py
```

## Architecture: Event Flow

```
LangChain agent / OTLP source
        │
        ▼
POST /api/v1/events/batch    ← remi-langchain SDK (HTTP)
POST /api/v1/traces          ← OpenTelemetry collector / OpenRouter webhook
        │
        ▼
remi-backend (Express)
  • Validates with Zod schemas
  • Normalizes OTLP spans → internal event format (otlp.service.ts)
  • Resolves org_id / agent_id from request context
  • Publishes to Kafka topic "remi-events" (KafkaService)
  • Invalidates Redis cache keys
        │
        ▼
Kafka topic: remi-events / remi-sessions
        │
        ▼
remi-worker (Python asyncio, AIOKafkaConsumer)
  • Batches messages (size or timeout trigger)
  • Validates each event (models.py)
  • Detects _seq gaps (sequence gap = dropped events)
  • Deduplicates via (session_id, seq) ON CONFLICT DO NOTHING
  • Writes events → Postgres events table
  • Upserts session_metrics via compute_metrics_delta()
  • Commits Kafka offset only after successful DB write
  • Refreshes model pricing from DB every 10 minutes
        │
        ▼
Postgres → Frontend reads via GET /api/v1/sessions, /api/v1/events
```

## Backend Architecture (`remi-backend/src/`)

**Service initialization is deferred** — services (Kafka, Redis, DB) are initialized after the HTTP server starts listening. Routes receive services via getter closures (`() => databaseService`) so they always get the current value even if initialization is still pending. A 503 is returned if the DB is not yet ready.

Key files:
- [src/index.ts](remi-backend/src/index.ts) — app bootstrap, service init, graceful shutdown
- [src/services/kafka.service.ts](remi-backend/src/services/kafka.service.ts) — producer only; validates message size before publish
- [src/services/otlp.service.ts](remi-backend/src/services/otlp.service.ts) — normalizes OTLP spans to internal format; extracts provider aliases and trace/session correlations
- [src/routes/events.routes.ts](remi-backend/src/routes/events.routes.ts) — batch ingest + query endpoints; Redis cache with scope-keyed invalidation
- [src/routes/traces.routes.ts](remi-backend/src/routes/traces.routes.ts) — OTLP ingest; handles OpenRouter webhook auth and API-key auth
- [src/middleware/auth.ts](remi-backend/src/middleware/auth.ts) — `requireApiKey` reads `REMI_API_KEY` at module load time
- [src/utils/org-id.ts](remi-backend/src/utils/org-id.ts) — org_id resolution precedence (body → header → existing session)

**Dual schema:** The DB has a legacy flat schema (`events`, `sessions`, `session_metrics`) for the SDK path, and a V2 OTLP schema (`sessions_v2`, `traces_v2`, `spans_v2`, `usage_facts_v2`, `cost_facts_v2`, `session_rollups_v2`) for the OTLP/traces path. Both coexist; the `init-db.sql` is idempotent.

## Worker Architecture (`remi-worker/src/remi_worker/`)

- [consumer.py](remi-worker/src/remi_worker/consumer.py) — `KafkaConsumer`: batch loop, sequence gap detection, `_flush_batch` with exponential backoff (3 retries, 0.5s base)
- [metrics.py](remi-worker/src/remi_worker/metrics.py) — `compute_metrics_delta`: additive aggregation from OTLP span events; cost calculation from `model_pricing` table
- [db.py](remi-worker/src/remi_worker/db.py) — `DatabasePool`: asyncpg connection pool, `store_events_batch` returns only inserted rows (dedup guard)
- [models.py](remi-worker/src/remi_worker/models.py) — `validate_kafka_event`: schema validation; invalid events go to dead-letter log, not DB

**Deduplication:** Events with `_seq` use `ON CONFLICT DO NOTHING` on `(session_id, seq)` unique index. The worker only passes actually-inserted rows to `compute_metrics_delta` to prevent double-counting on replay.

## Frontend Architecture (`remi/remi/src/`)

- [hooks/](remi/remi/src/hooks/) — TanStack Query hooks: `useSessions`, `usePaginatedEvents`, `useSessionMetrics`, `useAnalytics`
- [utils/api-client.ts](remi/remi/src/utils/api-client.ts) — axios wrapper; reads `VITE_API_URL` and `VITE_API_KEY` from env
- [components/Pages/](remi/remi/src/components/Pages/) — three main views: `SessionsPage`, `SessionDetailPage`, `AnalyticsPage`
- [components/ui/](remi/remi/src/components/ui/) — shadcn/ui component wrappers (Radix UI + Tailwind)

`VITE_*` env vars are baked into the static bundle at build time via Vite. In Docker, they are passed as build args.

## Authentication

All data endpoints require `Authorization: Bearer <REMI_API_KEY>`. Set `REMI_API_KEY` in environment (both backend and frontend/examples).

The traces endpoint also accepts a webhook secret via `REMI_WEBHOOK_SECRET` (for OpenRouter integration).

## Key Constraints

- **Kafka message limit: 280 KB** (`KAFKA_MAX_MESSAGE_BYTES=286720`). The backend validates each message before publishing and throws if exceeded. `MAX_EVENT_DATA_BYTES=262144` (256 KB) guards individual event payloads at the ingest layer.
- **Worker Kafka offset is not committed on flush failure.** Messages will be replayed on restart. Sequenced events (`_seq`) are safe to replay; unsequenced events may produce duplicate DB rows.
- **Telemetry must be initialized first.** `telemetry.ts` in the backend patches Express/http and must be the first import in `src/index.ts`.
- **`REMI_API_KEY` is read at module load time** in `auth.ts` — the process exits if it is not set.
