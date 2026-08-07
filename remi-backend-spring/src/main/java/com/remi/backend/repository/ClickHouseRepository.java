package com.remi.backend.repository;

import com.remi.backend.dto.Analytics;
import com.remi.backend.dto.ModelStat;
import com.remi.backend.dto.ToolStat;
import com.remi.backend.dto.VersionStats;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.temporal.ChronoUnit;
import java.util.*;

@Repository
public class ClickHouseRepository {

    // All hot derived values (OrgId, SessionId, Model, Provider, ServiceVersion,
    // token counts) are MATERIALIZED columns on otel_traces — computed once at
    // insert so aggregates never decompress the Map columns (SpanAttributes
    // carries full prompts; reading it per-row is what made naive queries slow).
    // The defining expressions live in scripts/init-clickhouse.sql — change them
    // there, not by re-deriving from the maps here.

    // A session is considered "complete" once no span has arrived for this long,
    // unless a stronger end signal exists (see HAS_END_SIGNAL).
    private static final String IDLE_CUTOFF = "now() - INTERVAL 2 MINUTE";

    // A session is complete the moment its invocation's ROOT span lands: spans
    // only export after they end, so a present root (empty ParentSpanId) means
    // the top-level invoke returned — no agent-side code needed. An explicit
    // remi.session.end marker span is also honored for sources whose roots never
    // close (e.g. streaming servers). ponytail: multi-turn sessions read
    // 'complete' between turns; the idle cutoff remains only as the fallback for
    // root-less exporters.
    private static final String HAS_END_SIGNAL =
            "(countIf(empty(ParentSpanId)) + countIf(SpanName = 'remi.session.end')) > 0";

    /**
     * An LLM span that counts as a latency measurement. The duration ceiling is
     * not a "slow call" filter — a span lasting hours is one whose end never got
     * recorded (hung request, killed process, retry loop held open), and feeding
     * it to a mean reports a number no user ever experienced. Observed in the
     * demo org: one 33-hour errored span pulled the org-wide average from 1.9s
     * to 14.4s, i.e. above its own p95.
     *
     * ponytail: a flat ceiling, not outlier detection. 10 min is far above any
     * real completion (p99 here is ~10s) and far below a stuck span. If agents
     * ever legitimately run longer, raise it — this is a calibration knob.
     */
    private static final String LLM_MEASURABLE =
            "notEmpty(Model) AND Duration < 600000000000";

    private static final String AVG_LLM_LATENCY =
            "round(avgIf(Duration / 1000000, " + LLM_MEASURABLE + "))";

    private static final String P95_LLM_LATENCY =
            "round(quantileIf(0.95)(Duration / 1000000, " + LLM_MEASURABLE + "))";

    private static final String VERSION_EXPR =
            "if(notEmpty(ServiceVersion), ServiceVersion, 'unversioned')";

    private final NamedParameterJdbcTemplate jdbc;

    public ClickHouseRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ── Session ─────────────────────────────────────────────────────────────────

    public record SessionRow(
            String sessionId, String orgId, String agentId,
            long spanCount, long llmCalls, long toolCalls, long errorCount,
            long inputTokens, long outputTokens, long cacheTokens,
            String startedAt, String endedAt,
            String primaryModel, String status, long durationMs,
            long avgLlmLatencyMs) {}

    public record ListResult<T>(List<T> rows, long total) {}

    private static SessionRow mapSessionRow(ResultSet rs) throws SQLException {
        return new SessionRow(
                rs.getString("session_id"),
                nullToEmpty(rs.getString("org_id")),
                nullToEmpty(rs.getString("agent_id")),
                rs.getLong("span_count"),
                rs.getLong("llm_calls"),
                rs.getLong("tool_calls"),
                rs.getLong("error_count"),
                rs.getLong("input_tokens"),
                rs.getLong("output_tokens"),
                rs.getLong("cache_tokens"),
                toIso(rs.getTimestamp("started_at")),
                toIso(rs.getTimestamp("ended_at")),
                rs.getString("primary_model"),
                rs.getString("status"),
                rs.getLong("duration_ms"),
                rs.getLong("avg_llm_latency_ms"));
    }

