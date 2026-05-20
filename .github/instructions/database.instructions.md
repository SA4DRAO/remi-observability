---
name: "database"
description: "PostgreSQL schema reference and query conventions for Remi. USE FOR: writing SQL queries, using pg Pool (backend) or asyncpg (worker), upsert session_metrics delta, events deduplication by seq, session_metrics JSONB breakdown columns, jsonb_add_counts function, model_pricing table, ON CONFLICT upserts, querying events or sessions tables."
---

# Database Standards — Remi PostgreSQL

Schema defined in [`scripts/init-db.sql`](../../scripts/init-db.sql). Two clients:
- **Backend** (`remi-backend`): `pg` Pool via `DatabaseService.queryRead()` / `DatabaseService.query()`
- **Worker** (`remi-worker`): `asyncpg` Pool via `DatabasePool.fetch()` / `DatabasePool.execute()`

## Table Reference

### `events`
```sql
id          SERIAL PRIMARY KEY
session_id  VARCHAR(255) NOT NULL
event_type  VARCHAR(100) NOT NULL   -- e.g. "llm_start", "llm_end", "tool_start"
event_data  JSONB NOT NULL           -- SDK payload (ts, model, usage, tool_calls, ...)
seq         INTEGER                  -- monotonic per session; NULL = no deduplication
org_id      VARCHAR(255)
agent_id    VARCHAR(255)
created_at  TIMESTAMPTZ DEFAULT NOW()
```

**Deduplication index**: `UNIQUE (session_id, seq) WHERE seq IS NOT NULL` — replay-safe INSERT:
```sql
INSERT INTO events (session_id, event_type, event_data, seq, org_id, agent_id)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (session_id, seq) WHERE seq IS NOT NULL DO NOTHING
```

### `sessions`
```sql
id          SERIAL PRIMARY KEY
session_id  VARCHAR(255) UNIQUE NOT NULL
name        VARCHAR(255)
metadata    JSONB
org_id      VARCHAR(255)
agent_id    VARCHAR(255)
created_at  TIMESTAMPTZ
updated_at  TIMESTAMPTZ
```

Upsert pattern:
```sql
INSERT INTO sessions (session_id, name, metadata, org_id, agent_id)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (session_id) DO UPDATE
  SET name = EXCLUDED.name, metadata = EXCLUDED.metadata, updated_at = NOW()
```

### `session_metrics`
Pre-aggregated per-session stats; **never queried directly with SUM(events)**. The worker upserts deltas after each batch flush.

Key columns:
- Scalar counters: `total_events`, `llm_calls`, `tool_calls`, `error_count`
- Token totals: `prompt_tokens`, `completion_tokens`, `total_tokens`
- Cost: `estimated_cost_usd DECIMAL(14,8)`, `cost_status VARCHAR(20)`
  - `cost_status`: `'estimated'` (all priced) | `'partial'` (some dims missing) | `'unavailable'` (no pricing)
- Latency totals: `total_llm_duration_ms`, `total_tool_duration_ms` — derive averages in the API layer, never store averages
- JSONB breakdowns: `finish_reasons`, `tool_usage`, `model_usage`, `event_type_counts`
  - `finish_reasons`: `{"stop": N, "tool_calls": N, "length": N}`
  - `tool_usage`: `{"<tool_name>": {"calls": N, "errors": N, "total_ms": N}}`
  - `model_usage`: `{"<model_name>": {"calls": N, "tokens": N}}`
- Lifecycle: `first_event_at`, `last_event_at`, `is_complete BOOLEAN`, `has_error BOOLEAN`

**Delta upsert pattern** (worker — uses `jsonb_add_counts()` for JSONB columns):
```sql
INSERT INTO session_metrics (session_id, org_id, agent_id, total_events, llm_calls, ...)
VALUES ($1, $2, $3, $4, $5, ...)
ON CONFLICT (session_id) DO UPDATE SET
  total_events   = session_metrics.total_events + EXCLUDED.total_events,
  llm_calls      = session_metrics.llm_calls + EXCLUDED.llm_calls,
  finish_reasons = jsonb_add_counts(session_metrics.finish_reasons, EXCLUDED.finish_reasons),
  tool_usage     = jsonb_add_counts(session_metrics.tool_usage, EXCLUDED.tool_usage),
  updated_at     = NOW()
```

### `model_pricing`
```sql
model_name              VARCHAR(255) PRIMARY KEY
input_cost_per_1m       DECIMAL(12,6)   -- USD per 1M input tokens
output_cost_per_1m      DECIMAL(12,6)
cache_input_cost_per_1m DECIMAL(12,6)   -- NULL = not applicable
cache_read_cost_per_1m  DECIMAL(12,6)
reasoning_cost_per_1m   DECIMAL(12,6)
provider                VARCHAR(100)
source                  VARCHAR(50)     -- 'litellm' | 'manual' | 'seed'
max_input_tokens        INTEGER
max_output_tokens       INTEGER
```
Refreshed every 10 min by the worker's pricing cache. Missing model → cost = 0, `cost_status = 'unavailable'`.

## `jsonb_add_counts()` Function

Custom PL/pgSQL function that **recursively merges two JSONB objects by summing numeric leaf values** and OR-merging booleans. Used for delta upserts on `finish_reasons`, `tool_usage`, `model_usage`, `event_type_counts`.

- Numeric leaves are summed; nested objects are recursed into
- Boolean leaves are OR-merged (once `true`, stays `true`)
- Always pass both sides through `COALESCE(x, '{}'::jsonb)` if the column may be NULL

## Key Constraints & Gotchas

- `session_id` is a free-form string (not enforced as UUID) — do not cast it
- `seq` is `NULL` for events from SDK clients that don't set sequence numbers — deduplication only applies when `seq IS NOT NULL`
- `session_metrics` stores **totals, not averages** — compute averages (`avg_llm_duration_ms = total / llm_calls`) in the Express API layer, never persist averages
- `estimated_cost_usd` in `event_data` JSONB (per-event) and in `session_metrics` (session total) are independent — the worker sums per-event costs into the session total
- Always filter by `org_id` / `agent_id` when both are provided — never expose cross-org data
