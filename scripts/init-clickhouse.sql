-- =============================================================================
-- Remi — ClickHouse schema
-- Signal layer: spans, token usage, session rollups.
-- This file runs once on first container start via /docker-entrypoint-initdb.d/.
-- The otelcol-contrib clickhouseexporter will see otel_traces already exists
-- (IF NOT EXISTS) and skip its own creation step.
-- =============================================================================

CREATE DATABASE IF NOT EXISTS remi;

-- ---------------------------------------------------------------------------
-- otel_traces  —  written by the OTel Collector's clickhouseexporter
-- Schema mirrors the exporter's default so create_schema: true is a no-op.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS remi.otel_traces (
    Timestamp          DateTime64(9)                   CODEC(Delta, ZSTD(1)),
    TraceId            String                          CODEC(ZSTD(1)),
    SpanId             String                          CODEC(ZSTD(1)),
    ParentSpanId       String                          CODEC(ZSTD(1)),
    TraceState         String                          CODEC(ZSTD(1)),
    SpanName           LowCardinality(String)          CODEC(ZSTD(1)),
    SpanKind           LowCardinality(String)          CODEC(ZSTD(1)),
    ServiceName        LowCardinality(String)          CODEC(ZSTD(1)),
    ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    ScopeName          String                          CODEC(ZSTD(1)),
    ScopeVersion       String                          CODEC(ZSTD(1)),
    SpanAttributes     Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    Duration           Int64                           CODEC(ZSTD(1)),
    StatusCode         LowCardinality(String)          CODEC(ZSTD(1)),
    StatusMessage      String                          CODEC(ZSTD(1)),
    Events Nested (
        Timestamp  DateTime64(9),
        Name       LowCardinality(String),
        Attributes Map(LowCardinality(String), String)
    ) CODEC(ZSTD(1)),
    Links Nested (
        TraceId    String,
        SpanId     String,
        TraceState String,
        Attributes Map(LowCardinality(String), String)
    ) CODEC(ZSTD(1)),

    -- ── Remi materialized columns ──────────────────────────────────────────
    -- Hot derived values precomputed at insert so dashboard aggregates never
    -- decompress the Map columns (SpanAttributes carries full prompts — reading
    -- it per-row is what makes naive queries slow). The expressions here MUST
    -- stay in sync with the collector attribute names and the queries in
    -- ClickHouseRepository.java, which read these columns instead of the maps.
    OrgId          LowCardinality(String) MATERIALIZED if(notEmpty(ResourceAttributes['remi.org_id']), ResourceAttributes['remi.org_id'], ResourceAttributes['service.namespace']),
    -- Session identity, in priority order:
    --   remi.session_id                                  explicit override (Claude Code transform, power users)
    --   gen_ai.conversation.id                           standard GenAI semconv — LangGraph stamps it on the
    --                                                    invoke_agent ROOT span from configurable.thread_id
    --   traceloop.association.properties.thread_id       same thread_id, as it appears on all CHILD spans
    --   traceloop.association.properties.session_id      LCEL convention: config={"metadata":{"session_id":...}}
    --   TraceId                                          fallback: one invocation = one session
    SessionId      String                 MATERIALIZED multiIf(
                                              notEmpty(SpanAttributes['remi.session_id']), SpanAttributes['remi.session_id'],
                                              notEmpty(SpanAttributes['gen_ai.conversation.id']), SpanAttributes['gen_ai.conversation.id'],
                                              notEmpty(SpanAttributes['traceloop.association.properties.thread_id']), SpanAttributes['traceloop.association.properties.thread_id'],
                                              notEmpty(SpanAttributes['traceloop.association.properties.session_id']), SpanAttributes['traceloop.association.properties.session_id'],
                                              TraceId),
    Model          LowCardinality(String) MATERIALIZED SpanAttributes['gen_ai.request.model'],
    Provider       LowCardinality(String) MATERIALIZED if(notEmpty(SpanAttributes['gen_ai.system']), SpanAttributes['gen_ai.system'], SpanAttributes['gen_ai.provider.name']),
    ServiceVersion LowCardinality(String) MATERIALIZED ResourceAttributes['service.version'],
    InputTokens    UInt64                 MATERIALIZED toUInt64OrZero(SpanAttributes['gen_ai.usage.input_tokens']),
    OutputTokens   UInt64                 MATERIALIZED toUInt64OrZero(SpanAttributes['gen_ai.usage.output_tokens']),
    CacheTokens    UInt64                 MATERIALIZED toUInt64OrZero(SpanAttributes['gen_ai.usage.cache_read_input_tokens']),

    INDEX idx_org             OrgId                         TYPE set(100)            GRANULARITY 1,
    INDEX idx_session         SessionId                     TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_trace_id        TraceId                       TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_res_attr_key    mapKeys(ResourceAttributes)   TYPE bloom_filter(0.01)  GRANULARITY 1,
    INDEX idx_res_attr_value  mapValues(ResourceAttributes) TYPE bloom_filter(0.01)  GRANULARITY 1,
    INDEX idx_span_attr_key   mapKeys(SpanAttributes)       TYPE bloom_filter(0.01)  GRANULARITY 1,
    INDEX idx_span_attr_value mapValues(SpanAttributes)     TYPE bloom_filter(0.01)  GRANULARITY 1,
    INDEX idx_duration        Duration                      TYPE minmax              GRANULARITY 1
)
ENGINE = MergeTree()
PARTITION BY toDate(Timestamp)
ORDER BY (ServiceName, SpanName, toUnixTimestamp(Timestamp), TraceId)
TTL toDateTime(Timestamp) + toIntervalDay(180)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- ---------------------------------------------------------------------------
-- remi_span_analysis  —  LLM-as-judge verdicts, persisted for audit.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS remi.remi_span_analysis (
    org_id      String,
    session_id  String,
    span_id     String,
    model_used  String,
    analysis    String,
    created_at  DateTime64(3) DEFAULT now64(3)
)
ENGINE = MergeTree()
ORDER BY (org_id, span_id, created_at);

