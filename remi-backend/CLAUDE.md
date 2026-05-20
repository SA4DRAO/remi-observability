# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install

bun run dev          # watch mode via bun --watch
bun run type-check   # tsc --noEmit (strict mode)
bun run lint         # eslint src/
bun run lint:fix
bun run format       # prettier --write

# Tests (uses Node test runner, NOT bun test)
bun test             # all tests in test/
bun test test/validation.test.js   # single test file

# Tests require a built dist/ first
bun run build        # tsc → dist/
```

**Tests run against `dist/`**, not source. Always `bun run build` before running tests after changing `src/types/validation.ts` or any module imported by tests.

## Architecture

### Service Initialization Pattern

Services (Kafka, Redis, DB) are initialized **after** the HTTP server starts. Route factories receive getter closures (`() => databaseService`) so they always capture the current value. Routes return 503 when a required service is still `null`. This means the server is immediately available for health checks even if Kafka/DB is slow to connect.

### Request Flow

```
HTTP request
  → requireApiKey (auth.ts — reads REMI_API_KEY at module load)
  → validateBody (Zod schema)
  → route handler
      → resolveOrgId / resolveRequestScope (utils/)
      → Redis cache check (getJSON)
      → DB query (queryRead for reads, queryWrite for writes)
      → Redis invalidation on writes
      → Kafka publishEventBatch
  → error-handler middleware
```

### Key Modules

**`src/services/otlp.service.ts`** — Normalizes raw OTLP payloads into the internal event format. Extracts provider aliases (`request_id`, `response_id`, `conversation_id`, `run_id`) for trace-to-session correlation. Reads span attributes using multiple OTel semantic convention namespaces (`gen_ai.*`, `llm.*`, legacy) ordered by preference.

**`src/services/kafka.service.ts`** — Producer only. Validates each message against `KAFKA_MAX_MESSAGE_BYTES` (default 280 KB) before publishing. Injects W3C trace context (`traceparent`/`tracestate`) as Kafka headers so the worker can create child spans.

**`src/routes/events.routes.ts`** — `POST /batch` ingest and `GET` query endpoints. Cache keys are scope-segmented (`org:X:agent:Y`) so filtering by org/agent works correctly. Returns 207 when Kafka is unavailable (events not queued).

**`src/routes/traces.routes.ts`** — OTLP ingest at `/api/v1/traces`. Accepts two auth methods: `REMI_WEBHOOK_SECRET` (OpenRouter webhook) or `REMI_API_KEY` (SDK). Handles `X-Test-Connection: true` probe from OpenRouter before auth.

**`src/utils/org-id.ts`** — org_id resolution precedence: body field → `X-Org-Id` header → existing session value. Rejects conflicts.

**`src/utils/request-scope.ts`** — Parses `org_id`/`agent_id` filters from query params or headers for list/read endpoints.

### Validation

All Zod schemas live in `src/types/validation.ts`. Key constraints:
- Batch: 1–1000 events
- Event `data`: max 100 keys, max 256 KB JSON (`MAX_EVENT_DATA_BYTES` env var)
- `_seq`: non-negative integer — used for deduplication and gap detection
- `org_id` / `agent_id`: trimmed, 1–255 chars

### Dual Database Schema

The `scripts/init-db.sql` (run once on Postgres init) creates two parallel schemas:
- **Legacy** (`events`, `sessions`, `session_metrics`) — written by `POST /api/v1/events/batch` via Kafka → worker
- **V2 OTLP** (`sessions_v2`, `traces_v2`, `spans_v2`, `usage_facts_v2`, `cost_facts_v2`, `session_rollups_v2`) — written by `POST /api/v1/traces` directly

Both schemas coexist; `init-db.sql` is idempotent (`IF NOT EXISTS` everywhere).

### Telemetry

`src/telemetry.ts` must be the **first import** in `src/index.ts` — it patches Express/http with OTel instrumentation before any other module loads. Importing it out of order silently breaks trace propagation.

### TypeScript Config

Strict mode plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`. The `no-console` ESLint rule allows `console.warn` and `console.error` only — use `Logger` for everything else.
