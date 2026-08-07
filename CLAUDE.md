# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Remi is an LLM observability platform: LangChain agents (or any OTLP source) export
traces through an authenticated ingest proxy into ClickHouse, and a dashboard reads
sessions, spans, latency, and LLM-as-judge verdicts per organization.

## Package Map

| Directory | Language | Purpose |
|-----------|----------|---------|
| `remi-backend-spring/` | Java 21 / Spring Boot 3.3 / Gradle | **The backend** — org-scoped read API, authenticated OTLP ingest proxy, admin/identity, LLM judge |
| `remi/remi/` | React 19 / Vite / TailwindCSS / recharts | Observability dashboard |
| `examples/` | Python / LangChain / LangGraph | Prod-style demo agents exercising the full pipeline |
| `remi-backend/` | TypeScript / Bun / Express | **Legacy — superseded by Spring; do not extend** |
| `remi-marketing/` | React / Tailwind | Marketing site (independent) |

Per-package deep-dives: `remi/remi/CLAUDE.md` (dashboard hooks/views, VITE_* key
resolution) and `examples/CLAUDE.md` (zero-code launch env, instrumentation gotchas).

## Architecture: Event Flow

```
Isolated agent (examples/, launched via `opentelemetry-instrument`, OTEL_* env only)
        │  OTLP http/protobuf + Authorization: Bearer <org ingest key>
        ▼
Spring backend :3100  POST /v1/traces   ← validates key against Postgres api_keys
        │  forwards raw bytes + X-Remi-Org header
        ▼
OTel Collector :4318 (127.0.0.1 only)   ← stamps remi.org_id resource attr,
        │                                  PII redaction, gen_ai normalization
        ▼
ClickHouse (otel_traces) + Jaeger       ← Postgres holds identity only
        ▲
Dashboard :3000 → Spring :3100 /api/v1/* (org resolved from bearer key)
```

- **Org scoping**: every data query filters by `KeyContext.orgId` derived from the
  API key; client-supplied org params are ignored.
- **Materialized columns (perf-critical)**: `OrgId`, `SessionId`, `Model`,
  `Provider`, `ServiceVersion`, `InputTokens/OutputTokens/CacheTokens` are
  MATERIALIZED columns on `otel_traces` (+ `idx_org` set / `idx_session` bloom
  skip indexes), computed once at insert so dashboard aggregates never
  decompress the Map columns (SpanAttributes carries full prompts — reading it
  per-row made naive queries 5-6× slower; see scripts/benchmark.sh header for
  measured numbers). Defining expressions live in `scripts/init-clickhouse.sql`;
  `ClickHouseRepository` reads the columns, never re-derives from maps. Change
  an expression → change it in init-clickhouse.sql AND `ALTER ... MODIFY COLUMN`
  + `MATERIALIZE COLUMN` on the live table.
- **Session identity** (the `SessionId` column's rungs, in order):
  `remi.session_id` → `gen_ai.conversation.id` (LangGraph stamps it on the
  invoke_agent ROOT span from `configurable.thread_id`) →
  `traceloop.association.properties.thread_id` (same thread_id on CHILD spans) →
  `traceloop.association.properties.session_id` (LCEL `metadata.session_id`) →
  `TraceId`. So the production integration is just
  `agent.invoke(..., config={"configurable": {"thread_id": sid}})` — zero
  telemetry code in agent files (examples/ has no otel_setup.py anymore).
- **Session completion**: a session is `complete` the moment its ROOT span
  (empty ParentSpanId) lands — spans export only after they end, so a present
  root means the invoke returned. Explicit `remi.session.end` marker span also
  honored; 2-min idle cutoff is the fallback for root-less exporters. Caveat:
  multi-turn (shared thread_id) sessions read complete between turns.
- **System metrics**: agents emit OTLP metrics (CPU/memory via
  `opentelemetry-instrumentation-system-metrics`, auto-discovered by the
  zero-code launcher) into `otel_metrics_gauge`/`otel_metrics_sum`; served
  per-session by `GET /api/v1/sessions/:id/system-metrics` and per-version
  (avg CPU / peak RSS) in the version comparison. Host/OS/process info comes
  from `OTEL_EXPERIMENTAL_RESOURCE_DETECTORS=os,process,host`. There is
  deliberately NO cost tracking (removed 2026-07-08); latency (avg/p95 LLM span
  duration) is the efficiency metric surfaced instead.
- **Judge**: `POST /api/v1/sessions/:id/analyze-span` calls OpenRouter
  (`OPENROUTER_API_KEY`, fallback `OPENAI_API_KEY`), persists verdicts to
  `remi.remi_span_analysis`, audit-logs prompt access. Prompt building lives in
  `JudgeService.buildJudgePrompt` (shared with the version sample-judge).
- **Scopes**: `admin`, `read:sessions`, `read:spans`, `read:prompts`,
  `write:sessions`. Prompt/response attributes are redacted from API responses
  unless the key has `read:prompts` (reads are audit-logged in Postgres).

- **Audit chain**: `audit_log` is hash-chained per org (prev_hash/entry_hash,
  advisory-lock serialized inserts); `GET /api/v1/admin/audit-log/verify`
  recomputes it. The hash-input string is duplicated between the INSERT and the
  verify query in `IdentityRepository` — change one, change both.
- **Version comparison**: `GET /api/v1/analytics/versions` groups by
  **(agent, version)** — releases are only comparable within one agent, and two
  agents sharing a version string must not merge. Per row: latency, errors,
  tokens, avg CPU / peak RSS from the metrics tables, judge scores joined from
  `remi_span_analysis`. Agents set the version via
  `OTEL_RESOURCE_ATTRIBUTES=service.version=X`.
  `POST /api/v1/analytics/versions/sample-judge {agent, version, sample}` judges
  up to 5 random unjudged LLM spans of that agent-version so its quality columns
  fill in. UI: `VersionComparison.tsx` — one section per agent with its own
  baseline radio, red/green deltas vs that agent's baseline (arrows, never
  color-alone), search/sort, unversioned hidden by default, per-row "Judge 3".

