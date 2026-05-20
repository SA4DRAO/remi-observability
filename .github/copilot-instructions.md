# Remi LLM Observability Platform

Remi is a monorepo platform for observing and analyzing LLM usage. It captures LangChain lifecycle events, routes them through Kafka, stores metrics in PostgreSQL, and displays them in a React dashboard.

## Tech Stack

| Package | Runtime | Key Libraries |
|---------|---------|---------------|
| `remi/remi` | Browser | React 19, Vite, TanStack Query v5, Radix UI, TailwindCSS, Zod, Sentry |
| `remi-backend` | Node.js 20 | Express 5, TypeScript, pg, kafkajs, Redis |
| `remi-langchain` | Python 3.10+ | langchain-core, httpx, mypy, ruff, black, pytest |
| `remi-worker` | Python 3.10+ | aiokafka, asyncpg, mypy, pytest-asyncio |

## Architecture

- **Frontend** (`remi/remi`): React SPA polling session/event data via TanStack Query hooks
- **Backend** (`remi-backend`): Express 5 REST API ingesting events from the SDK and serving the dashboard
- **SDK** (`remi-langchain`): Python library that hooks into LangChain via `BaseCallbackHandler` and POSTs events to the backend
- **Worker** (`remi-worker`): Asyncio Kafka consumer that batch-flushes events and computes session metrics in PostgreSQL

## Agents

- **Remi Platform Coordinator** (`.github/agents/remi-coordinator.agent.md`) — Decomposes cross-package tasks and delegates to the four subagents
- **React Frontend** (`.github/agents/react.agent.md`) — Builds dashboard components, TanStack Query hooks, and Zod-validated API types
- **Express Backend** (`.github/agents/express.agent.md`) — Implements route factories, service classes, and Zod middleware
- **LangChain Observability SDK** (`.github/agents/langchain.agent.md`) — Maintains the Python callback handler and httpx transport
- **Async Kafka Worker** (`.github/agents/aiokafka.agent.md`) — Maintains batch consumer, asyncpg DB layer, and metrics computation

## Build & Test Commands

| Package | Dev | Test | Lint / Type-check |
|---------|-----|------|-------------------|
| `remi/remi` | `npm run dev` | — | `npm run lint && npm run type-check` |
| `remi-backend` | `npm run dev` | `npm test` | `npm run lint && npm run type-check` |
| `remi-langchain` | — | `make test` | `make lint && make typecheck` |
| `remi-worker` | `python -m remi_worker` | `pytest tests/` | `make lint && make typecheck` (see pyproject.toml) |

Python dev setup: `pip install -e .[dev]` inside each Python package directory.

## Local Development

Infrastructure (Arch Linux — uses **Podman**, not Docker):
```bash
# Start all infrastructure from workspace root
podman-compose up -d
```

| Service | Port | Notes |
|---------|------|-------|
| remi-frontend | 3000 | React/Vite SPA |
| remi-backend | 3100 | Express API; auth via `REMI_API_KEY` header |
| postgres-primary | 5432 | Init schema: `scripts/init-db.sql` |
| postgres-replica | 5433 | Read replica |
| kafka | 9092 / 29092 | Topics: `remi-events`, `remi-sessions` |
| redis-cache | 6379 | 30 s event-query TTL |

Environment variables: copy [.env.example](.env.example) → `.env`. The `REMI_API_KEY` in `.env` must match `REMI_API_KEY` used by the SDK.

## Key Conventions

- **Frontend**: server state via TanStack Query only — no `useState` for remote data; invalidate queries after mutations
- **Backend**: every route module exports `create*Routes(getDatabase, logger)` — no module-level singletons
- **Python**: all functions fully annotated (`disallow_untyped_defs = true`); ruff + black enforced at line-length 100
- **Worker**: `KafkaConsumer` and `DatabasePool` receive `Config` via constructor — no global config objects
- **Cross-package**: the JSON event shape in `remi-langchain` must stay in sync with the express ingest route and worker consumer schemas
- **Response shape**: all backend JSON responses use `{ success: true, data: T }` or `{ success: false, error: string }` — never mix these
- **Deduplication**: events are deduplicated by `(session_id, seq)` in PostgreSQL; events without `seq` are not deduplicated

## Database Schema (PostgreSQL)

Key tables (defined in `scripts/init-db.sql`):
- **`events`** — `(id, session_id, event_type, event_data JSONB, seq, org_id, agent_id, created_at)`
- **`sessions`** — `(id, session_id UNIQUE, name, metadata JSONB, org_id, agent_id, created_at, updated_at)`
- **`session_metrics`** — pre-aggregated per-session stats; updated via `jsonb_add_counts()` delta upserts
- **`model_pricing`** — cost rates per model; refreshed every 10 min by the worker

Unique index on `events(session_id, seq) WHERE seq IS NOT NULL` enforces deduplication on replay.
