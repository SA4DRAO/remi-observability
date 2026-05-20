-- =============================================================================
-- Remi Migration: conversations, prompt_version, full-text search
-- Safe to re-run (uses IF NOT EXISTS / CREATE OR REPLACE).
-- NOTE: The GIN index at the bottom uses CONCURRENTLY and must be run
--       OUTSIDE a transaction block (i.e., not inside BEGIN/COMMIT).
-- Apply with:
--   PGPASSWORD=remi_password psql -h localhost -p 5432 -U remi_user -d remi_db \
--     -f scripts/migrate-conversations-search.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. conversations — one row per logical multi-turn conversation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
    id              BIGSERIAL   PRIMARY KEY,
    conversation_id TEXT        UNIQUE NOT NULL,
    org_id          UUID,
    agent_id        UUID,
    title           TEXT,
    first_session_at TIMESTAMPTZ,
    last_session_at  TIMESTAMPTZ,
    session_count   INT         NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_org_id    ON conversations(org_id);
CREATE INDEX IF NOT EXISTS idx_conversations_agent_id  ON conversations(agent_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated   ON conversations(updated_at DESC);

-- ---------------------------------------------------------------------------
-- 2. Add conversation_id + prompt_version to sessions_v2
-- ---------------------------------------------------------------------------
ALTER TABLE sessions_v2
  ADD COLUMN IF NOT EXISTS conversation_id TEXT REFERENCES conversations(conversation_id) ON DELETE SET NULL;

ALTER TABLE sessions_v2
  ADD COLUMN IF NOT EXISTS prompt_version TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_v2_conversation_id ON sessions_v2(conversation_id);
CREATE INDEX IF NOT EXISTS idx_sessions_v2_prompt_version  ON sessions_v2(prompt_version);

-- ---------------------------------------------------------------------------
-- 3. Add conversation_id + prompt_version to session_rollups_v2
-- ---------------------------------------------------------------------------
ALTER TABLE session_rollups_v2
  ADD COLUMN IF NOT EXISTS conversation_id TEXT;

ALTER TABLE session_rollups_v2
  ADD COLUMN IF NOT EXISTS prompt_version TEXT;

CREATE INDEX IF NOT EXISTS idx_rollups_v2_conversation_id ON session_rollups_v2(conversation_id);
CREATE INDEX IF NOT EXISTS idx_rollups_v2_prompt_version  ON session_rollups_v2(prompt_version);

-- ---------------------------------------------------------------------------
-- 4. Add final_output column to sessions_v2 (output capture)
-- ---------------------------------------------------------------------------
ALTER TABLE sessions_v2
  ADD COLUMN IF NOT EXISTS final_output TEXT;

-- ---------------------------------------------------------------------------
-- 5. Update session rollup stored procedure to carry new columns
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

  SELECT
    COALESCE(SUM(prompt_tokens),     0) AS prompt_tokens,
    COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
    COALESCE(SUM(total_tokens),      0) AS total_tokens,
    COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
    COALESCE(SUM(reasoning_tokens),  0) AS reasoning_tokens
  INTO v_usage_agg
  FROM usage_facts_v2
  WHERE session_id = p_session_id;

  SELECT COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd
  INTO v_cost_agg
  FROM cost_facts_v2
  WHERE session_id = p_session_id;

  SELECT jsonb_object_agg(
    model_name,
    jsonb_build_object('spans', span_count, 'tokens', token_sum)
  )
  INTO v_model_usage
  FROM (
    SELECT s.model_name, COUNT(*) AS span_count,
           COALESCE(SUM(u.total_tokens), 0) AS token_sum
    FROM spans_v2 s
    LEFT JOIN usage_facts_v2 u ON u.span_id = s.span_id AND u.session_id = p_session_id
    WHERE s.session_id = p_session_id AND s.model_name IS NOT NULL
    GROUP BY s.model_name
  ) m;

  SELECT jsonb_object_agg(
    span_name,
    jsonb_build_object('calls', span_count, 'errors', error_count)
  )
  INTO v_tool_usage
  FROM (
    SELECT s.name AS span_name, COUNT(*) AS span_count,
           COUNT(*) FILTER (WHERE s.status_code = 2) AS error_count
    FROM spans_v2 s
    WHERE s.session_id = p_session_id AND (s.name ILIKE '%tool%' OR s.kind = 4)
    GROUP BY s.name
  ) t;

  SELECT EXISTS (
    SELECT 1 FROM spans_v2 s2
    WHERE s2.session_id = p_session_id
      AND (s2.parent_span_id IS NULL OR s2.parent_span_id = '')
  ) INTO v_is_complete;

  SELECT jsonb_object_agg(status_message, cnt)
  INTO v_error_types
  FROM (
    SELECT status_message, COUNT(*) AS cnt
    FROM spans_v2
    WHERE session_id = p_session_id AND status_code = 2 AND status_message IS NOT NULL
    GROUP BY status_message
  ) e;

  INSERT INTO session_rollups_v2 (
    session_id, org_id, agent_id, agent_version, conversation_id, prompt_version,
    total_spans, llm_spans, tool_spans, error_count,
    prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, reasoning_tokens,
    total_cost_usd, total_duration_ns, model_usage, tool_usage, error_types,
    first_span_at, last_span_at, is_complete, has_error, updated_at
  )
  SELECT
    p_session_id, sv.org_id, sv.agent_id, sv.agent_version, sv.conversation_id, sv.prompt_version,
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
    agent_version     = EXCLUDED.agent_version,
    conversation_id   = EXCLUDED.conversation_id,
    prompt_version    = EXCLUDED.prompt_version,
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
