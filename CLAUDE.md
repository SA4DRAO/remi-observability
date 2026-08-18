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
  `otel_metrics_gauge`/`otel_metrics_sum` carry the same treatment for `OrgId`
  and `ServiceVersion` (+ `idx_org`) — added 2026-08-09, because every
  org-scoped metrics query was decompressing `ResourceAttributes` per row
  (measured 234ms → 26ms on 560k gauge rows for the version comparison). Both
  tables are now defined in init-clickhouse.sql rather than left to the
  collector's `create_schema`, so their non-Remi columns track the **pinned**
  otelcol-contrib 0.105.0 — bump that image and the column lists must follow.
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
- **Two ways in** (both resolve to the same `KeyContext`, so every query stays
  org-scoped either way): a bearer **API key** (agents, CLI, the public demo
  link's `?key=`), or a **proxy-authenticated user** — Caddy + oauth2-proxy
  verify the email via SSO and forward it as `X-Forwarded-Email` alongside
  `X-Remi-Proxy-Secret`; `ApiKeyFilter` trusts that email only when the secret
  matches and maps it to an org via `org_members`. An unset `PROXY_SHARED_SECRET`
  (the local default) disables the proxy path entirely rather than failing open,
  and Caddy strips both headers off inbound requests before routing. Enable with
  `docker compose --profile prod up -d`; verify with `scripts/check-auth.sh`.
  The dashboard bundle therefore carries **no API key** on a hosted origin —
  `VITE_API_KEY` is a localhost-only dev fallback (it ships inside the JS, so
  anything else leaks it).
- **Ingest limits**: `IngestController` reads the body itself (bounded
  `readNBytes`, 4MB → 413) rather than via `@RequestBody`, so an oversized
  payload never reaches the heap; `ApiKeyFilter` applies a fixed-window per-org
  cap (`RATE_LIMIT_PER_MINUTE`, default 600, 0 disables) across read + ingest.
  Both are crash protection, not billing quotas — and the rate limiter is
  in-memory, so it counts per backend instance and needs Redis to survive
  a second replica.
- **Scopes**: `admin`, `read:sessions`, `read:spans`, `read:prompts`,
  `write:sessions`. Prompt/response attributes are redacted from API responses
  unless the key has `read:prompts` (reads are audit-logged in Postgres).

- **Audit chain**: `audit_log` is hash-chained per org (prev_hash/entry_hash,
  advisory-lock serialized inserts); `GET /api/v1/admin/audit-log/verify`
  recomputes it. The hash-input string is duplicated between the INSERT and the
  verify query in `IdentityRepository` — change one, change both.
  `/verify` only catches rows edited *without* rehashing; anyone with Postgres
  write access can drop the immutability triggers, rewrite history, and relink
  the whole chain so it verifies clean. `scripts/anchor-audit.sh` closes that by
  recording each org's `(head_id, head_hash, entry_count)` to `anchors/` and
  POSTing it to `AUDIT_ANCHOR_WEBHOOK`; a rewritten chain then contradicts a
  head recorded off-box. The entry count is not redundant — deleting a row below
  the head leaves every surviving hash valid. Cron it before the backup:
  `0 3 * * * cd /path/to/Remi && ./scripts/anchor-audit.sh >> anchors/anchor.log 2>&1`
  (exit 2 = tampering). Without a webhook the ledger sits on the same box as the
  database and only raises the cost of tampering.
- **Version comparison**: `GET /api/v1/analytics/versions` groups by
  **(agent, version)** — releases are only comparable within one agent, and two
  agents sharing a version string must not merge. Per row: latency, errors,
  tokens, avg CPU / peak RSS from the metrics tables, judge scores joined from
  `remi_span_analysis`. Agents set the version via
  `OTEL_RESOURCE_ATTRIBUTES=service.version=X`.
  Accepts `date_from`/`date_to` like `/analytics`, and the dashboard's scope bar
  passes them — the rollup, the judge join, and the metrics join must all share
  one window or a filtered-out release still contributes verdicts/CPU to a row
  that no longer exists. (Before 2026-08-09 this endpoint was all-time while
  every view around it was windowed, so the overview's regression alerts and
  agent-table p95 were dated inconsistently with their own headers.)
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

### Checks (closest thing to a test suite)
```bash
PROXY_SHARED_SECRET=<secret> MEMBER_EMAIL=<seeded org_members email> ./scripts/check-auth.sh
./scripts/backup-db.sh                                 # pg_dump, verify it restores, prune
./scripts/anchor-audit.sh                              # record + check each org's audit chain head
./scripts/anchor-audit.sh --self-test                  # tamper a scratch copy, assert it's caught
```
`check-auth.sh` hits the backend directly on :3100 rather than through Caddy — the
point is that the backend rejects a forged `X-Forwarded-Email` itself, not merely
that the proxy strips it. `backup-db.sh` restores every dump into a scratch
database and compares row counts, because an unrestored backup is a guess; dumps
land in `backups/` (gitignored — they contain key hashes and the audit chain).
Cron it daily: `0 4 * * * cd /path/to/Remi && ./scripts/backup-db.sh >> backups/backup.log 2>&1`

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
  and examples have no test runner. Closest checks: `bun run type-check` (frontend),
  `scripts/benchmark.sh` (query perf), `scripts/check-auth.sh` (auth boundary +
  ingest limits) and `scripts/backup-db.sh` (restorable backup). All four run
  against the live stack. Verify pipeline changes against live ClickHouse
  span/session counts, not a green test run.
- `VITE_*` env vars are baked into the frontend bundle at build time (compose build args).
- The collector's host port 4318 is loopback-only; external ingest must use the
  backend proxy so the org key is enforced.
- ClickHouse rollup MVs (`remi_session_rollup_mv`, `remi_model_daily_mv`) are
  written but not yet read by the API — keep their org expr in sync with queries.
