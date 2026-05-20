-- =============================================================================
-- Remi V2 Schema Migration: drop UUID org_id/agent_id, recreate with TEXT
-- Safe to re-run. Apply with:
--   PGPASSWORD=remi_password psql -h localhost -p 5432 -U remi_user -d remi_db \
--     -f scripts/migrate-v2-schema.sql
-- =============================================================================

-- Drop in reverse dependency order
DROP TABLE IF EXISTS agent_daily_rollups_v2 CASCADE;
DROP TABLE IF EXISTS model_daily_rollups_v2 CASCADE;
DROP TABLE IF EXISTS session_rollups_v2 CASCADE;
DROP TABLE IF EXISTS cost_facts_v2 CASCADE;
DROP TABLE IF EXISTS usage_facts_v2 CASCADE;
DROP TABLE IF EXISTS span_links_v2 CASCADE;
DROP TABLE IF EXISTS span_events_v2 CASCADE;
DROP TABLE IF EXISTS span_attributes_v2 CASCADE;
DROP TABLE IF EXISTS spans_v2 CASCADE;
DROP TABLE IF EXISTS traces_v2 CASCADE;
DROP TABLE IF EXISTS sessions_v2 CASCADE;
DROP TABLE IF EXISTS orgs CASCADE;
DROP TABLE IF EXISTS agents CASCADE;