    private static final String SESSION_SELECT = """
            SELECT
                SessionId                                                                      AS session_id,
                anyLast(OrgId)                                                                 AS org_id,
                anyLast(ServiceName)                                                           AS agent_id,
                count()                                                                        AS span_count,
                countIf(notEmpty(Model))                                                       AS llm_calls,
                countIf(SpanKind = 'SPAN_KIND_CLIENT' AND empty(Model))                        AS tool_calls,
                countIf(StatusCode = 'STATUS_CODE_ERROR')                                      AS error_count,
                sum(InputTokens)                                                               AS input_tokens,
                sum(OutputTokens)                                                              AS output_tokens,
                sum(CacheTokens)                                                               AS cache_tokens,
                min(Timestamp)                                                                 AS started_at,
                max(Timestamp)                                                                 AS ended_at,
                nullIf(anyLastIf(Model, notEmpty(Model)), '')                                  AS primary_model,
                multiIf(
                    countIf(StatusCode = 'STATUS_CODE_ERROR') > 0, 'error',
                    %s, 'complete',
                    max(Timestamp) < %s, 'complete',
                    'running'
                )                                                                              AS status,
                toInt64(dateDiff('millisecond', min(Timestamp), max(Timestamp)))               AS duration_ms,
                %s                                                                             AS avg_llm_latency_ms
            FROM otel_traces
            """.formatted(HAS_END_SIGNAL, IDLE_CUTOFF, AVG_LLM_LATENCY);

    public ListResult<SessionRow> listSessions(
            String orgId, String agentId,
            String startDate, String endDate,
            String status,
            int limit, int offset) {

        var params = new MapSqlParameterSource();
        params.addValue("limit", limit);
        params.addValue("offset", offset);

        String where = buildScopeWhere(params, orgId, agentId, startDate, endDate);
        String noError = "countIf(StatusCode = 'STATUS_CODE_ERROR') = 0";
        String done = "(" + HAS_END_SIGNAL + " OR max(Timestamp) < " + IDLE_CUTOFF + ")";
        String having = switch (status != null ? status : "") {
            case "error"    -> "HAVING countIf(StatusCode = 'STATUS_CODE_ERROR') > 0";
            case "complete" -> "HAVING " + noError + " AND " + done;
            case "running"  -> "HAVING " + noError + " AND NOT " + done;
            default -> "";
        };

        String baseQuery = SESSION_SELECT
                + "WHERE " + where + "\n"
                + "GROUP BY session_id"
                + (having.isEmpty() ? "" : "\n" + having);

        List<SessionRow> rows = jdbc.query(
                baseQuery + "\nORDER BY started_at DESC LIMIT :limit OFFSET :offset",
                params,
                (rs, i) -> mapSessionRow(rs));

        List<Map<String, Object>> countRows = jdbc.queryForList(
                "SELECT count() AS total FROM (" + baseQuery + ")",
                params);
        long total = countRows.isEmpty() ? 0L : toLong(countRows.get(0).get("total"));

        return new ListResult<>(rows, total);
    }

    public Optional<SessionRow> getSession(String orgId, String sessionId) {
        var params = new MapSqlParameterSource()
                .addValue("session_id", sessionId)
                .addValue("org_id", orgId);
        List<SessionRow> rows = jdbc.query(
                SESSION_SELECT
                + "WHERE SessionId = :session_id AND OrgId = :org_id\n"
                + "GROUP BY session_id",
                params,
                (rs, i) -> mapSessionRow(rs));
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    /**
     * Runtime environment of the session's exporter: full resource attributes
     * (host.*, os.*, process.*, telemetry.sdk.*, service.version, …).
     */
    @SuppressWarnings("unchecked")
    public Map<String, String> getSessionResource(String orgId, String sessionId) {
        var params = new MapSqlParameterSource()
                .addValue("session_id", sessionId)
                .addValue("org_id", orgId);
        List<Map<String, String>> rows = jdbc.query("""
                SELECT anyLast(ResourceAttributes) AS resource
                FROM otel_traces
                WHERE SessionId = :session_id AND OrgId = :org_id
                """,
                params,
                (rs, i) -> (Map<String, String>) rs.getObject("resource"));
        return rows.isEmpty() || rows.get(0) == null ? Map.of() : rows.get(0);
    }

    public Map<String, ModelStat> getModelUsage(String orgId, String sessionId) {
        var params = new MapSqlParameterSource()
                .addValue("session_id", sessionId)
                .addValue("org_id", orgId);
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT
                    Model                                       AS model_name,
                    count()                                     AS calls,
                    sum(InputTokens)                            AS input_tokens,
                    sum(OutputTokens)                           AS output_tokens,
                    sum(CacheTokens)                            AS cache_tokens,
                    round(avg(Duration / 1000000))              AS avg_latency_ms
                FROM otel_traces
                WHERE SessionId = :session_id
                  AND OrgId = :org_id
                  AND notEmpty(Model)
                GROUP BY model_name
                ORDER BY input_tokens DESC
                """,
                params);

        Map<String, ModelStat> result = new LinkedHashMap<>();
        for (var row : rows) {
            String model = (String) row.get("model_name");
            if (model != null && !model.isEmpty()) {
                result.put(model, new ModelStat(
                        toLong(row.get("calls")),
                        toLong(row.get("input_tokens")),
                        toLong(row.get("output_tokens")),
                        toLong(row.get("cache_tokens")),
                        toLong(row.get("avg_latency_ms"))));
            }
        }
        return result;
    }

    public Map<String, ToolStat> getToolUsage(String orgId, String sessionId) {
        var params = new MapSqlParameterSource()
                .addValue("session_id", sessionId)
                .addValue("org_id", orgId);
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT
                    SpanName                                    AS tool,
                    count()                                     AS calls,
                    countIf(StatusCode = 'STATUS_CODE_ERROR')   AS errors
                FROM otel_traces
                WHERE SessionId = :session_id
                  AND OrgId = :org_id
                  AND SpanKind = 'SPAN_KIND_CLIENT'
                  AND empty(Model)
                GROUP BY tool
                ORDER BY calls DESC
                """,
                params);

        Map<String, ToolStat> result = new LinkedHashMap<>();
        for (var row : rows) {
            String tool = (String) row.get("tool");
            if (tool != null && !tool.isEmpty()) {
                result.put(tool, new ToolStat(
                        toLong(row.get("calls")),
                        toLong(row.get("errors"))));
            }
        }
        return result;
    }

