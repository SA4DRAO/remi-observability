-- =============================================================================
-- Remi Observability Platform — V2 PostgreSQL Schema
-- Generated: 2026-05-09
-- Replaces the flat event model with a full OTLP-depth trace/span layer plus
-- pre-aggregated analytics rollups for dashboard performance.
-- =============================================================================
-- NOTE: Legacy compatibility tables (events, sessions, session_metrics) are
--       created at the end of this file if they do not exist so current
--       backend and worker queries keep functioning during migration.
--       All CREATE TABLE / CREATE INDEX statements use IF NOT EXISTS so this
--       file is idempotent and safe to re-run against an existing database.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Helper function: recursively merge two JSONB objects by summing numeric
-- leaf values. Used for rollup upserts (model_usage, tool_usage, etc.).
-- Preserved from V1 — still used by remi-worker batch flushes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION jsonb_add_counts(a JSONB, b JSONB)
RETURNS JSONB AS $$
DECLARE
  result JSONB := COALESCE(a, '{}'::jsonb);
  k      TEXT;
  v      JSONB;
BEGIN
  FOR k, v IN SELECT * FROM jsonb_each(COALESCE(b, '{}'::jsonb)) LOOP
    IF jsonb_typeof(v) = 'number' THEN
      result := jsonb_set(result, ARRAY[k],
        to_jsonb(COALESCE((result->>k)::numeric, 0) + (v#>>'{}')::numeric));
    ELSIF jsonb_typeof(v) = 'object' THEN
      IF result ? k THEN
        result := jsonb_set(result, ARRAY[k], jsonb_add_counts(result->k, v));
      ELSE
        result := result || jsonb_build_object(k, v);
      END IF;
    ELSIF jsonb_typeof(v) = 'boolean' THEN
      -- OR-merge booleans: once true, stays true
      result := jsonb_set(result, ARRAY[k],
        to_jsonb(COALESCE((result->>k)::boolean, false) OR (v#>>'{}')::boolean));
    END IF;
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ---------------------------------------------------------------------------
-- 1. orgs — organisation metadata
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orgs (
    id         SERIAL      PRIMARY KEY,
    org_id     UUID        UNIQUE NOT NULL DEFAULT gen_random_uuid(),
    name       TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 2. agents — agent metadata, scoped to an org
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agents (
    id         SERIAL      PRIMARY KEY,
    agent_id   UUID        UNIQUE NOT NULL DEFAULT gen_random_uuid(),
    org_id     UUID        NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    name       TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_org_id ON agents(org_id);

-- ---------------------------------------------------------------------------
-- 3. sessions_v2 — session identity (one row per logical conversation/run)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions_v2 (
    id             SERIAL      PRIMARY KEY,
    session_id     TEXT        UNIQUE NOT NULL,
    org_id         UUID,
    agent_id       UUID,
    user_id        TEXT,
    source         TEXT        CHECK (source IN ('sdk', 'webhook', 'openrouter')),
    name           TEXT,
    metadata       JSONB,
    first_event_at TIMESTAMPTZ,
    last_event_at  TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_v2_org_created   ON sessions_v2(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_v2_agent_id      ON sessions_v2(agent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_v2_source        ON sessions_v2(source);

-- ---------------------------------------------------------------------------
-- 4. traces_v2 — one row per OTLP trace
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS traces_v2 (
    id              BIGSERIAL   PRIMARY KEY,
    trace_id        TEXT        NOT NULL UNIQUE,
    session_id      TEXT        REFERENCES sessions_v2(session_id) ON DELETE SET NULL,
    org_id          UUID,
    agent_id        UUID,
    source          TEXT,
    root_name       TEXT,
    root_span_id    TEXT,
    status_code     SMALLINT,
    status_message  TEXT,
    resource_attrs  JSONB,
    start_time_ns   BIGINT,
    end_time_ns     BIGINT,
    duration_ns     BIGINT GENERATED ALWAYS AS (end_time_ns - start_time_ns) STORED,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_traces_v2_org_session  ON traces_v2(org_id, session_id);
CREATE INDEX IF NOT EXISTS idx_traces_v2_session_id   ON traces_v2(session_id);
CREATE INDEX IF NOT EXISTS idx_traces_v2_created_at   ON traces_v2(created_at DESC);

-- ---------------------------------------------------------------------------
-- 5. spans_v2 — one row per OTLP span
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spans_v2 (
    id             BIGSERIAL   PRIMARY KEY,
    span_id        TEXT        NOT NULL,
    trace_id       TEXT        NOT NULL REFERENCES traces_v2(trace_id) ON DELETE CASCADE,
    parent_span_id TEXT,
    source         TEXT,
    name           TEXT,
    kind           SMALLINT,
    status_code    SMALLINT,
    status_message TEXT,
    model_name     TEXT,
    provider       TEXT,
    start_time_ns  BIGINT,
    end_time_ns    BIGINT,
    duration_ns    BIGINT GENERATED ALWAYS AS (end_time_ns - start_time_ns) STORED,
    org_id         UUID,
    agent_id       UUID,
    session_id     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (trace_id, span_id, source)
);

CREATE INDEX IF NOT EXISTS idx_spans_v2_trace_id          ON spans_v2(trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_v2_session_start     ON spans_v2(session_id, start_time_ns DESC);
CREATE INDEX IF NOT EXISTS idx_spans_v2_model_provider    ON spans_v2(model_name, provider);
CREATE INDEX IF NOT EXISTS idx_spans_v2_org_id            ON spans_v2(org_id);
CREATE INDEX IF NOT EXISTS idx_spans_v2_parent_span_id    ON spans_v2(parent_span_id);
CREATE INDEX IF NOT EXISTS idx_spans_v2_status_code       ON spans_v2(status_code);
CREATE INDEX IF NOT EXISTS idx_spans_v2_created_at_brin   ON spans_v2 USING BRIN (created_at);

-- ---------------------------------------------------------------------------
-- 6. span_attributes_v2 — flat key/value attributes per span
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS span_attributes_v2 (
    id          BIGSERIAL   PRIMARY KEY,
    span_id     TEXT        NOT NULL,
    trace_id    TEXT        NOT NULL,
    key         TEXT        NOT NULL,
    value_str   TEXT,
    value_int   BIGINT,
    value_float DOUBLE PRECISION,
    value_bool  BOOLEAN,
    value_json  JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_span_attrs_v2_trace_id    ON span_attributes_v2(trace_id);
CREATE INDEX IF NOT EXISTS idx_span_attrs_v2_span_key    ON span_attributes_v2(span_id, key);
CREATE INDEX IF NOT EXISTS idx_span_attrs_v2_created_brin ON span_attributes_v2 USING BRIN (created_at);

-- ---------------------------------------------------------------------------
-- 7. span_events_v2 — timeline events within spans (e.g. streaming chunks)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS span_events_v2 (
    id         BIGSERIAL   PRIMARY KEY,
    span_id    TEXT        NOT NULL,
    trace_id   TEXT        NOT NULL,
    name       TEXT        NOT NULL,
    time_ns    BIGINT,
    attrs      JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (trace_id, span_id, name, time_ns)
);

CREATE INDEX IF NOT EXISTS idx_span_events_v2_trace_id ON span_events_v2(trace_id);
CREATE INDEX IF NOT EXISTS idx_span_events_v2_span_id  ON span_events_v2(span_id);

-- ---------------------------------------------------------------------------
-- 8. span_links_v2 — cross-trace span links
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS span_links_v2 (
    id              BIGSERIAL   PRIMARY KEY,
    span_id         TEXT        NOT NULL,
    trace_id        TEXT        NOT NULL,
    linked_trace_id TEXT,
    linked_span_id  TEXT,
    attrs           JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_span_links_v2_trace_id        ON span_links_v2(trace_id);
CREATE INDEX IF NOT EXISTS idx_span_links_v2_linked_trace_id ON span_links_v2(linked_trace_id);

-- ---------------------------------------------------------------------------
-- 9. usage_facts_v2 — token usage per span (fact table for analytics)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usage_facts_v2 (
    id                  BIGSERIAL   PRIMARY KEY,
    span_id             TEXT        NOT NULL,
    trace_id            TEXT        NOT NULL,
    session_id          TEXT,
    org_id              UUID,
    agent_id            UUID,
    model_name          TEXT,
    provider            TEXT,
    prompt_tokens       INT,
    completion_tokens   INT,
    total_tokens        INT,
    cache_read_tokens   INT,
    cache_write_tokens  INT,
    reasoning_tokens    INT,
    event_date          DATE        NOT NULL DEFAULT CURRENT_DATE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_facts_v2_trace_id      ON usage_facts_v2(trace_id);
CREATE INDEX IF NOT EXISTS idx_usage_facts_v2_session_id    ON usage_facts_v2(session_id);
CREATE INDEX IF NOT EXISTS idx_usage_facts_v2_date_org      ON usage_facts_v2(event_date, org_id);
CREATE INDEX IF NOT EXISTS idx_usage_facts_v2_model         ON usage_facts_v2(model_name, provider);
CREATE INDEX IF NOT EXISTS idx_usage_facts_v2_created_brin  ON usage_facts_v2 USING BRIN (created_at);

-- ---------------------------------------------------------------------------
-- 10. cost_facts_v2 — computed cost per span (fact table for analytics)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cost_facts_v2 (
    id                      BIGSERIAL      PRIMARY KEY,
    span_id                 TEXT           NOT NULL,
    trace_id                TEXT           NOT NULL,
    session_id              TEXT,
    org_id                  UUID,
    agent_id                UUID,
    model_name              TEXT,
    provider                TEXT,
    prompt_cost_usd         NUMERIC(18,8),
    completion_cost_usd     NUMERIC(18,8),
    cache_read_cost_usd     NUMERIC(18,8),
    cache_write_cost_usd    NUMERIC(18,8),
    reasoning_cost_usd      NUMERIC(18,8),
    total_cost_usd          NUMERIC(18,8),
    pricing_source          TEXT,
    event_date              DATE           NOT NULL DEFAULT CURRENT_DATE,
    created_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cost_facts_v2_trace_id      ON cost_facts_v2(trace_id);
CREATE INDEX IF NOT EXISTS idx_cost_facts_v2_session_id    ON cost_facts_v2(session_id);
CREATE INDEX IF NOT EXISTS idx_cost_facts_v2_date_org      ON cost_facts_v2(event_date, org_id);
CREATE INDEX IF NOT EXISTS idx_cost_facts_v2_model         ON cost_facts_v2(model_name, provider);
CREATE INDEX IF NOT EXISTS idx_cost_facts_v2_created_brin  ON cost_facts_v2 USING BRIN (created_at);

-- ---------------------------------------------------------------------------
-- 11. ingest_batches_v2 — idempotent ingest ledger
--     Tracks each batch received at /api/v1/traces. batch_checksum is the
--     SHA-256 of the raw request body; (source, batch_checksum) is UNIQUE to
--     enable exactly-once processing on replay.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingest_batches_v2 (
    id                  BIGSERIAL   PRIMARY KEY,
    batch_id            UUID        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    source              TEXT,
    batch_checksum      TEXT,
    payload_size_bytes  INT,
    span_count          INT,
    processing_status   TEXT        NOT NULL DEFAULT 'received',
    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ,
    retry_count         INT         NOT NULL DEFAULT 0,
    error_detail        TEXT,
    UNIQUE (source, batch_checksum)
);

CREATE INDEX IF NOT EXISTS idx_ingest_batches_v2_status       ON ingest_batches_v2(processing_status);
CREATE INDEX IF NOT EXISTS idx_ingest_batches_v2_first_seen   ON ingest_batches_v2(first_seen_at DESC);

-- ---------------------------------------------------------------------------
-- 12. model_pricing — cost rates per model, refreshed periodically by worker
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS model_pricing (
    model_name              VARCHAR(255)   PRIMARY KEY,
    input_cost_per_1m       DECIMAL(12,6)  NOT NULL DEFAULT 0,
    output_cost_per_1m      DECIMAL(12,6)  NOT NULL DEFAULT 0,
    provider                VARCHAR(100),
    source                  VARCHAR(50)    NOT NULL DEFAULT 'seed',
    cache_input_cost_per_1m DECIMAL(12,6),
    cache_read_cost_per_1m  DECIMAL(12,6),
    reasoning_cost_per_1m   DECIMAL(12,6),
    max_input_tokens        INTEGER,
    max_output_tokens       INTEGER,
    created_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_pricing_provider ON model_pricing(provider);

-- Seed with common models (prices as of early 2026, USD per 1M tokens)
INSERT INTO model_pricing (model_name, input_cost_per_1m, output_cost_per_1m, provider, source) VALUES
    -- OpenAI
    ('gpt-4o',                      2.50,    10.00,  'openai',    'seed'),
    ('gpt-4o-mini',                 0.15,     0.60,  'openai',    'seed'),
    ('gpt-4-turbo',                10.00,    30.00,  'openai',    'seed'),
    ('gpt-4',                      30.00,    60.00,  'openai',    'seed'),
    ('gpt-3.5-turbo',               0.50,     1.50,  'openai',    'seed'),
    ('o1',                         15.00,    60.00,  'openai',    'seed'),
    ('o1-mini',                     3.00,    12.00,  'openai',    'seed'),
    ('o3-mini',                     1.10,     4.40,  'openai',    'seed'),
    -- OpenAI versioned aliases
    ('gpt-4o-2024-08-06',           2.50,    10.00,  'openai',    'seed'),
    ('gpt-4o-2024-11-20',           2.50,    10.00,  'openai',    'seed'),
    ('gpt-4o-mini-2024-07-18',      0.15,     0.60,  'openai',    'seed'),
    -- Anthropic
    ('claude-3-5-sonnet-20241022',  3.00,    15.00,  'anthropic', 'seed'),
    ('claude-3-5-haiku-20241022',   0.80,     4.00,  'anthropic', 'seed'),
    ('claude-3-opus-20240229',     15.00,    75.00,  'anthropic', 'seed'),
    ('claude-sonnet-4-20250514',    3.00,    15.00,  'anthropic', 'seed'),
    -- Google
    ('gemini-1.5-pro',              1.25,     5.00,  'google',    'seed'),
    ('gemini-1.5-flash',            0.075,    0.30,  'google',    'seed'),
    ('gemini-2.0-flash',            0.10,     0.40,  'google',    'seed')
ON CONFLICT (model_name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 13. session_rollups_v2 — one-row dashboard aggregate per session
--     Recomputed by update_session_rollup_v2() after every ingest batch.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS session_rollups_v2 (
    id                  BIGSERIAL      PRIMARY KEY,
    session_id          TEXT           UNIQUE NOT NULL REFERENCES sessions_v2(session_id) ON DELETE CASCADE,
    org_id              UUID,
    agent_id            UUID,
    total_spans         INT            NOT NULL DEFAULT 0,
    llm_spans           INT            NOT NULL DEFAULT 0,
    tool_spans          INT            NOT NULL DEFAULT 0,
    error_count         INT            NOT NULL DEFAULT 0,
    prompt_tokens       BIGINT         NOT NULL DEFAULT 0,
    completion_tokens   BIGINT         NOT NULL DEFAULT 0,
    total_tokens        BIGINT         NOT NULL DEFAULT 0,
    cache_read_tokens   BIGINT         NOT NULL DEFAULT 0,
    reasoning_tokens    BIGINT         NOT NULL DEFAULT 0,
    total_cost_usd      NUMERIC(18,8)  NOT NULL DEFAULT 0,
    total_duration_ns   BIGINT         NOT NULL DEFAULT 0,
    model_usage         JSONB          NOT NULL DEFAULT '{}',
    tool_usage          JSONB          NOT NULL DEFAULT '{}',
    error_types         JSONB          NOT NULL DEFAULT '{}',
    first_span_at       TIMESTAMPTZ,
    last_span_at        TIMESTAMPTZ,
    is_complete         BOOLEAN        NOT NULL DEFAULT FALSE,
    has_error           BOOLEAN        NOT NULL DEFAULT FALSE,
    updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_rollups_v2_org_id    ON session_rollups_v2(org_id);
CREATE INDEX IF NOT EXISTS idx_session_rollups_v2_agent_id  ON session_rollups_v2(agent_id);
CREATE INDEX IF NOT EXISTS idx_session_rollups_v2_updated   ON session_rollups_v2(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_rollups_v2_has_error ON session_rollups_v2(has_error);

-- ---------------------------------------------------------------------------
-- 14. agent_daily_rollups_v2 — per-agent/day totals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_daily_rollups_v2 (
    agent_id          UUID           NOT NULL,
    date              DATE           NOT NULL,
    org_id            UUID,
    total_spans       INT            NOT NULL DEFAULT 0,
    llm_spans         INT            NOT NULL DEFAULT 0,
    tool_spans        INT            NOT NULL DEFAULT 0,
    error_count       INT            NOT NULL DEFAULT 0,
    prompt_tokens     BIGINT         NOT NULL DEFAULT 0,
    completion_tokens BIGINT         NOT NULL DEFAULT 0,
    total_tokens      BIGINT         NOT NULL DEFAULT 0,
    total_cost_usd    NUMERIC(18,8)  NOT NULL DEFAULT 0,
    session_count     INT            NOT NULL DEFAULT 0,
    active_models     JSONB          NOT NULL DEFAULT '{}',
    created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agent_id, date)
);

CREATE INDEX IF NOT EXISTS idx_agent_daily_rollups_v2_org_date ON agent_daily_rollups_v2(org_id, date DESC);

-- ---------------------------------------------------------------------------
-- 15. model_daily_rollups_v2 — per-model/provider/day totals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS model_daily_rollups_v2 (
    model_name          TEXT           NOT NULL,
    provider            TEXT           NOT NULL,
    date                DATE           NOT NULL,
    org_id              UUID           NOT NULL,
    total_spans         INT            NOT NULL DEFAULT 0,
    prompt_tokens       BIGINT         NOT NULL DEFAULT 0,
    completion_tokens   BIGINT         NOT NULL DEFAULT 0,
    total_tokens        BIGINT         NOT NULL DEFAULT 0,
    cache_read_tokens   BIGINT         NOT NULL DEFAULT 0,
    reasoning_tokens    BIGINT         NOT NULL DEFAULT 0,
    total_cost_usd      NUMERIC(18,8)  NOT NULL DEFAULT 0,
    session_count       INT            NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    PRIMARY KEY (model_name, provider, date, org_id)
);

CREATE INDEX IF NOT EXISTS idx_model_daily_rollups_v2_date_org ON model_daily_rollups_v2(date DESC, org_id);

-- ---------------------------------------------------------------------------
-- Helper function: recompute session_rollups_v2 for a single session.
-- Called by the worker after every ingest batch that touches a session.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_session_rollup_v2(p_session_id TEXT)
RETURNS VOID AS $$
DECLARE
  v_span_agg RECORD;
  v_usage_agg RECORD;
  v_cost_agg RECORD;
  v_model_usage JSONB := '{}';
  v_tool_usage  JSONB := '{}';
  v_error_types JSONB := '{}';
BEGIN
  -- Aggregate span-level stats
  SELECT
    COUNT(*)                                             AS total_spans,
    COUNT(*) FILTER (WHERE s.name ILIKE '%llm%'
                        OR s.name ILIKE '%chat%'
                        OR s.name ILIKE '%completion%'
                        OR s.kind = 3)                  AS llm_spans,
    COUNT(*) FILTER (WHERE s.name ILIKE '%tool%'
                        OR s.kind = 4)                  AS tool_spans,
    COUNT(*) FILTER (WHERE s.status_code = 2)           AS error_count,
    SUM(COALESCE(s.duration_ns, 0))                     AS total_duration_ns,
    MIN(to_timestamp(s.start_time_ns / 1e9))            AS first_span_at,
    MAX(to_timestamp(s.end_time_ns   / 1e9))            AS last_span_at
  INTO v_span_agg
  FROM spans_v2 s
  WHERE s.session_id = p_session_id;

  -- Aggregate token usage
  SELECT
    COALESCE(SUM(prompt_tokens),     0) AS prompt_tokens,
    COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
    COALESCE(SUM(total_tokens),      0) AS total_tokens,
    COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
    COALESCE(SUM(reasoning_tokens),  0) AS reasoning_tokens
  INTO v_usage_agg
  FROM usage_facts_v2
  WHERE session_id = p_session_id;

  -- Aggregate cost
  SELECT COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd
  INTO v_cost_agg
  FROM cost_facts_v2
  WHERE session_id = p_session_id;

  -- Build model_usage JSONB: { "<model>": { "spans": N, "tokens": N } }
  SELECT jsonb_object_agg(
    model_name,
    jsonb_build_object(
      'spans',  span_count,
      'tokens', token_sum
    )
  )
  INTO v_model_usage
  FROM (
    SELECT
      s.model_name,
      COUNT(*)                             AS span_count,
      COALESCE(SUM(u.total_tokens), 0)    AS token_sum
    FROM spans_v2 s
    LEFT JOIN usage_facts_v2 u
           ON u.span_id = s.span_id AND u.session_id = p_session_id
    WHERE s.session_id = p_session_id
      AND s.model_name IS NOT NULL
    GROUP BY s.model_name
  ) m;

  -- Build tool_usage JSONB: { "<tool>": { "calls": N, "errors": N } }
  SELECT jsonb_object_agg(
    span_name,
    jsonb_build_object(
      'calls',  span_count,
      'errors', error_count
    )
  )
  INTO v_tool_usage
  FROM (
    SELECT
      s.name                                               AS span_name,
      COUNT(*)                                             AS span_count,
      COUNT(*) FILTER (WHERE s.status_code = 2)            AS error_count
    FROM spans_v2 s
    WHERE s.session_id = p_session_id
      AND (s.name ILIKE '%tool%' OR s.kind = 4)
    GROUP BY s.name
  ) t;

  -- Build error_types JSONB: { "<status_message>": N }
  SELECT jsonb_object_agg(status_message, cnt)
  INTO v_error_types
  FROM (
    SELECT status_message, COUNT(*) AS cnt
    FROM spans_v2
    WHERE session_id = p_session_id
      AND status_code = 2
      AND status_message IS NOT NULL
    GROUP BY status_message
  ) e;

  -- Upsert the rollup row
  INSERT INTO session_rollups_v2 (
    session_id,
    org_id,
    agent_id,
    total_spans,
    llm_spans,
    tool_spans,
    error_count,
    prompt_tokens,
    completion_tokens,
    total_tokens,
    cache_read_tokens,
    reasoning_tokens,
    total_cost_usd,
    total_duration_ns,
    model_usage,
    tool_usage,
    error_types,
    first_span_at,
    last_span_at,
    has_error,
    updated_at
  )
  SELECT
    p_session_id,
    sv.org_id,
    sv.agent_id,
    COALESCE(v_span_agg.total_spans,      0),
    COALESCE(v_span_agg.llm_spans,        0),
    COALESCE(v_span_agg.tool_spans,       0),
    COALESCE(v_span_agg.error_count,      0),
    COALESCE(v_usage_agg.prompt_tokens,     0),
    COALESCE(v_usage_agg.completion_tokens, 0),
    COALESCE(v_usage_agg.total_tokens,      0),
    COALESCE(v_usage_agg.cache_read_tokens, 0),
    COALESCE(v_usage_agg.reasoning_tokens,  0),
    COALESCE(v_cost_agg.total_cost_usd,     0),
    COALESCE(v_span_agg.total_duration_ns,  0),
    COALESCE(v_model_usage, '{}'),
    COALESCE(v_tool_usage,  '{}'),
    COALESCE(v_error_types, '{}'),
    v_span_agg.first_span_at,
    v_span_agg.last_span_at,
    COALESCE(v_span_agg.error_count, 0) > 0,
    NOW()
  FROM sessions_v2 sv
  WHERE sv.session_id = p_session_id
  ON CONFLICT (session_id) DO UPDATE SET
    org_id            = EXCLUDED.org_id,
    agent_id          = EXCLUDED.agent_id,
    total_spans       = EXCLUDED.total_spans,
    llm_spans         = EXCLUDED.llm_spans,
    tool_spans        = EXCLUDED.tool_spans,
    error_count       = EXCLUDED.error_count,
    prompt_tokens     = EXCLUDED.prompt_tokens,
    completion_tokens = EXCLUDED.completion_tokens,
    total_tokens      = EXCLUDED.total_tokens,
    cache_read_tokens = EXCLUDED.cache_read_tokens,
    reasoning_tokens  = EXCLUDED.reasoning_tokens,
    total_cost_usd    = EXCLUDED.total_cost_usd,
    total_duration_ns = EXCLUDED.total_duration_ns,
    model_usage       = EXCLUDED.model_usage,
    tool_usage        = EXCLUDED.tool_usage,
    error_types       = EXCLUDED.error_types,
    first_span_at     = EXCLUDED.first_span_at,
    last_span_at      = EXCLUDED.last_span_at,
    has_error         = EXCLUDED.has_error,
    updated_at        = EXCLUDED.updated_at;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 16. Legacy compatibility tables for current backend/worker code paths
--     Keep these while migrating ingestion from remi-langchain SDK traffic.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sessions (
    id          SERIAL       PRIMARY KEY,
    session_id  VARCHAR(255) UNIQUE NOT NULL,
    name        VARCHAR(255),
    metadata    JSONB,
    org_id      VARCHAR(255),
    agent_id    VARCHAR(255),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_org_id     ON sessions(org_id);
CREATE INDEX IF NOT EXISTS idx_sessions_agent_id   ON sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC);

CREATE TABLE IF NOT EXISTS events (
    id             BIGSERIAL     PRIMARY KEY,
    session_id     VARCHAR(255)  NOT NULL,
    event_type     VARCHAR(100)  NOT NULL,
    event_data     JSONB         NOT NULL DEFAULT '{}',
    seq            INTEGER,
    org_id         VARCHAR(255),
    agent_id       VARCHAR(255),
    run_id         TEXT,
    parent_run_id  TEXT,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_session_seq_dedup
  ON events(session_id, seq)
  WHERE seq IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_session_created
  ON events(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_event_type
  ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_org_agent
  ON events(org_id, agent_id);

CREATE TABLE IF NOT EXISTS trace_session_correlations (
    trace_id    TEXT          PRIMARY KEY,
    session_id  VARCHAR(255)  NOT NULL,
    org_id      VARCHAR(255),
    agent_id    VARCHAR(255),
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trace_session_correlations_session_id
  ON trace_session_correlations(session_id);

CREATE TABLE IF NOT EXISTS provider_alias_correlations (
    provider    VARCHAR(100)  NOT NULL DEFAULT 'unknown',
    alias_type  VARCHAR(50)   NOT NULL,
    alias_value TEXT          NOT NULL,
    session_id  VARCHAR(255)  NOT NULL,
    trace_id    TEXT,
    org_id      VARCHAR(255),
    agent_id    VARCHAR(255),
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (provider, alias_type, alias_value)
);

CREATE INDEX IF NOT EXISTS idx_provider_alias_correlations_session_id
  ON provider_alias_correlations(session_id);

CREATE INDEX IF NOT EXISTS idx_provider_alias_correlations_trace_id
  ON provider_alias_correlations(trace_id);

CREATE TABLE IF NOT EXISTS session_metrics (
    id                      BIGSERIAL      PRIMARY KEY,
    session_id              VARCHAR(255)   UNIQUE NOT NULL,
    org_id                  VARCHAR(255),
    agent_id                VARCHAR(255),
    total_events            INTEGER        NOT NULL DEFAULT 0,
    llm_calls               INTEGER        NOT NULL DEFAULT 0,
    tool_calls              INTEGER        NOT NULL DEFAULT 0,
    error_count             INTEGER        NOT NULL DEFAULT 0,
    prompt_tokens           BIGINT         NOT NULL DEFAULT 0,
    completion_tokens       BIGINT         NOT NULL DEFAULT 0,
    total_tokens            BIGINT         NOT NULL DEFAULT 0,
    estimated_cost_usd      NUMERIC(18,8)  NOT NULL DEFAULT 0,
    cost_status             VARCHAR(20)    NOT NULL DEFAULT 'estimated',
    total_llm_duration_ms   BIGINT         NOT NULL DEFAULT 0,
    total_tool_duration_ms  BIGINT         NOT NULL DEFAULT 0,
    max_agent_iteration     INTEGER        NOT NULL DEFAULT 0,
    finish_reasons          JSONB          NOT NULL DEFAULT '{}',
    tool_usage              JSONB          NOT NULL DEFAULT '{}',
    model_usage             JSONB          NOT NULL DEFAULT '{}',
    event_type_counts       JSONB          NOT NULL DEFAULT '{}',
    first_event_at          TIMESTAMPTZ,
    last_event_at           TIMESTAMPTZ,
    is_complete             BOOLEAN        NOT NULL DEFAULT FALSE,
    has_error               BOOLEAN        NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_metrics_org_agent
  ON session_metrics(org_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_session_metrics_last_event
  ON session_metrics(last_event_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_metrics_has_error
  ON session_metrics(has_error);