-- ---------------------------------------------------------------------------
-- remi_session_rollup  —  per-session counters, summed by SummingMergeTree
-- session_id  = COALESCE(gen_ai.conversation.id, TraceId)
-- org_id      = remi.org_id resource attribute (stamped by the collector from
--               the validated ingest key), falling back to service.namespace
--               for pre-auth spans
-- agent_id    = ResourceAttributes['service.name']
--
-- Read with: SELECT session_id, sum(span_count) ... GROUP BY session_id
-- or:        SELECT * FROM remi_session_rollup FINAL
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS remi.remi_session_rollup (
    session_id      String,
    org_id          String,
    agent_id        String,
    span_count      UInt64,
    error_count     UInt64,
    input_tokens    UInt64,
    output_tokens   UInt64,
    total_duration_ms Int64
)
ENGINE = SummingMergeTree()
ORDER BY (org_id, session_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS remi.remi_session_rollup_mv
TO remi.remi_session_rollup
AS
SELECT
    multiIf(notEmpty(SpanAttributes['remi.session_id']), SpanAttributes['remi.session_id'],
            notEmpty(SpanAttributes['gen_ai.conversation.id']), SpanAttributes['gen_ai.conversation.id'],
            TraceId)                                                       AS session_id,
    if(notEmpty(ResourceAttributes['remi.org_id']),
       ResourceAttributes['remi.org_id'],
       ResourceAttributes['service.namespace'])                           AS org_id,
    ResourceAttributes['service.name']                                    AS agent_id,
    toUInt64(1)                                                           AS span_count,
    toUInt64(if(StatusCode = 'STATUS_CODE_ERROR', 1, 0))                  AS error_count,
    toUInt64OrZero(SpanAttributes['gen_ai.usage.input_tokens'])           AS input_tokens,
    toUInt64OrZero(SpanAttributes['gen_ai.usage.output_tokens'])          AS output_tokens,
    toInt64(Duration / 1000000)                                           AS total_duration_ms
FROM remi.otel_traces;

-- ---------------------------------------------------------------------------
-- remi_model_daily  —  per-model token counts, summed per day
-- Read with: SELECT model, sum(input_tokens) ... GROUP BY model, date
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS remi.remi_model_daily (
    date          Date,
    org_id        String,
    provider      String,
    model         String,
    input_tokens  UInt64,
    output_tokens UInt64,
    span_count    UInt64
)
ENGINE = SummingMergeTree()
ORDER BY (org_id, model, date);

CREATE MATERIALIZED VIEW IF NOT EXISTS remi.remi_model_daily_mv
TO remi.remi_model_daily
AS
SELECT
    toDate(Timestamp)                              AS date,
    if(notEmpty(ResourceAttributes['remi.org_id']),
       ResourceAttributes['remi.org_id'],
       ResourceAttributes['service.namespace'])    AS org_id,
    SpanAttributes['gen_ai.system']                AS provider,
    SpanAttributes['gen_ai.request.model']         AS model,
    toUInt64OrZero(SpanAttributes['gen_ai.usage.input_tokens'])   AS input_tokens,
    toUInt64OrZero(SpanAttributes['gen_ai.usage.output_tokens'])  AS output_tokens,
    toUInt64(1)                                    AS span_count
FROM remi.otel_traces
WHERE notEmpty(SpanAttributes['gen_ai.request.model']);

-- ---------------------------------------------------------------------------
-- otel_metrics_gauge / otel_metrics_sum
--   Written by the OTel Collector's clickhouseexporter (metrics pipeline) —
--   agent CPU/memory from opentelemetry-instrumentation-system-metrics.
--
--   Same deal as otel_traces: the column list mirrors the exporter's default so
--   create_schema: true is a no-op, PLUS the two Remi materialized columns.
--   Without them every org-scoped metrics query had to decompress the
--   ResourceAttributes Map for each row — measured 234ms vs 26ms (9x) on 560k
--   gauge rows for the version-comparison query. ClickHouseRepository reads
--   OrgId/ServiceVersion and must never re-derive them from the map.
--
--   Coupling: the non-Remi columns track otelcol-contrib 0.105.0 (pinned in
--   docker-compose.yml). If that image is bumped and the exporter adds a
--   column, add it here too — IF NOT EXISTS means our definition wins and the
--   exporter would otherwise fail to insert.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS remi.otel_metrics_gauge (
    ResourceAttributes            Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    ResourceSchemaUrl             String                              CODEC(ZSTD(1)),
    ScopeName                     String                              CODEC(ZSTD(1)),
    ScopeVersion                  String                              CODEC(ZSTD(1)),
    ScopeAttributes               Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    ScopeDroppedAttrCount         UInt32                              CODEC(ZSTD(1)),
    ScopeSchemaUrl                String                              CODEC(ZSTD(1)),
    ServiceName                   LowCardinality(String)              CODEC(ZSTD(1)),
    MetricName                    String                              CODEC(ZSTD(1)),
    MetricDescription             String                              CODEC(ZSTD(1)),
    MetricUnit                    String                              CODEC(ZSTD(1)),
    Attributes                    Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    StartTimeUnix                 DateTime64(9)                       CODEC(Delta(8), ZSTD(1)),
    TimeUnix                      DateTime64(9)                       CODEC(Delta(8), ZSTD(1)),
    Value                         Float64                             CODEC(ZSTD(1)),
    Flags                         UInt32                              CODEC(ZSTD(1)),
    `Exemplars.FilteredAttributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
    `Exemplars.TimeUnix`           Array(DateTime64(9))               CODEC(ZSTD(1)),
    `Exemplars.Value`              Array(Float64)                     CODEC(ZSTD(1)),
    `Exemplars.SpanId`             Array(String)                      CODEC(ZSTD(1)),
    `Exemplars.TraceId`            Array(String)                      CODEC(ZSTD(1)),

    -- ── Remi materialized columns (mirror otel_traces) ─────────────────────
    OrgId          LowCardinality(String) MATERIALIZED if(notEmpty(ResourceAttributes['remi.org_id']), ResourceAttributes['remi.org_id'], ResourceAttributes['service.namespace']),
    ServiceVersion LowCardinality(String) MATERIALIZED ResourceAttributes['service.version'],

    INDEX idx_org             OrgId                         TYPE set(100)           GRANULARITY 1,
    INDEX idx_res_attr_key    mapKeys(ResourceAttributes)   TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_res_attr_value  mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_scope_attr_key  mapKeys(ScopeAttributes)      TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_scope_attr_value mapValues(ScopeAttributes)   TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_attr_key        mapKeys(Attributes)           TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_attr_value      mapValues(Attributes)         TYPE bloom_filter(0.01) GRANULARITY 1
)
ENGINE = MergeTree()
PARTITION BY toDate(TimeUnix)
ORDER BY (ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE TABLE IF NOT EXISTS remi.otel_metrics_sum (
    ResourceAttributes            Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    ResourceSchemaUrl             String                              CODEC(ZSTD(1)),
    ScopeName                     String                              CODEC(ZSTD(1)),
    ScopeVersion                  String                              CODEC(ZSTD(1)),
    ScopeAttributes               Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    ScopeDroppedAttrCount         UInt32                              CODEC(ZSTD(1)),
    ScopeSchemaUrl                String                              CODEC(ZSTD(1)),
    ServiceName                   LowCardinality(String)              CODEC(ZSTD(1)),
    MetricName                    String                              CODEC(ZSTD(1)),
    MetricDescription             String                              CODEC(ZSTD(1)),
    MetricUnit                    String                              CODEC(ZSTD(1)),
    Attributes                    Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    StartTimeUnix                 DateTime64(9)                       CODEC(Delta(8), ZSTD(1)),
    TimeUnix                      DateTime64(9)                       CODEC(Delta(8), ZSTD(1)),
    Value                         Float64                             CODEC(ZSTD(1)),
    Flags                         UInt32                              CODEC(ZSTD(1)),
    `Exemplars.FilteredAttributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
    `Exemplars.TimeUnix`           Array(DateTime64(9))               CODEC(ZSTD(1)),
    `Exemplars.Value`              Array(Float64)                     CODEC(ZSTD(1)),
    `Exemplars.SpanId`             Array(String)                      CODEC(ZSTD(1)),
    `Exemplars.TraceId`            Array(String)                      CODEC(ZSTD(1)),
    AggregationTemporality        Int32                               CODEC(ZSTD(1)),
    IsMonotonic                   Bool                                CODEC(Delta(1), ZSTD(1)),

    -- ── Remi materialized columns (mirror otel_traces) ─────────────────────
    OrgId          LowCardinality(String) MATERIALIZED if(notEmpty(ResourceAttributes['remi.org_id']), ResourceAttributes['remi.org_id'], ResourceAttributes['service.namespace']),
    ServiceVersion LowCardinality(String) MATERIALIZED ResourceAttributes['service.version'],

    INDEX idx_org             OrgId                         TYPE set(100)           GRANULARITY 1,
    INDEX idx_res_attr_key    mapKeys(ResourceAttributes)   TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_res_attr_value  mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_scope_attr_key  mapKeys(ScopeAttributes)      TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_scope_attr_value mapValues(ScopeAttributes)   TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_attr_key        mapKeys(Attributes)           TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_attr_value      mapValues(Attributes)         TYPE bloom_filter(0.01) GRANULARITY 1
)
ENGINE = MergeTree()
PARTITION BY toDate(TimeUnix)
ORDER BY (ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- ---------------------------------------------------------------------------
-- otel_logs  —  written by the OTel Collector's clickhouseexporter (logs pipeline)
-- Retained for optional log ingestion. With Claude Code Traces beta enabled,
-- sessions are built from real spans (otel_traces), so there is NO logs->traces
-- materialized view (that would double-count). Pre-created so create_schema is a no-op.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS remi.otel_logs (
    Timestamp          DateTime64(9)                        CODEC(Delta(8), ZSTD(1)),
    TimestampDate      Date DEFAULT toDate(Timestamp),
    TimestampTime      DateTime DEFAULT toDateTime(Timestamp),
    TraceId            String                               CODEC(ZSTD(1)),
    SpanId             String                               CODEC(ZSTD(1)),
    TraceFlags         UInt8,
    SeverityText       LowCardinality(String)               CODEC(ZSTD(1)),
    SeverityNumber     UInt8,
    ServiceName        LowCardinality(String)               CODEC(ZSTD(1)),
    Body               String                               CODEC(ZSTD(1)),
    ResourceSchemaUrl  LowCardinality(String)               CODEC(ZSTD(1)),
    ResourceAttributes Map(LowCardinality(String), String)  CODEC(ZSTD(1)),
    ScopeSchemaUrl     LowCardinality(String)               CODEC(ZSTD(1)),
    ScopeName          String                               CODEC(ZSTD(1)),
    ScopeVersion       LowCardinality(String)               CODEC(ZSTD(1)),
    ScopeAttributes    Map(LowCardinality(String), String)  CODEC(ZSTD(1)),
    LogAttributes      Map(LowCardinality(String), String)  CODEC(ZSTD(1)),
    INDEX idx_log_attr_key   mapKeys(LogAttributes)   TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_log_attr_value mapValues(LogAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_body Body TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(TimestampDate)
ORDER BY (ServiceName, TimestampDate, TimestampTime)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;
