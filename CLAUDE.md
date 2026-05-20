# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Remi is an LLM observability platform that collects, processes, and visualizes OTLP traces from LangChain agents and any OpenTelemetry-instrumented application. The repo is a monorepo with three independent packages plus shared infra config.

## Package Map

| Directory | Language | Purpose |
|-----------|----------|---------|
| `remi-backend/` | TypeScript / Bun / Express 5 | REST API — ingest OTLP traces, serve dashboard queries |
| `remi/remi/` | React 19 / Vite / TailwindCSS | Observability dashboard UI |
| `examples/` | Python / LangChain | Demo scripts exercising the full pipeline |
| `remi-marketing/` | React / Tailwind | Marketing site (independent) |

There is no shared build system — each package is built and tested independently.

## Infrastructure (docker-compose.yml)

All services run in Podman/Docker:
- **Postgres 16** (primary `:5432`) — schema initialized from `scripts/init-db.sql`
- **Redis 7** — LRU cache, max 512MB, password `redis_password`
- **Backend** → port 3100, mounts `remi-backend/src` live
- **Frontend** → port 3000
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
POST /api/v1/traces          ← OpenTelemetry collector / OpenRouter webhook
        │
        ▼
remi-backend (Express)
  • Validates with Zod schemas
  • Normalizes OTLP spans → internal event format (otlp.service.ts)
  • Resolves org_id / agent_id from request context
  • Writes directly to Postgres (sessions_v2, spans_v2, usage_facts_v2, cost_facts_v2)
  • Invalidates Redis cache keys
        │
        ▼
Postgres → Frontend reads via GET /api/v1/sessions, /api/v1/events
```

## Backend Architecture (`remi-backend/src/`)

**Service initialization is deferred** — services (Redis, DB) are initialized after the HTTP server starts listening. Routes receive services via getter closures (`() => databaseService`) so they always get the current value even if initialization is still pending. A 503 is returned if the DB is not yet ready.

Key files:
- [src/index.ts](remi-backend/src/index.ts) — app bootstrap, service init, graceful shutdown
- [src/services/otlp.service.ts](remi-backend/src/services/otlp.service.ts) — normalizes OTLP spans to internal format; extracts provider aliases and trace/session correlations
- [src/routes/events.routes.ts](remi-backend/src/routes/events.routes.ts) — span query endpoints; Redis cache with scope-keyed invalidation
- [src/routes/traces.routes.ts](remi-backend/src/routes/traces.routes.ts) — OTLP ingest; handles OpenRouter webhook auth and API-key auth
- [src/middleware/auth.ts](remi-backend/src/middleware/auth.ts) — `requireApiKey` reads `REMI_API_KEY` at module load time
- [src/utils/org-id.ts](remi-backend/src/utils/org-id.ts) — org_id resolution precedence (body → header → existing session)

**V2 OTLP schema:** The DB uses a single schema (`sessions_v2`, `traces_v2`, `spans_v2`, `usage_facts_v2`, `cost_facts_v2`, `session_rollups_v2`) for all ingest. The `init-db.sql` is idempotent.

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

- **Telemetry must be initialized first.** `telemetry.ts` in the backend patches Express/http and must be the first import in `src/index.ts`.
- **`REMI_API_KEY` is read at module load time** in `auth.ts` — the process exits if it is not set.