## Seeded dev identities (init-db.sql)

| Org | Key | Scopes |
|-----|-----|--------|
| `demo-org` | `test-key-123` | all |
| `demo-org` | `demo-view-key` | read-only incl. prompts (public live demo) |
| `demo-org` | `demo-ingest-key` | write:sessions (demo-feeder) |
| `acme` | `acme-ingest-key` | write:sessions (agents) |
| `acme` | `acme-admin-key` | all (dashboard default) |

The `demo-feeder` compose service (examples/Dockerfile + demo_feeder.sh) loops
the example agents against demo-org, alternating `REMI_AGENT_VERSION` so the
version view has cohorts. The dashboard accepts `?key=<api-key>` to override the
baked key (persisted in localStorage); the marketing hero's "View live demo"
link uses it with demo-view-key.

Postgres init scripts only run on a **fresh volume** — apply seed changes to an
existing database manually via `docker exec -i postgres-primary psql -U remi_user -d remi_db`.
Same for ClickHouse (`docker exec -i clickhouse clickhouse-client --user remi_user --password remi_password`).

## Commands

### Stack
```bash
docker compose up -d --build     # backend :3100, frontend :3000, Jaeger :16686
```

### Backend (`remi-backend-spring/`)
```bash
# No local gradle wrapper — build happens in the container image:
docker compose build backend
```

### Benchmark
```bash
./scripts/benchmark.sh [N]      # synthetic spans → org 'bench', times dashboard queries
./scripts/benchmark.sh clean    # drops the bench partitions (2026-05-*)
```

### Frontend (`remi/remi/`)
```bash
bun install
bun run dev          # Vite dev server
bun run type-check
bun run build
```

### Examples (`examples/`)
```bash
cd examples && source venv/bin/activate
pip install -r requirements.txt   # needs OPENROUTER_API_KEY or OPENAI_API_KEY in root .env
OTEL_SERVICE_NAME=support-agent opentelemetry-instrument python customer_support_agent.py
```
Agents contain **zero telemetry code** — instrumentation is entirely
`opentelemetry-instrument` + `OTEL_*` env (bearer `acme-ingest-key`, endpoint
`http://localhost:3100`); plain `python agent.py` runs the agent but exports no
spans. LLM calls go through OpenRouter when `OPENROUTER_API_KEY` is set, else
direct OpenAI. Full launch env + gotchas: `examples/CLAUDE.md`.

## Key Constraints

- **No automated test suites** — `remi-backend-spring/src/test` is empty; frontend
  and examples have no test runner. Closest checks: `bun run type-check` (frontend)
  and `scripts/benchmark.sh` (query perf). Verify pipeline changes against live
  ClickHouse span/session counts, not a green test run.
- `VITE_*` env vars are baked into the frontend bundle at build time (compose build args).
- The collector's host port 4318 is loopback-only; external ingest must use the
  backend proxy so the org key is enforced.
- ClickHouse rollup MVs (`remi_session_rollup_mv`, `remi_model_daily_mv`) are
  written but not yet read by the API — keep their org expr in sync with queries.