    public void deleteSession(String orgId, String sessionId) {
        var params = new MapSqlParameterSource()
                .addValue("session_id", sessionId)
                .addValue("org_id", orgId);
        jdbc.update(
                "ALTER TABLE otel_traces DELETE WHERE SessionId = :session_id AND OrgId = :org_id",
                params);
    }

    // ── System metrics (OTLP metrics pipeline: gauges + sums) ───────────────────

    public record MetricPoint(String metric, String state, String timestamp, double value) {}

    /**
     * Time series for a service within a window — CPU/memory/runtime metrics
     * emitted by the agent's OTLP metrics exporter. Gauges and cumulative sums
     * both land here; the UI decides how to render each metric name.
     */
    public List<MetricPoint> getSystemMetrics(
            String orgId, String serviceName, String fromIso, String toIso) {

        var params = new MapSqlParameterSource()
                .addValue("org_id", orgId)
                .addValue("service", serviceName)
                .addValue("from", fromIso)
                .addValue("to", toIso);

        String orgFilter =
                "(ResourceAttributes['remi.org_id'] = :org_id OR ResourceAttributes['service.namespace'] = :org_id)";

        String query = """
                SELECT MetricName, Attributes['state'] AS state, TimeUnix, Value
                FROM (
                    SELECT MetricName, Attributes, TimeUnix, Value, ResourceAttributes, ServiceName
                    FROM otel_metrics_gauge
                    UNION ALL
                    SELECT MetricName, Attributes, TimeUnix, Value, ResourceAttributes, ServiceName
                    FROM otel_metrics_sum
                )
                WHERE %s
                  AND ServiceName = :service
                  AND TimeUnix >= parseDateTime64BestEffort(:from)
                  AND TimeUnix <= parseDateTime64BestEffort(:to)
                ORDER BY MetricName, TimeUnix ASC
                LIMIT 20000
                """.formatted(orgFilter);

        return jdbc.query(query, params, (rs, i) -> new MetricPoint(
                rs.getString("MetricName"),
                nullToEmpty(rs.getString("state")),
                toIso(rs.getTimestamp("TimeUnix")),
                rs.getDouble("Value")));
    }

    // ── Analytics ───────────────────────────────────────────────────────────────

