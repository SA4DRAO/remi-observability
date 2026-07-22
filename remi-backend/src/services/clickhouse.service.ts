import { createClient } from '@clickhouse/client';
import type { ClickHouseClient } from '@clickhouse/client';
import type { Logger } from './logger';

export interface ClickHouseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

export interface SessionRow {
  session_id: string;
  org_id: string;
  agent_id: string;
  span_count: number;
  error_count: number;
  prompt_tokens: number;     // aliased from gen_ai.usage.input_tokens
  completion_tokens: number; // aliased from gen_ai.usage.output_tokens
  start_time: string;
  end_time: string;
  has_error: boolean;
  is_complete: boolean;
}

export interface SpanRow {
  span_id: string;
  parent_span_id: string;
  trace_id: string;
  span_name: string;
  span_kind: string;
  status_code: string;
  status_message: string;
  duration_ns: number;
  timestamp: string;
  service_name: string;
  org_id: string;
  attributes: Record<string, string>;
}

export interface ListSessionsParams {
  orgId?: string;
  agentId?: string;
  limit: number;
  offset: number;
  startDate?: string;
  endDate?: string;
  hasError?: boolean;
  isComplete?: boolean;
}

export interface AnalyticsParams {
  orgId?: string;
  agentId?: string;
  startDate?: string;
  endDate?: string;
}

export interface SearchParams {
  query: string;
  limit: number;
  orgId?: string;
  agentId?: string;
}

export class ClickHouseService {
  private client: ClickHouseClient | null = null;
  private readonly config: ClickHouseConfig;
  private readonly logger: Logger;

  // session_id derived from standard GenAI conventions — no remi.* attributes required
  private static readonly SESSION_ID = `COALESCE(SpanAttributes['gen_ai.conversation.id'], TraceId)`;