-- ---------------------------------------------------------------------------
-- sessions_v2
-- ---------------------------------------------------------------------------
CREATE TABLE sessions_v2 (
    id             SERIAL      PRIMARY KEY,
    session_id     TEXT        UNIQUE NOT NULL,
    org_id         TEXT,
    agent_id       TEXT,
    user_id        TEXT,
    source         TEXT        CHECK (source IN ('sdk', 'webhook', 'openrouter')),
    name           TEXT,
    metadata       JSONB,
    first_event_at TIMESTAMPTZ,
    last_event_at  TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_v2_org_created  ON sessions_v2(org_id, created_at DESC);
CREATE INDEX idx_sessions_v2_agent_id     ON sessions_v2(agent_id);
CREATE INDEX idx_sessions_v2_source       ON sessions_v2(source);

-- ---------------------------------------------------------------------------
-- traces_v2
-- ---------------------------------------------------------------------------
CREATE TABLE traces_v2 (
    id              BIGSERIAL   PRIMARY KEY,
    trace_id        TEXT        NOT NULL UNIQUE,
    session_id      TEXT        REFERENCES sessions_v2(session_id) ON DELETE SET NULL,
    org_id          TEXT,
    agent_id        TEXT,
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

CREATE INDEX idx_traces_v2_org_session ON traces_v2(org_id, session_id);
CREATE INDEX idx_traces_v2_session_id  ON traces_v2(session_id);
CREATE INDEX idx_traces_v2_created_at  ON traces_v2(created_at DESC);

-- ---------------------------------------------------------------------------
-- spans_v2
-- ---------------------------------------------------------------------------
CREATE TABLE spans_v2 (
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
    org_id         TEXT,
    agent_id       TEXT,
    session_id     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (trace_id, span_id, source)
);

CREATE INDEX idx_spans_v2_trace_id        ON spans_v2(trace_id);
CREATE INDEX idx_spans_v2_session_start   ON spans_v2(session_id, start_time_ns DESC);
CREATE INDEX idx_spans_v2_model_provider  ON spans_v2(model_name, provider);
CREATE INDEX idx_spans_v2_org_id          ON spans_v2(org_id);
CREATE INDEX idx_spans_v2_parent_span_id  ON spans_v2(parent_span_id);
CREATE INDEX idx_spans_v2_status_code     ON spans_v2(status_code);
CREATE INDEX idx_spans_v2_created_at_brin ON spans_v2 USING BRIN (created_at);

-- ---------------------------------------------------------------------------
-- span_attributes_v2
-- ---------------------------------------------------------------------------
CREATE TABLE span_attributes_v2 (
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

CREATE INDEX        idx_span_attrs_v2_trace_id ON span_attributes_v2(trace_id);
CREATE UNIQUE INDEX idx_span_attrs_v2_span_key ON span_attributes_v2(span_id, key);
CREATE INDEX idx_span_attrs_v2_created_brin ON span_attributes_v2 USING BRIN (created_at);

-- ---------------------------------------------------------------------------
-- span_events_v2
-- ---------------------------------------------------------------------------
CREATE TABLE span_events_v2 (
    id         BIGSERIAL   PRIMARY KEY,
    span_id    TEXT        NOT NULL,
    trace_id   TEXT        NOT NULL,
    name       TEXT        NOT NULL,
    time_ns    BIGINT,
    attrs      JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (trace_id, span_id, name, time_ns)
);

CREATE INDEX idx_span_events_v2_trace_id ON span_events_v2(trace_id);
CREATE INDEX idx_span_events_v2_span_id  ON span_events_v2(span_id);

-- ---------------------------------------------------------------------------
-- span_links_v2
-- ---------------------------------------------------------------------------
CREATE TABLE span_links_v2 (
    id              BIGSERIAL   PRIMARY KEY,
    span_id         TEXT        NOT NULL,
    trace_id        TEXT        NOT NULL,
    linked_trace_id TEXT,
    linked_span_id  TEXT,
    attrs           JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_span_links_v2_trace_id        ON span_links_v2(trace_id);
CREATE INDEX idx_span_links_v2_linked_trace_id ON span_links_v2(linked_trace_id);

-- ---------------------------------------------------------------------------
-- usage_facts_v2
-- ---------------------------------------------------------------------------
CREATE TABLE usage_facts_v2 (
    id                  BIGSERIAL   PRIMARY KEY,
    span_id             TEXT        NOT NULL,
    trace_id            TEXT        NOT NULL,
    session_id          TEXT,
    org_id              TEXT,
    agent_id            TEXT,
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

CREATE INDEX idx_usage_facts_v2_trace_id     ON usage_facts_v2(trace_id);
CREATE INDEX idx_usage_facts_v2_session_id   ON usage_facts_v2(session_id);
CREATE INDEX idx_usage_facts_v2_date_org     ON usage_facts_v2(event_date, org_id);
CREATE INDEX idx_usage_facts_v2_model        ON usage_facts_v2(model_name, provider);
CREATE INDEX idx_usage_facts_v2_created_brin ON usage_facts_v2 USING BRIN (created_at);

-- ---------------------------------------------------------------------------
-- cost_facts_v2
-- ---------------------------------------------------------------------------
CREATE TABLE cost_facts_v2 (
    id                      BIGSERIAL      PRIMARY KEY,
    span_id                 TEXT           NOT NULL,
    trace_id                TEXT           NOT NULL,
    session_id              TEXT,
    org_id                  TEXT,
    agent_id                TEXT,
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

CREATE INDEX idx_cost_facts_v2_trace_id     ON cost_facts_v2(trace_id);
CREATE INDEX idx_cost_facts_v2_session_id   ON cost_facts_v2(session_id);
CREATE INDEX idx_cost_facts_v2_date_org     ON cost_facts_v2(event_date, org_id);
CREATE INDEX idx_cost_facts_v2_model        ON cost_facts_v2(model_name, provider);
CREATE INDEX idx_cost_facts_v2_created_brin ON cost_facts_v2 USING BRIN (created_at);

-- ---------------------------------------------------------------------------
-- session_rollups_v2
-- ---------------------------------------------------------------------------
CREATE TABLE session_rollups_v2 (
    id                  BIGSERIAL      PRIMARY KEY,
    session_id          TEXT           UNIQUE NOT NULL REFERENCES sessions_v2(session_id) ON DELETE CASCADE,
    org_id              TEXT,
    agent_id            TEXT,
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

CREATE INDEX idx_session_rollups_v2_org_id    ON session_rollups_v2(org_id);
CREATE INDEX idx_session_rollups_v2_agent_id  ON session_rollups_v2(agent_id);
CREATE INDEX idx_session_rollups_v2_updated   ON session_rollups_v2(updated_at DESC);
CREATE INDEX idx_session_rollups_v2_has_error ON session_rollups_v2(has_error);

-- ---------------------------------------------------------------------------
-- Stored procedure: recompute session_rollups_v2 for one session
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_session_rollup_v2(p_session_id TEXT)
RETURNS VOID AS $$
DECLARE
  v_span_agg    RECORD;
  v_usage_agg   RECORD;
  v_cost_agg    RECORD;
  v_model_usage JSONB    := '{}';
  v_tool_usage  JSONB    := '{}';
  v_error_types JSONB    := '{}';
  v_is_complete BOOLEAN  := FALSE;
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

  -- A session is complete once its root span (no parent) has been received
  SELECT EXISTS (
    SELECT 1 FROM spans_v2 s2
    WHERE s2.session_id = p_session_id
      AND (s2.parent_span_id IS NULL OR s2.parent_span_id = '')
  ) INTO v_is_complete;

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
    is_complete,
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
    v_is_complete,
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
    is_complete       = EXCLUDED.is_complete,
    has_error         = EXCLUDED.has_error,
    updated_at        = EXCLUDED.updated_at;
END;
$$ LANGUAGE plpgsql;