    public Analytics getAnalytics(
            String orgId, String agentId, String startDate, String endDate, int days) {

        var params = new MapSqlParameterSource();
        if (startDate == null && endDate == null) {
            startDate = java.time.LocalDate.now().minusDays(days).toString();
        }
        String where = buildScopeWhere(params, orgId, agentId, startDate, endDate);
        String whereClause = "WHERE " + where;

        // Totals
        List<Map<String, Object>> totalRows = jdbc.queryForList("""
                SELECT
                    count(DISTINCT SessionId)                                                      AS sessions,
                    countIf(notEmpty(Model))                                                       AS llm_calls,
                    sum(InputTokens)                                                               AS input_tokens,
                    sum(OutputTokens)                                                              AS output_tokens,
                    sum(CacheTokens)                                                               AS cache_tokens,
                    uniqExactIf(SessionId, StatusCode = 'STATUS_CODE_ERROR')                       AS error_sessions,
                    %s                                                                             AS avg_llm_latency_ms,
                    %s                                                                             AS p95_llm_latency_ms
                FROM otel_traces
                %s
                """.formatted(AVG_LLM_LATENCY, P95_LLM_LATENCY, whereClause),
                params);

        long sessions = 0, llmCalls = 0, inputTokens = 0, outputTokens = 0, cacheTokens = 0, errorSessions = 0;
        long avgLlmLatencyMs = 0, p95LlmLatencyMs = 0;
        if (!totalRows.isEmpty()) {
            var row = totalRows.get(0);
            sessions        = toLong(row.get("sessions"));
            llmCalls        = toLong(row.get("llm_calls"));
            inputTokens     = toLong(row.get("input_tokens"));
            outputTokens    = toLong(row.get("output_tokens"));
            cacheTokens     = toLong(row.get("cache_tokens"));
            errorSessions   = toLong(row.get("error_sessions"));
            avgLlmLatencyMs = toLong(row.get("avg_llm_latency_ms"));
            p95LlmLatencyMs = toLong(row.get("p95_llm_latency_ms"));
        }
        double errorRate = sessions > 0 ? (double) errorSessions / sessions : 0.0;
        var totals = new Analytics.Totals(sessions, llmCalls, inputTokens, outputTokens, cacheTokens,
                errorSessions, errorRate, avgLlmLatencyMs, p95LlmLatencyMs);

        // Daily time series
        List<Map<String, Object>> dailyRows = jdbc.queryForList("""
                SELECT
                    toDate(Timestamp)                                                              AS date,
                    count(DISTINCT SessionId)                                                      AS sessions,
                    countIf(notEmpty(Model))                                                       AS llm_calls,
                    sum(InputTokens)                                                               AS input_tokens,
                    sum(OutputTokens)                                                              AS output_tokens,
                    countIf(StatusCode = 'STATUS_CODE_ERROR')                                      AS errors,
                    %s                                                                             AS avg_llm_latency_ms
                FROM otel_traces
                %s
                GROUP BY date
                ORDER BY date ASC
                """.formatted(AVG_LLM_LATENCY, whereClause),
                params);

        List<Analytics.DailyStats> daily = dailyRows.stream()
                .map(r -> new Analytics.DailyStats(
                        String.valueOf(r.get("date")),
                        toLong(r.get("sessions")),
                        toLong(r.get("llm_calls")),
                        toLong(r.get("input_tokens")),
                        toLong(r.get("output_tokens")),
                        toLong(r.get("errors")),
                        toLong(r.get("avg_llm_latency_ms"))))
                .toList();

        // Per-model breakdown
        String modelWhereClause = whereClause + " AND notEmpty(Model)";

        List<Map<String, Object>> modelRows = jdbc.queryForList("""
                SELECT
                    Model                                       AS model_name,
                    anyLastIf(Provider, notEmpty(Provider))     AS provider,
                    count()                                     AS calls,
                    sum(InputTokens)                            AS input_tokens,
                    sum(OutputTokens)                           AS output_tokens,
                    sum(CacheTokens)                            AS cache_tokens,
                    round(avg(Duration / 1000000))              AS avg_latency_ms
                FROM otel_traces
                %s
                GROUP BY model_name
                ORDER BY input_tokens DESC
                """.formatted(modelWhereClause),
                params);

        List<Analytics.ModelStats> models = modelRows.stream()
                .map(r -> new Analytics.ModelStats(
                        (String) r.get("model_name"),
                        nullToEmpty((String) r.get("provider")),
                        toLong(r.get("calls")),
                        toLong(r.get("input_tokens")),
                        toLong(r.get("output_tokens")),
                        toLong(r.get("cache_tokens")),
                        toLong(r.get("avg_latency_ms"))))
                .toList();

        // Per-agent breakdown
        List<Map<String, Object>> agentRows = jdbc.queryForList("""
                SELECT
                    ServiceName                                 AS agent,
                    count(DISTINCT SessionId)                   AS sessions,
                    countIf(StatusCode = 'STATUS_CODE_ERROR')   AS errors,
                    sum(InputTokens + OutputTokens)             AS total_tokens,
                    %s                                          AS avg_llm_latency_ms
                FROM otel_traces
                %s
                GROUP BY agent
                HAVING notEmpty(agent)
                ORDER BY sessions DESC
                """.formatted(AVG_LLM_LATENCY, whereClause),
                params);

        List<Analytics.AgentStats> agents = agentRows.stream()
                .map(r -> new Analytics.AgentStats(
                        (String) r.get("agent"),
                        toLong(r.get("sessions")),
                        toLong(r.get("errors")),
                        toLong(r.get("total_tokens")),
                        toLong(r.get("avg_llm_latency_ms"))))
                .toList();

        return new Analytics(days + "d", totals, daily, models, agents);
    }

