-- =============================================================================
-- Remi — PostgreSQL schema
-- Enterprise identity layer only: auth, audit, and PII policy.
-- Span/trace/session signal lives in ClickHouse.
-- Idempotent: safe to re-run against an existing database.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. orgs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orgs (
    org_id      TEXT        PRIMARY KEY,
    name        TEXT        NOT NULL,
    plan        TEXT        NOT NULL DEFAULT 'starter'
                            CHECK (plan IN ('starter', 'pro', 'enterprise')),
    settings    JSONB       NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 2. api_keys
-- key_hash = encode(digest(raw_key, 'sha256'), 'hex')
-- Never store the raw key. The caller presents the raw key; we hash and compare.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_keys (
    key_id       TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    org_id       TEXT        NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    key_hash     TEXT        NOT NULL UNIQUE,
    name         TEXT        NOT NULL,
    -- Scopes: admin | read:sessions | read:spans | read:prompts | write:sessions
    scopes       TEXT[]      NOT NULL DEFAULT '{}',
    expires_at   TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_by   TEXT,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_org_id   ON api_keys(org_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);

-- ---------------------------------------------------------------------------
-- 3. audit_log  (append-only — triggers block UPDATE and DELETE)
-- Every read of sensitive span attributes must produce a row here.
-- Tamper-evident: each row's entry_hash = sha256(prev row's entry_hash + row
-- content), chained per org. GET /api/v1/admin/audit-log/verify recomputes the
-- chain; any edited, deleted, or reordered row breaks every hash after it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id            BIGSERIAL   PRIMARY KEY,
    org_id        TEXT        NOT NULL,
    actor_key_id  TEXT,
    action        TEXT        NOT NULL,
    resource_type TEXT,
    resource_id   TEXT,
    ip_address    INET,
    user_agent    TEXT,
    request_id    TEXT,
    metadata      JSONB       NOT NULL DEFAULT '{}',
    prev_hash     TEXT,
    entry_hash    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Existing databases predate the hash chain:
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS prev_hash  TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS entry_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_log_org_id     ON audit_log(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor      ON audit_log(actor_key_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource   ON audit_log(resource_type, resource_id);

CREATE OR REPLACE FUNCTION audit_log_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_log rows are immutable';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update
    BEFORE UPDATE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
CREATE TRIGGER audit_log_no_delete
    BEFORE DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- ---------------------------------------------------------------------------
-- 4. pii_policies
-- One row per org. rules is a JSONB array of {pattern, replacement, fields[]}.
-- The backend syncs these to the OTel Collector's redaction processor config.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pii_policies (
    policy_id  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    org_id     TEXT        NOT NULL UNIQUE REFERENCES orgs(org_id) ON DELETE CASCADE,
    rules      JSONB       NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Dev seed (idempotent)
-- API key: "test-key-123"  →  hash stored, raw key never persisted
-- ---------------------------------------------------------------------------
INSERT INTO orgs (org_id, name, plan)
VALUES ('demo-org', 'Demo Organization', 'enterprise')
ON CONFLICT (org_id) DO NOTHING;

INSERT INTO api_keys (key_id, org_id, key_hash, name, scopes, created_by)
VALUES (
    'key-dev-001',
    'demo-org',
    encode(digest('test-key-123', 'sha256'), 'hex'),
    'Development Key',
    ARRAY['admin', 'read:sessions', 'read:spans', 'read:prompts', 'write:sessions'],
    'system'
) ON CONFLICT (key_id) DO NOTHING;

-- Public live-demo keys for demo-org:
--   demo-view-key   : read-only key baked into the marketing site's "View live
--                     demo" link (read:prompts included — demo data is synthetic)
--   demo-ingest-key : used by the demo-feeder service to keep the org populated
INSERT INTO api_keys (key_id, org_id, key_hash, name, scopes, created_by)
VALUES
    ('key-demo-view',
     'demo-org',
     encode(digest('demo-view-key', 'sha256'), 'hex'),
     'Public Demo Viewer',
     ARRAY['read:sessions', 'read:spans', 'read:prompts'],
     'system'),
    ('key-demo-ingest',
     'demo-org',
     encode(digest('demo-ingest-key', 'sha256'), 'hex'),
     'Demo Feeder Ingest',
     ARRAY['write:sessions'],
     'system')
ON CONFLICT (key_id) DO NOTHING;

INSERT INTO pii_policies (org_id, rules)
VALUES (
    'demo-org',
    '[
        {"pattern": "\\\\b\\\\d{3}-\\\\d{2}-\\\\d{4}\\\\b",      "label": "SSN"},
        {"pattern": "[a-zA-Z0-9._%+\\\\-]+@[a-zA-Z0-9.\\\\-]+\\\\.[a-zA-Z]{2,}", "label": "Email"}
    ]'::JSONB
) ON CONFLICT (org_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Sample org "acme" — the org the example agents and dashboard run against.
-- Two keys with deterministic raw values (DEV ONLY — rotate in production):
--   acme-ingest-key : agents exporting OTLP traces (write:sessions)
--   acme-admin-key  : dashboard / admin surface (all scopes)
-- ---------------------------------------------------------------------------
INSERT INTO orgs (org_id, name, plan)
VALUES ('acme', 'Acme Corp', 'enterprise')
ON CONFLICT (org_id) DO NOTHING;

INSERT INTO api_keys (key_id, org_id, key_hash, name, scopes, created_by)
VALUES
    ('key-acme-ingest',
     'acme',
     encode(digest('acme-ingest-key', 'sha256'), 'hex'),
     'Agent Ingest Key',
     ARRAY['write:sessions'],
     'system'),
    ('key-acme-admin',
     'acme',
     encode(digest('acme-admin-key', 'sha256'), 'hex'),
     'Dashboard Admin Key',
     ARRAY['admin', 'read:sessions', 'read:spans', 'read:prompts', 'write:sessions'],
     'system')
ON CONFLICT (key_id) DO NOTHING;

INSERT INTO pii_policies (org_id, rules)
VALUES (
    'acme',
    '[
        {"pattern": "\\\\b\\\\d{3}-\\\\d{2}-\\\\d{4}\\\\b",      "label": "SSN"},
        {"pattern": "[a-zA-Z0-9._%+\\\\-]+@[a-zA-Z0-9.\\\\-]+\\\\.[a-zA-Z]{2,}", "label": "Email"}
    ]'::JSONB
) ON CONFLICT (org_id) DO NOTHING;