  constructor(config: ClickHouseConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  async initialize(): Promise<void> {
    this.client = createClient({
      host: `http://${this.config.host}:${this.config.port}`,
      username: this.config.username,
      password: this.config.password,
      database: this.config.database,
    });
    await this.client.ping();
    this.logger.info('ClickHouse connected');
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  private getClient(): ClickHouseClient {
    if (!this.client) throw new Error('ClickHouse client not initialized');
    return this.client;
  }

  private scopeFilter(params: AnalyticsParams): string {
    const parts: string[] = [];
    if (params.orgId) parts.push(`ResourceAttributes['service.namespace'] = {org_id:String}`);
    if (params.agentId) parts.push(`ResourceAttributes['service.name'] = {agent_id:String}`);
    if (params.startDate) parts.push(`Timestamp >= {start_date:String}`);
    if (params.endDate) parts.push(`Timestamp <= {end_date:String}`);
    return parts.length > 0 ? parts.join(' AND ') : '1=1';
  }

  private scopeParams(params: AnalyticsParams): Record<string, string> {
    const p: Record<string, string> = {};
    if (params.orgId) p['org_id'] = params.orgId;
    if (params.agentId) p['agent_id'] = params.agentId;
    if (params.startDate) p['start_date'] = params.startDate;
    if (params.endDate) p['end_date'] = params.endDate;
    return p;
  }

  // ── Sessions ────────────────────────────────────────────────────────────────

  async listSessions(params: ListSessionsParams): Promise<{ sessions: SessionRow[]; total: number }> {
    const ch = this.getClient();
    const sid = ClickHouseService.SESSION_ID;

    const whereParts: string[] = [];
    const qp: Record<string, string | number> = {
      limit: params.limit,
      offset: params.offset,
    };

    if (params.orgId) { whereParts.push(`ResourceAttributes['service.namespace'] = {org_id:String}`); qp['org_id'] = params.orgId; }
    if (params.agentId) { whereParts.push(`ResourceAttributes['service.name'] = {agent_id:String}`); qp['agent_id'] = params.agentId; }
    if (params.startDate) { whereParts.push(`toDate(Timestamp) >= {start_date:Date}`); qp['start_date'] = params.startDate; }
    if (params.endDate) { whereParts.push(`toDate(Timestamp) <= {end_date:Date}`); qp['end_date'] = params.endDate; }

    const where = whereParts.length > 0 ? whereParts.join(' AND ') : '1=1';

    const baseQuery = `
      SELECT
          ${sid}                                                                    AS session_id,
          anyLast(ResourceAttributes['service.namespace'])                          AS org_id,
          anyLast(ResourceAttributes['service.name'])                               AS agent_id,
          count()                                                                   AS span_count,
          countIf(StatusCode = 'STATUS_CODE_ERROR')                                 AS error_count,
          sum(toUInt64OrZero(SpanAttributes['gen_ai.usage.input_tokens']))          AS prompt_tokens,
          sum(toUInt64OrZero(SpanAttributes['gen_ai.usage.output_tokens']))         AS completion_tokens,
          min(Timestamp)                                                            AS start_time,
          max(Timestamp)                                                            AS end_time,
          countIf(StatusCode = 'STATUS_CODE_ERROR') > 0                            AS has_error,
          countIf(empty(ParentSpanId) AND notEmpty(SpanId)) > 0                    AS is_complete
      FROM otel_traces
      WHERE ${where}
      GROUP BY session_id`;

    const [dataResult, countResult] = await Promise.all([
      ch.query({
        query: `${baseQuery} ORDER BY start_time DESC LIMIT {limit:Int32} OFFSET {offset:Int32}`,
        query_params: qp,
        format: 'JSONEachRow',
      }),
      ch.query({
        query: `SELECT count() AS total FROM (${baseQuery})`,
        query_params: qp,
        format: 'JSONEachRow',
      }),
    ]);

    const sessions = await dataResult.json<SessionRow>();
    const countRows = await countResult.json<{ total: number }>();
    const total = countRows[0]?.total ?? 0;

    return { sessions, total };
  }

  async getSession(sessionId: string): Promise<SessionRow | null> {
    const ch = this.getClient();
    const sid = ClickHouseService.SESSION_ID;
    const result = await ch.query({
      query: `
        SELECT
            ${sid}                                                                 AS session_id,
            anyLast(ResourceAttributes['service.namespace'])                      AS org_id,
            anyLast(ResourceAttributes['service.name'])                           AS agent_id,
            count()                                                               AS span_count,
            countIf(StatusCode = 'STATUS_CODE_ERROR')                             AS error_count,
            sum(toUInt64OrZero(SpanAttributes['gen_ai.usage.input_tokens']))      AS prompt_tokens,
            sum(toUInt64OrZero(SpanAttributes['gen_ai.usage.output_tokens']))     AS completion_tokens,
            min(Timestamp)                                                        AS start_time,
            max(Timestamp)                                                        AS end_time,
            countIf(StatusCode = 'STATUS_CODE_ERROR') > 0                        AS has_error,
            countIf(empty(ParentSpanId) AND notEmpty(SpanId)) > 0                AS is_complete
        FROM otel_traces
        WHERE ${sid} = {session_id:String}
        GROUP BY session_id`,
      query_params: { session_id: sessionId },
      format: 'JSONEachRow',
    });
    const rows = await result.json<SessionRow>();
    return rows[0] ?? null;
  }

  async getSpansForSession(
    sessionId: string,
    opts: { limit: number; offset: number; eventType?: string }
  ): Promise<{ spans: SpanRow[]; total: number }> {
    const ch = this.getClient();
    const sid = ClickHouseService.SESSION_ID;
    const qp: Record<string, string | number> = {
      session_id: sessionId,
      limit: opts.limit,
      offset: opts.offset,
    };

    let kindFilter = '';
    if (opts.eventType) {
      qp['event_type'] = opts.eventType;
      kindFilter = `AND SpanKind = {event_type:String}`;
    }

    const [dataResult, countResult] = await Promise.all([
      ch.query({
        query: `
          SELECT
              SpanId                                         AS span_id,
              ParentSpanId                                   AS parent_span_id,
              TraceId                                        AS trace_id,
              SpanName                                       AS span_name,
              SpanKind                                       AS span_kind,
              StatusCode                                     AS status_code,
              StatusMessage                                  AS status_message,
              Duration                                       AS duration_ns,
              Timestamp                                      AS timestamp,
              ServiceName                                    AS service_name,
              ResourceAttributes['service.namespace']        AS org_id,
              SpanAttributes                                 AS attributes
          FROM otel_traces
          WHERE ${sid} = {session_id:String} ${kindFilter}
          ORDER BY Timestamp ASC
          LIMIT {limit:Int32} OFFSET {offset:Int32}`,
        query_params: qp,
        format: 'JSONEachRow',
      }),
      ch.query({
        query: `
          SELECT count() AS total
          FROM otel_traces
          WHERE ${sid} = {session_id:String} ${kindFilter}`,
        query_params: qp,
        format: 'JSONEachRow',
      }),
    ]);

    const spans = await dataResult.json<SpanRow>();
    const countRows = await countResult.json<{ total: number }>();
    return { spans, total: countRows[0]?.total ?? 0 };
  }

  async getSpan(spanId: string): Promise<SpanRow | null> {
    const ch = this.getClient();
    const result = await ch.query({
      query: `
        SELECT
            SpanId                                       AS span_id,
            ParentSpanId                                 AS parent_span_id,
            TraceId                                      AS trace_id,
            SpanName                                     AS span_name,
            SpanKind                                     AS span_kind,
            StatusCode                                   AS status_code,
            StatusMessage                                AS status_message,
            Duration                                     AS duration_ns,
            Timestamp                                    AS timestamp,
            ServiceName                                  AS service_name,
            ResourceAttributes['service.namespace']      AS org_id,
            SpanAttributes                               AS attributes
        FROM otel_traces
        WHERE SpanId = {span_id:String}
        LIMIT 1`,
      query_params: { span_id: spanId },
      format: 'JSONEachRow',
    });
    const rows = await result.json<SpanRow>();
    return rows[0] ?? null;
  }

  async deleteSessionSpans(sessionId: string): Promise<void> {
    const ch = this.getClient();
    const sid = ClickHouseService.SESSION_ID;
    await ch.command({
      query: `ALTER TABLE otel_traces DELETE WHERE ${sid} = {session_id:String}`,
      query_params: { session_id: sessionId },
    });
  }

  // ── Analytics ───────────────────────────────────────────────────────────────

  async getSessionAnalytics(params: AnalyticsParams): Promise<unknown> {
    const ch = this.getClient();
    const sid = ClickHouseService.SESSION_ID;
    const where = this.scopeFilter(params);
    const qp = this.scopeParams(params);
    const result = await ch.query({
      query: `
        SELECT
            count(DISTINCT ${sid})                                                  AS total_sessions,
            countIf(StatusCode = 'STATUS_CODE_ERROR')                               AS error_sessions,
            sum(toUInt64OrZero(SpanAttributes['gen_ai.usage.input_tokens'])
              + toUInt64OrZero(SpanAttributes['gen_ai.usage.output_tokens']))       AS total_tokens,
            0                                                                       AS total_cost_usd,
            0                                                                       AS avg_cost_per_session,
            if(count(DISTINCT ${sid}) > 0,
               countIf(StatusCode = 'STATUS_CODE_ERROR')
               / count(DISTINCT ${sid}), 0)                                        AS error_rate
        FROM otel_traces
        WHERE ${where}`,
      query_params: qp,
      format: 'JSONEachRow',
    });
    const rows = await result.json<unknown>();
    return rows[0] ?? {};
  }

  async getLatencyPercentiles(params: AnalyticsParams): Promise<unknown[]> {
    const ch = this.getClient();
    const where = this.scopeFilter(params);
    const qp = this.scopeParams(params);
    const result = await ch.query({
      query: `
        SELECT
            SpanName                                  AS span_name,
            count()                                   AS sample_count,
            round(quantile(0.50)(Duration) / 1e6, 2) AS p50_ms,
            round(quantile(0.95)(Duration) / 1e6, 2) AS p95_ms,
            round(quantile(0.99)(Duration) / 1e6, 2) AS p99_ms
        FROM otel_traces
        WHERE ${where}
        GROUP BY SpanName
        ORDER BY p95_ms DESC
        LIMIT 30`,
      query_params: qp,
      format: 'JSONEachRow',
    });
    return result.json<unknown[]>();
  }

  async getSlowestSpans(params: AnalyticsParams & { limit: number }): Promise<unknown[]> {
    const ch = this.getClient();
    const sid = ClickHouseService.SESSION_ID;
    const where = this.scopeFilter(params);
    const qp = { ...this.scopeParams(params), limit: params.limit };
    const result = await ch.query({
      query: `
        SELECT
            SpanId                              AS span_id,
            SpanName                            AS span_name,
            ${sid}                              AS session_id,
            ResourceAttributes['service.name'] AS agent_id,
            round(Duration / 1e6, 2)            AS duration_ms,
            StatusCode                          AS status_code,
            Timestamp                           AS timestamp
        FROM otel_traces
        WHERE ${where}
        ORDER BY Duration DESC
        LIMIT {limit:Int32}`,
      query_params: qp,
      format: 'JSONEachRow',
    });
    return result.json<unknown[]>();
  }

  async getErrorClusters(params: AnalyticsParams): Promise<unknown[]> {
    const ch = this.getClient();
    const where = this.scopeFilter(params);
    const qp = this.scopeParams(params);
    const result = await ch.query({
      query: `
        SELECT
            SpanName                  AS span_name,
            StatusMessage             AS error_message,
            count()                   AS occurrence_count,
            max(Timestamp)            AS last_seen
        FROM otel_traces
        WHERE ${where} AND StatusCode = 'STATUS_CODE_ERROR'
        GROUP BY SpanName, StatusMessage
        ORDER BY occurrence_count DESC
        LIMIT 30`,
      query_params: qp,
      format: 'JSONEachRow',
    });
    return result.json<unknown[]>();
  }

  async getErrorRateByVersion(params: AnalyticsParams): Promise<unknown[]> {
    const ch = this.getClient();
    const where = this.scopeFilter(params);
    const qp = this.scopeParams(params);
    const result = await ch.query({
      query: `
        SELECT
            ResourceAttributes['service.version']          AS agent_version,
            count()                                        AS total_spans,
            countIf(StatusCode = 'STATUS_CODE_ERROR')       AS error_spans,
            round(countIf(StatusCode = 'STATUS_CODE_ERROR') / count() * 100, 2) AS error_rate_pct
        FROM otel_traces
        WHERE ${where}
        GROUP BY agent_version
        ORDER BY error_rate_pct DESC`,
      query_params: qp,
      format: 'JSONEachRow',
    });
    return result.json<unknown[]>();
  }

  async getToolFailures(params: AnalyticsParams): Promise<unknown[]> {
    const ch = this.getClient();
    const where = this.scopeFilter(params);
    const qp = this.scopeParams(params);
    const result = await ch.query({
      query: `
        SELECT
            SpanName                                AS tool_name,
            count()                                 AS total_calls,
            countIf(StatusCode = 'STATUS_CODE_ERROR') AS failures,
            round(countIf(StatusCode = 'STATUS_CODE_ERROR') / count() * 100, 2) AS failure_rate_pct
        FROM otel_traces
        WHERE ${where} AND SpanKind = 'SPAN_KIND_CLIENT'
        GROUP BY tool_name
        HAVING failures > 0
        ORDER BY failures DESC
        LIMIT 20`,
      query_params: qp,
      format: 'JSONEachRow',
    });
    return result.json<unknown[]>();
  }

  async getPromptLengthDistribution(params: AnalyticsParams): Promise<unknown[]> {
    const ch = this.getClient();
    const where = this.scopeFilter(params);
    const qp = this.scopeParams(params);
    const result = await ch.query({
      query: `
        SELECT
            intDiv(toUInt64OrZero(SpanAttributes['gen_ai.usage.input_tokens']), 500) * 500 AS bucket_start,
            count() AS count
        FROM otel_traces
        WHERE ${where}
          AND notEmpty(SpanAttributes['gen_ai.usage.input_tokens'])
        GROUP BY bucket_start
        ORDER BY bucket_start ASC`,
      query_params: qp,
      format: 'JSONEachRow',
    });
    return result.json<unknown[]>();
  }

  async getPromptCompletionRatio(params: AnalyticsParams): Promise<unknown[]> {
    const ch = this.getClient();
    const where = this.scopeFilter(params);
    const qp = this.scopeParams(params);
    const result = await ch.query({
      query: `
        SELECT
            SpanAttributes['gen_ai.request.model']                                    AS model,
            SpanAttributes['gen_ai.system']                                           AS provider,
            avg(toUInt64OrZero(SpanAttributes['gen_ai.usage.input_tokens']))          AS avg_prompt_tokens,
            avg(toUInt64OrZero(SpanAttributes['gen_ai.usage.output_tokens']))         AS avg_completion_tokens,
            avg(
              toUInt64OrZero(SpanAttributes['gen_ai.usage.output_tokens']) /
              greatest(toUInt64OrZero(SpanAttributes['gen_ai.usage.input_tokens']), 1)
            )                                                                         AS avg_ratio
        FROM otel_traces
        WHERE ${where}
          AND notEmpty(SpanAttributes['gen_ai.usage.input_tokens'])
          AND notEmpty(SpanAttributes['gen_ai.usage.output_tokens'])
        GROUP BY model, provider
        HAVING notEmpty(model)
        ORDER BY avg_prompt_tokens DESC`,
      query_params: qp,
      format: 'JSONEachRow',
    });
    return result.json<unknown[]>();
  }

  async getCacheEfficiency(params: AnalyticsParams): Promise<unknown[]> {
    const ch = this.getClient();
    const where = this.scopeFilter(params);
    const qp = this.scopeParams(params);
    const result = await ch.query({
      query: `
        SELECT
            SpanAttributes['gen_ai.request.model']                                         AS model,
            SpanAttributes['gen_ai.system']                                                AS provider,
            count()                                                                        AS total_calls,
            countIf(notEmpty(SpanAttributes['gen_ai.usage.cache_read_input_tokens']))      AS cache_hits,
            round(
              countIf(notEmpty(SpanAttributes['gen_ai.usage.cache_read_input_tokens'])) / count() * 100,
              2
            )                                                                              AS hit_rate_pct
        FROM otel_traces
        WHERE ${where}
        GROUP BY model, provider
        HAVING notEmpty(model)
        ORDER BY total_calls DESC`,
      query_params: qp,
      format: 'JSONEachRow',
    });
    return result.json<unknown[]>();
  }

  async getVersionMetrics(params: AnalyticsParams): Promise<unknown[]> {
    const ch = this.getClient();
    const sid = ClickHouseService.SESSION_ID;
    const where = this.scopeFilter(params);
    const qp = this.scopeParams(params);
    const result = await ch.query({
      query: `
        SELECT
            anyLast(ResourceAttributes['service.name'])                            AS agent_id,
            ResourceAttributes['service.version']                                  AS agent_version,
            count(DISTINCT ${sid})                                                 AS session_count,
            round(avg(toUInt64OrZero(SpanAttributes['gen_ai.usage.input_tokens'])
                    + toUInt64OrZero(SpanAttributes['gen_ai.usage.output_tokens'])), 0) AS avg_tokens,
            0                                                                      AS avg_cost_usd,
            round(avg(Duration), 0)                                                AS avg_duration_ns,
            if(count() > 0,
               countIf(StatusCode = 'STATUS_CODE_ERROR') / count(), 0)            AS error_rate
        FROM otel_traces
        WHERE ${where}
        GROUP BY agent_version
        HAVING notEmpty(agent_version)
        ORDER BY session_count DESC`,
      query_params: qp,
      format: 'JSONEachRow',
    });
    return result.json<unknown[]>();
  }

  async getConversations(params: AnalyticsParams & { limit: number; offset: number }): Promise<{ conversations: unknown[]; total: number }> {
    const ch = this.getClient();
    const sid = ClickHouseService.SESSION_ID;
    const where = this.scopeFilter(params);
    const qp = { ...this.scopeParams(params), limit: params.limit, offset: params.offset };
    const [dataResult, countResult] = await Promise.all([
      ch.query({
        query: `
          SELECT
              SpanAttributes['gen_ai.conversation.id']         AS conversation_id,
              anyLast(ResourceAttributes['service.namespace']) AS org_id,
              anyLast(ResourceAttributes['service.name'])      AS agent_id,
              count(DISTINCT ${sid})                           AS session_count,
              min(Timestamp)                                   AS first_session_at,
              max(Timestamp)                                   AS last_session_at
          FROM otel_traces
          WHERE ${where} AND notEmpty(SpanAttributes['gen_ai.conversation.id'])
          GROUP BY conversation_id
          ORDER BY last_session_at DESC
          LIMIT {limit:Int32} OFFSET {offset:Int32}`,
        query_params: qp,
        format: 'JSONEachRow',
      }),
      ch.query({
        query: `
          SELECT count(DISTINCT SpanAttributes['gen_ai.conversation.id']) AS total
          FROM otel_traces
          WHERE ${where} AND notEmpty(SpanAttributes['gen_ai.conversation.id'])`,
        query_params: qp,
        format: 'JSONEachRow',
      }),
    ]);
    const conversations = await dataResult.json<unknown[]>();
    const countRows = await countResult.json<{ total: number }>();
    return { conversations, total: countRows[0]?.total ?? 0 };
  }

  async searchSpanAttributes(params: SearchParams): Promise<unknown[]> {
    const ch = this.getClient();
    const sid = ClickHouseService.SESSION_ID;
    const whereParts = [`hasAny(mapValues(SpanAttributes), [q])`];
    const qp: Record<string, string | number> = { q: params.query, limit: params.limit };
    if (params.orgId) { whereParts.push(`ResourceAttributes['service.namespace'] = {org_id:String}`); qp['org_id'] = params.orgId; }
    if (params.agentId) { whereParts.push(`ResourceAttributes['service.name'] = {agent_id:String}`); qp['agent_id'] = params.agentId; }
    const result = await ch.query({
      query: `
        SELECT
            SpanId     AS span_id,
            SpanName   AS span_name,
            ${sid}     AS session_id,
            Timestamp  AS timestamp
        FROM otel_traces
        WHERE ${whereParts.join(' AND ')}
        ORDER BY Timestamp DESC
        LIMIT {limit:Int32}`,
      query_params: qp,
      format: 'JSONEachRow',
    });
    return result.json<unknown[]>();
  }
}