    // ── Version comparison (service.version regression view) ───────────────────

    public List<VersionStats> getVersionComparison(String orgId, String agentId) {
        var params = new MapSqlParameterSource();
        String where = "WHERE " + buildScopeWhere(params, orgId, agentId, null, null);

        // Keyed by (agent, version): a release comparison is only meaningful
        // within one agent, and two agents sharing a version string must not merge.
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT
                    ServiceName                                                                    AS agent,
                    %s                                                                             AS version,
                    count(DISTINCT SessionId)                                                      AS sessions,
                    countIf(notEmpty(Model))                                                       AS llm_calls,
                    uniqExactIf(SessionId, StatusCode = 'STATUS_CODE_ERROR')                       AS error_sessions,
                    %s                                                                             AS avg_llm_latency_ms,
                    %s                                                                             AS p95_llm_latency_ms,
                    sum(InputTokens + OutputTokens)                                                AS total_tokens,
                    min(Timestamp)                                                                 AS first_seen,
                    max(Timestamp)                                                                 AS last_seen
                FROM otel_traces
                %s
                GROUP BY agent, version
                HAVING notEmpty(agent)
                ORDER BY agent ASC, last_seen DESC
                LIMIT 200
                """.formatted(VERSION_EXPR, AVG_LLM_LATENCY, P95_LLM_LATENCY, where),
                params);

        // Judge verdicts per (agent, version): map each analyzed span back to the
        // agent+version its trace resource carried.
        List<Map<String, Object>> judgeRows = jdbc.queryForList("""
                SELECT
                    t.agent                                                                         AS agent,
                    t.version                                                                       AS version,
                    count()                                                                         AS verdicts,
                    round(avg(JSONExtractFloat(a.analysis, 'scores', 'correctness')), 1)            AS correctness,
                    round(avg(JSONExtractFloat(a.analysis, 'scores', 'instruction_adherence')), 1)  AS adherence,
                    round(avg(JSONExtractFloat(a.analysis, 'scores', 'tool_use_quality')), 1)       AS tool_quality
                FROM remi_span_analysis AS a
                INNER JOIN (
                    SELECT DISTINCT SpanId, ServiceName AS agent, %s AS version
                    FROM otel_traces
                    WHERE OrgId = :org_id
                ) AS t ON a.span_id = t.SpanId
                WHERE a.org_id = :org_id
                GROUP BY agent, version
                """.formatted(VERSION_EXPR),
                new MapSqlParameterSource("org_id", orgId));

        // System metrics per (agent, version): CPU utilization (gauge) and peak
        // RSS (sum table — the SDK exports process.memory.usage as a
        // cumulative-style sum). Resource regressions between releases show here.
        List<Map<String, Object>> sysRows = jdbc.queryForList("""
                SELECT
                    ServiceName                                                                     AS agent,
                    if(notEmpty(ResourceAttributes['service.version']),
                       ResourceAttributes['service.version'], 'unversioned')                        AS version,
                    round(avgIf(Value, MetricName = 'process.cpu.utilization') * 100, 2)            AS avg_cpu_pct,
                    maxIf(Value, MetricName = 'process.memory.usage')                               AS max_rss_bytes
                FROM (
                    SELECT MetricName, Value, ResourceAttributes, ServiceName FROM otel_metrics_gauge
                    UNION ALL
                    SELECT MetricName, Value, ResourceAttributes, ServiceName FROM otel_metrics_sum
                )
                WHERE (ResourceAttributes['remi.org_id'] = :org_id
                       OR ResourceAttributes['service.namespace'] = :org_id)
                  AND MetricName IN ('process.cpu.utilization', 'process.memory.usage')
                GROUP BY agent, version
                """,
                new MapSqlParameterSource("org_id", orgId));

        Map<String, Map<String, Object>> judgeByKey = new HashMap<>();
        for (var r : judgeRows) judgeByKey.put(r.get("agent") + "\0" + r.get("version"), r);
        Map<String, Map<String, Object>> sysByKey = new HashMap<>();
        for (var r : sysRows) sysByKey.put(r.get("agent") + "\0" + r.get("version"), r);

        return rows.stream().map(r -> {
            long sessions = toLong(r.get("sessions"));
            long errorSessions = toLong(r.get("error_sessions"));
            String key = r.get("agent") + "\0" + r.get("version");
            var judge = judgeByKey.get(key);
            var sys = sysByKey.get(key);
            Double cpu = sys != null ? toFiniteDouble(sys.get("avg_cpu_pct")) : null;
            Long rss = null;
            if (sys != null) {
                Double raw = toFiniteDouble(sys.get("max_rss_bytes"));
                if (raw != null && raw > 0) rss = raw.longValue();
            }
            return new VersionStats(
                    (String) r.get("agent"),
                    (String) r.get("version"),
                    sessions,
                    toLong(r.get("llm_calls")),
                    errorSessions,
                    sessions > 0 ? (double) errorSessions / sessions : 0.0,
                    toLong(r.get("avg_llm_latency_ms")),
                    toLong(r.get("p95_llm_latency_ms")),
                    toLong(r.get("total_tokens")),
                    cpu,
                    rss,
                    judge != null ? toLong(judge.get("verdicts")) : 0L,
                    judge != null ? toFiniteDouble(judge.get("correctness")) : null,
                    judge != null ? toFiniteDouble(judge.get("adherence")) : null,
                    judge != null ? toFiniteDouble(judge.get("tool_quality")) : null,
                    String.valueOf(r.get("first_seen")),
                    String.valueOf(r.get("last_seen")));
        }).toList();
    }

    /**
     * Random LLM spans of one agent's version that have no judge verdict yet —
     * candidates for the version view's "judge a sample" action.
     */
    public List<Map<String, Object>> pickUnjudgedLlmSpans(String orgId, String agent, String version, int limit) {
        var params = new MapSqlParameterSource()
                .addValue("org_id", orgId)
                .addValue("agent", agent)
                .addValue("version", version)
                .addValue("limit", limit);
        return jdbc.queryForList("""
                SELECT SpanId AS span_id, SessionId AS session_id
                FROM otel_traces
                WHERE OrgId = :org_id
                  AND ServiceName = :agent
                  AND %s = :version
                  AND notEmpty(Model)
                  AND SpanId NOT IN (SELECT span_id FROM remi_span_analysis WHERE org_id = :org_id)
                ORDER BY rand()
                LIMIT :limit
                """.formatted(VERSION_EXPR),
                params);
    }

    // ── Spans ───────────────────────────────────────────────────────────────────

    public record SpanRow(
            String spanId, String parentSpanId, String traceId,
            String spanName, String kind, String status, String statusMessage,
            long durationMs, String startedAt,
            String serviceName, String orgId, String sessionId,
            String model, String provider,
            Long inputTokens, Long outputTokens, Long cacheTokens,
            Map<String, String> attributes) {}

    @SuppressWarnings("unchecked")
    private static SpanRow mapSpanRow(ResultSet rs) throws SQLException {
        Map<String, String> attrs = (Map<String, String>) rs.getObject("attributes");
        String model = rs.getString("model");
        Long inputTokens  = model != null ? rs.getLong("input_tokens_val")  : null;
        Long outputTokens = model != null ? rs.getLong("output_tokens_val") : null;
        Long cacheTokens  = model != null ? rs.getLong("cache_tokens_val")  : null;
        return new SpanRow(
                rs.getString("span_id"),
                rs.getString("parent_span_id"),
                rs.getString("trace_id"),
                rs.getString("span_name"),
                rs.getString("kind"),
                rs.getString("status"),
                rs.getString("status_message"),
                rs.getLong("duration_ms"),
                toIso(rs.getTimestamp("timestamp")),
                nullToEmpty(rs.getString("service_name")),
                nullToEmpty(rs.getString("org_id")),
                rs.getString("session_id"),
                model,
                rs.getString("provider"),
                inputTokens, outputTokens, cacheTokens,
                attrs != null ? attrs : Map.of());
    }

    private static final String SPAN_SELECT = """
            SELECT
                SpanId                                                                              AS span_id,
                ParentSpanId                                                                        AS parent_span_id,
                TraceId                                                                             AS trace_id,
                SpanName                                                                            AS span_name,
                CASE
                    WHEN notEmpty(Model) THEN 'llm'
                    WHEN SpanKind = 'SPAN_KIND_CLIENT' THEN 'tool'
                    WHEN SpanKind IN ('SPAN_KIND_SERVER', 'SPAN_KIND_INTERNAL') THEN 'agent'
                    ELSE 'other'
                END                                                                                 AS kind,
                CASE StatusCode
                    WHEN 'STATUS_CODE_ERROR' THEN 'error'
                    WHEN 'STATUS_CODE_OK' THEN 'ok'
                    ELSE 'unset'
                END                                                                                 AS status,
                StatusMessage                                                                       AS status_message,
                toInt64(Duration / 1000000)                                                         AS duration_ms,
                Timestamp                                                                           AS timestamp,
                ServiceName                                                                         AS service_name,
                OrgId                                                                               AS org_id,
                SessionId                                                                           AS session_id,
                nullIf(Model, '')                                                                   AS model,
                nullIf(Provider, '')                                                                AS provider,
                InputTokens                                                                         AS input_tokens_val,
                OutputTokens                                                                        AS output_tokens_val,
                CacheTokens                                                                         AS cache_tokens_val,
                SpanAttributes                                                                      AS attributes
            FROM otel_traces
            """;

    public ListResult<SpanRow> getSpansForSession(
            String orgId, String sessionId, String kindFilter, int limit, int offset) {

        var params = new MapSqlParameterSource();
        params.addValue("session_id", sessionId);
        params.addValue("org_id", orgId);
        params.addValue("limit", limit);
        params.addValue("offset", offset);

        // `kind` is a derived SELECT alias, not a real column, so it cannot appear in a
        // WHERE/count clause. Translate it to the underlying predicate instead. The mapping
        // is a fixed whitelist (no user text reaches SQL), mirroring SPAN_SELECT's CASE.
        String extraFilter = "";
        if (kindFilter != null && !kindFilter.isEmpty()) {
            String predicate = switch (kindFilter) {
                case "llm"   -> "notEmpty(Model)";
                case "tool"  -> "SpanKind = 'SPAN_KIND_CLIENT' AND empty(Model)";
                case "agent" -> "SpanKind IN ('SPAN_KIND_SERVER', 'SPAN_KIND_INTERNAL') AND empty(Model)";
                default      -> null;
            };
            if (predicate != null) extraFilter = " AND (" + predicate + ")";
        }

        String where = "WHERE SessionId = :session_id AND OrgId = :org_id";

        List<SpanRow> rows = jdbc.query(
                SPAN_SELECT + where + extraFilter + " ORDER BY Timestamp ASC LIMIT :limit OFFSET :offset",
                params,
                (rs, i) -> mapSpanRow(rs));

        List<Map<String, Object>> countRows = jdbc.queryForList(
                "SELECT count() AS total FROM otel_traces " + where + extraFilter,
                params);
        long total = countRows.isEmpty() ? 0L : toLong(countRows.get(0).get("total"));

        return new ListResult<>(rows, total);
    }

    public Optional<SpanRow> getSpan(String orgId, String spanId) {
        var params = new MapSqlParameterSource()
                .addValue("span_id", spanId)
                .addValue("org_id", orgId);
        List<SpanRow> rows = jdbc.query(
                SPAN_SELECT + "WHERE SpanId = :span_id AND OrgId = :org_id LIMIT 1",
                params,
                (rs, i) -> mapSpanRow(rs));
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    /**
     * Free-text span search. Always matches span name and model; when
     * {@code includePrompts} is set (caller holds read:prompts) it also matches
     * the prompt/completion attribute values and returns the matching excerpt.
     *
     * Prompt matching is scope-gated on purpose: without the gate a key that
     * cannot READ prompts could still probe their contents a guess at a time by
     * watching which queries return hits.
     *
     * ponytail: scans the SpanAttributes map, which the materialized columns
     * exist to avoid. Fine here — search is user-triggered, LIMITed, and there
     * is no way to full-text a map without reading it. If it gets slow, the
     * upgrade is a token bloom index on the prompt values.
     */
    public List<Map<String, Object>> searchSpans(String orgId, String query, int limit,
                                                 boolean includePrompts) {
        var params = new MapSqlParameterSource();
        params.addValue("limit", limit);
        params.addValue("org_id", orgId);
        params.addValue("query", "%" + query.toLowerCase() + "%");
        params.addValue("raw_query", query);

        // Keep in sync with JudgeService.isPromptAttr — same keys the API redacts.
        String promptKey = """
                (startsWith(k, 'gen_ai.prompt') OR startsWith(k, 'gen_ai.completion')
                 OR startsWith(k, 'gen_ai.input') OR startsWith(k, 'gen_ai.output')
                 OR startsWith(k, 'gen_ai.task.') OR k = 'gen_ai.system_instructions'
                 OR k = 'traceloop.entity.input' OR k = 'traceloop.entity.output')""";

        String matchedValues = includePrompts
                ? """
                  arrayFilter((v, k) -> %s AND positionCaseInsensitive(v, :raw_query) > 0,
                              mapValues(SpanAttributes), mapKeys(SpanAttributes))"""
                  .formatted(promptKey)
                : "[]";

        String promptPredicate = includePrompts ? "OR notEmpty(%s)".formatted(matchedValues) : "";

        return jdbc.queryForList("""
                SELECT
                    SpanId                                          AS span_id,
                    TraceId                                         AS trace_id,
                    SessionId                                       AS session_id,
                    SpanName                                        AS span_name,
                    nullIf(Model, '')                               AS model,
                    CASE StatusCode
                        WHEN 'STATUS_CODE_ERROR' THEN 'error'
                        WHEN 'STATUS_CODE_OK' THEN 'ok'
                        ELSE 'unset'
                    END                                             AS status,
                    if(empty(%1$s), '',
                       substring(%1$s[1],
                                 greatest(1, positionCaseInsensitive(%1$s[1], :raw_query) - 48),
                                 160))                              AS snippet
                FROM otel_traces
                WHERE OrgId = :org_id
                  AND (lower(SpanName) LIKE :query
                   OR lower(Model) LIKE :query
                   %2$s)
                ORDER BY Timestamp DESC
                LIMIT :limit
                """.formatted(matchedValues, promptPredicate),
                params);
    }

    // ── Span analysis persistence (LLM-as-judge results, kept for audit) ────────

    public void saveSpanAnalysis(String orgId, String sessionId, String spanId,
                                 String modelUsed, String analysisJson) {
        jdbc.update("""
                INSERT INTO remi_span_analysis (org_id, session_id, span_id, model_used, analysis)
                VALUES (:org, :session, :span, :model, :analysis)
                """,
                new MapSqlParameterSource()
                        .addValue("org", orgId)
                        .addValue("session", sessionId)
                        .addValue("span", spanId)
                        .addValue("model", modelUsed)
                        .addValue("analysis", analysisJson));
    }

    public Optional<Map<String, Object>> getLatestSpanAnalysis(String orgId, String spanId) {
        var rows = jdbc.queryForList("""
                SELECT span_id, session_id, model_used, analysis, created_at
                FROM remi_span_analysis
                WHERE org_id = :org AND span_id = :span
                ORDER BY created_at DESC
                LIMIT 1
                """,
                new MapSqlParameterSource().addValue("org", orgId).addValue("span", spanId));
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────

    private String buildScopeWhere(
            MapSqlParameterSource params,
            String orgId, String agentId,
            String startDate, String endDate) {

        List<String> parts = new ArrayList<>();
        // org scope is mandatory — callers pass KeyContext.orgId
        parts.add("OrgId = :org_id");
        params.addValue("org_id", Objects.requireNonNull(orgId, "orgId is required"));
        if (agentId != null && !agentId.isEmpty()) {
            parts.add("ServiceName = :agent_id");
            params.addValue("agent_id", agentId);
        }
        if (startDate != null && !startDate.isEmpty()) {
            parts.add("toDate(Timestamp) >= :start_date");
            params.addValue("start_date", startDate);
        }
        if (endDate != null && !endDate.isEmpty()) {
            parts.add("toDate(Timestamp) <= :end_date");
            params.addValue("end_date", endDate);
        }
        return String.join(" AND ", parts);
    }

    private static String toIso(Timestamp ts) {
        if (ts == null) return null;
        return ts.toInstant().truncatedTo(ChronoUnit.MILLIS).toString();
    }

    private static String nullToEmpty(String s) {
        return s != null ? s : "";
    }

    private static long toLong(Object v) {
        if (v == null) return 0L;
        if (v instanceof Number n) return n.longValue();
        try { return Long.parseLong(v.toString()); } catch (NumberFormatException e) { return 0L; }
    }

    /** Null when absent, non-numeric, or NaN/Inf (e.g. avgIf over zero rows). */
    private static Double toFiniteDouble(Object v) {
        Double d = null;
        if (v instanceof Number n) d = n.doubleValue();
        else if (v != null) {
            try { d = Double.parseDouble(v.toString()); } catch (NumberFormatException ignored) { }
        }
        return (d == null || d.isNaN() || d.isInfinite()) ? null : d;
    }
}
