import { Pool, PoolClient, PoolConfig, types } from 'pg';

// pg returns BIGINT (OID 20) and NUMERIC (OID 1700) as strings by default to
// avoid JS precision loss. For our usage token counts are always < 2^53 and
// nanosecond timeline bars tolerate the tiny float rounding error, so we parse
// them immediately to avoid string-concatenation bugs on the frontend.
types.setTypeParser(20, (val: string) => parseInt(val, 10));   // BIGINT
types.setTypeParser(1700, (val: string) => parseFloat(val));   // NUMERIC
import { Logger } from './logger';
import { parsePositiveInt } from '../config';

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  max: number;
  min: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
}

export interface TraceSessionMapping {
  traceId: string;
  sessionId: string;
  orgId?: string;
  agentId?: string;
}

export interface ProviderAliasSessionMapping {
  provider: string;
  aliasType: string;
  aliasValue: string;
  sessionId: string;
  traceId?: string;
  orgId?: string;
  agentId?: string;
}

export interface PersistOtlpV2Span {
  spanId: string;
  parentSpanId?: string | null;
  name: string;
  kind: number;
  statusCode: number;
  statusMessage?: string | null;
  model?: string | null;
  provider?: string | null;
  startTimeNs: bigint | number;
  endTimeNs: bigint | number;
  attributes: Record<string, unknown>;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  } | null;
}

export interface PersistOtlpV2Params {
  sessionId: string;
  traceId: string;
  orgId: string;
  agentId: string;
  agentVersion?: string;
  conversationId?: string;
  promptVersion?: string;
  finalOutput?: string;
  spans: PersistOtlpV2Span[];
  modelPricing: Record<string, { input_cost_per_1m: number; output_cost_per_1m: number }>;
}

export interface ListSessionsV2Params {
  orgId?: string;
  agentId?: string;
  limit: number;
  offset: number;
  startDate?: string;
  endDate?: string;
  hasError?: boolean;
  isComplete?: boolean;
  minCost?: number;
  maxCost?: number;
}

export interface GetSpansForSessionV2Params {
  limit: number;
  offset: number;
  eventType?: string;
}

export interface GetAnalyticsV2Params {
  orgId?: string;
  agentId?: string;
  startDate?: string;
  endDate?: string;
}

export class DatabaseService {
  private pool: Pool | null = null;
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    queryDescription: string
  ): Promise<T> {
    let timeoutHandle: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`Query timeout after ${timeoutMs}ms: ${queryDescription}`)),
        timeoutMs
      );
    });

    try {
      const result = await Promise.race([operation(), timeoutPromise]);
      clearTimeout(timeoutHandle!);
      return result;
    } catch (error) {
      clearTimeout(timeoutHandle!);
      throw error;
    }
  }

  private async ensureOtlpCorrelationSchema(): Promise<void> {
    if (!this.pool) throw new Error('Database not initialized');

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS trace_session_correlations (
        trace_id    TEXT PRIMARY KEY,
        session_id  VARCHAR(255) NOT NULL,
        org_id      VARCHAR(255),
        agent_id    VARCHAR(255),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_trace_session_correlations_session_id
        ON trace_session_correlations(session_id);

      CREATE TABLE IF NOT EXISTS provider_alias_correlations (
        provider    VARCHAR(100) NOT NULL DEFAULT 'unknown',
        alias_type  VARCHAR(50) NOT NULL,
        alias_value TEXT NOT NULL,
        session_id  VARCHAR(255) NOT NULL,
        trace_id    TEXT,
        org_id      VARCHAR(255),
        agent_id    VARCHAR(255),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (provider, alias_type, alias_value)
      );

      CREATE INDEX IF NOT EXISTS idx_provider_alias_correlations_session_id
        ON provider_alias_correlations(session_id);

      CREATE INDEX IF NOT EXISTS idx_provider_alias_correlations_trace_id
        ON provider_alias_correlations(trace_id);
    `);

    this.logger.info('Ensured OTLP correlation schema');
  }

  async initialize(): Promise<void> {
    const baseConfig = {
      user: process.env.DB_USER || 'remi_user',
      password: process.env.DB_PASSWORD || 'remi_password',
      database: process.env.DB_NAME || 'remi_db',
    };

    const config: PoolConfig = {
      ...baseConfig,
      host: process.env.DB_HOST || 'postgres-primary',
      port: parsePositiveInt(process.env.DB_PORT, 5432, 'DB_PORT'),
      min: parsePositiveInt(process.env.DB_POOL_MIN, 5, 'DB_POOL_MIN'),
      max: parsePositiveInt(process.env.DB_POOL_MAX, 20, 'DB_POOL_MAX'),
      connectionTimeoutMillis: parsePositiveInt(process.env.DB_CONNECTION_TIMEOUT_MS, 5000, 'DB_CONNECTION_TIMEOUT_MS'),
      idleTimeoutMillis: parsePositiveInt(process.env.DB_IDLE_TIMEOUT_MS, 30000, 'DB_IDLE_TIMEOUT_MS'),
    };

    this.pool = new Pool(config);

    this.pool.on('connect', async (client) => {
      const statementTimeoutMs = parsePositiveInt(process.env.DB_STATEMENT_TIMEOUT_MS, 60000, 'DB_STATEMENT_TIMEOUT_MS');
      await client.query(`SET statement_timeout = ${statementTimeoutMs}`);
      this.logger.debug('New client connected to database');
    });

    this.pool.on('acquire', (_client) => {
      this.logger.debug('Client acquired from pool');
    });

    this.pool.on('remove', (_client) => {
      this.logger.debug('Client removed from pool');
    });

    this.pool.on('error', (err, _client) => {
      this.logger.error('Unexpected pool error', { error: err });
    });

    try {
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      await this.ensureOtlpCorrelationSchema();
      this.logger.info('Database connection established');
    } catch (error) {
      this.logger.error('Failed to connect to database:', error);
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    return this.disconnect();
  }

  async query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }> {
    if (!this.pool) throw new Error('Database not initialized');

    const timeoutMs = parsePositiveInt(process.env.DB_QUERY_TIMEOUT_MS, 30000, 'DB_QUERY_TIMEOUT_MS');
    const startTime = Date.now();
    const compactQuery = text.replace(/\s+/g, ' ').trim();

    try {
      const result = await this.executeWithTimeout(
        () => this.pool!.query(text, values),
        timeoutMs,
        compactQuery.substring(0, 100)
      );

      const duration = Date.now() - startTime;
      const metadata = {
        duration,
        rowCount: result.rowCount,
        valuesCount: values?.length ?? 0,
        query: compactQuery.slice(0, 240),
      };

      if (duration >= 500) {
        this.logger.warn('Slow database query detected', metadata);
      } else {
        this.logger.debug('Database query executed', metadata);
      }

      return result;
    } catch (error) {
      this.logger.error('Database query failed', {
        query: compactQuery.slice(0, 240),
        valuesCount: values?.length ?? 0,
        error,
      });
      throw error;
    }
  }

  async queryRead(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }> {
    return this.query(text, values);
  }

  async getClient(): Promise<PoolClient> {
    if (!this.pool) throw new Error('Database not initialized');
    return this.pool.connect();
  }

  async loadModelPricing(): Promise<Map<string, { input_cost_per_1m: number; output_cost_per_1m: number }>> {
    const result = await this.queryRead(
      'SELECT model_name, input_cost_per_1m, output_cost_per_1m FROM model_pricing'
    );
    const map = new Map<string, { input_cost_per_1m: number; output_cost_per_1m: number }>();
    for (const row of result.rows as Array<{ model_name: string; input_cost_per_1m: string; output_cost_per_1m: string }>) {
      map.set(row.model_name, {
        input_cost_per_1m: parseFloat(row.input_cost_per_1m),
        output_cost_per_1m: parseFloat(row.output_cost_per_1m),
      });
    }
    return map;
  }

  async createSessionV2(
    sessionId: string,
    orgId?: string | null,
    agentId?: string | null,
    agentVersion?: string | null,
    attributes?: Record<string, unknown> | null
  ): Promise<void> {
    await this.query(
      `INSERT INTO sessions_v2 (session_id, org_id, agent_id, agent_version, metadata)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session_id) DO NOTHING`,
      [sessionId, orgId ?? null, agentId ?? null, agentVersion ?? null, attributes ? JSON.stringify(attributes) : null]
    );
    this.logger.debug('Created session_v2 row', {
      sessionId,
      orgId: orgId ?? null,
      agentId: agentId ?? null,
    });
  }

  async getTraceSessionMapping(traceId: string): Promise<TraceSessionMapping | null> {
    const result = await this.queryRead(
      `SELECT trace_id, session_id, org_id, agent_id
       FROM trace_session_correlations WHERE trace_id = $1`,
      [traceId]
    );
    const row = result.rows[0] as { trace_id: string; session_id: string; org_id: string | null; agent_id: string | null } | undefined;
    if (!row) return null;
    const mapping: TraceSessionMapping = { traceId: row.trace_id, sessionId: row.session_id };
    if (row.org_id) mapping.orgId = row.org_id;
    if (row.agent_id) mapping.agentId = row.agent_id;
    return mapping;
  }

  async getProviderAliasSession(
    provider: string,
    aliasType: string,
    aliasValue: string
  ): Promise<ProviderAliasSessionMapping | null> {
    const result = await this.queryRead(
      `SELECT provider, alias_type, alias_value, session_id, trace_id, org_id, agent_id
       FROM provider_alias_correlations
       WHERE alias_type = $1 AND alias_value = $2 AND provider IN ($3, 'unknown')
       ORDER BY CASE WHEN provider = $3 THEN 0 ELSE 1 END
       LIMIT 1`,
      [aliasType, aliasValue, provider]
    );
    const row = result.rows[0] as { provider: string; alias_type: string; alias_value: string; session_id: string; trace_id: string | null; org_id: string | null; agent_id: string | null } | undefined;
    if (!row) return null;
    const mapping: ProviderAliasSessionMapping = {
      provider: row.provider,
      aliasType: row.alias_type,
      aliasValue: row.alias_value,
      sessionId: row.session_id,
    };
    if (row.trace_id) mapping.traceId = row.trace_id;
    if (row.org_id) mapping.orgId = row.org_id;
    if (row.agent_id) mapping.agentId = row.agent_id;
    return mapping;
  }

  async persistOtlpV2(data: PersistOtlpV2Params): Promise<{ spansInserted: number }> {
    if (!this.pool) throw new Error('Database not initialized');

    const { sessionId, traceId, orgId, agentId, agentVersion, conversationId, promptVersion, finalOutput, spans, modelPricing } = data;
    const client = await this.pool.connect();
    let spansInserted = 0;

    try {
      await client.query('BEGIN');

      // 1. Upsert conversation row first (FK must exist before session references it)
      if (conversationId !== undefined) {
        await client.query(
          `INSERT INTO conversations (conversation_id, org_id, agent_id, first_session_at, last_session_at)
           VALUES ($1, $2, $3, NOW(), NOW())
           ON CONFLICT (conversation_id) DO UPDATE SET
             last_session_at = NOW(),
             session_count = conversations.session_count + 1`,
          [conversationId, orgId ?? null, agentId ?? null]
        );
      }

      // 2. Upsert session
      await client.query(
        `INSERT INTO sessions_v2
           (session_id, org_id, agent_id, agent_version, conversation_id, prompt_version, final_output, first_event_at, last_event_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (session_id) DO UPDATE SET
           last_event_at  = NOW(),
           agent_version  = COALESCE(EXCLUDED.agent_version, sessions_v2.agent_version),
           conversation_id = COALESCE(EXCLUDED.conversation_id, sessions_v2.conversation_id),
           prompt_version  = COALESCE(EXCLUDED.prompt_version, sessions_v2.prompt_version),
           final_output    = COALESCE(EXCLUDED.final_output, sessions_v2.final_output)`,
        [sessionId, orgId ?? null, agentId ?? null, agentVersion ?? null,
         conversationId ?? null, promptVersion ?? null, finalOutput ?? null]
      );

      // 2. Upsert trace
      await client.query(
        `INSERT INTO traces_v2 (trace_id, session_id, org_id, agent_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (trace_id) DO NOTHING`,
        [traceId, sessionId, orgId, agentId]
      );

      // 3. Insert spans
      for (const span of spans) {
        const startNs = typeof span.startTimeNs === 'bigint' ? span.startTimeNs.toString() : String(span.startTimeNs);
        const endNs = typeof span.endTimeNs === 'bigint' ? span.endTimeNs.toString() : String(span.endTimeNs);

        const spanResult = await client.query(
          `INSERT INTO spans_v2
             (span_id, trace_id, parent_span_id, source, name, kind, status_code, status_message,
              model_name, provider, start_time_ns, end_time_ns, org_id, agent_id, session_id)
           VALUES ($1,$2,$3,'otlp',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (span_id) DO NOTHING
           RETURNING id`,
          [
            span.spanId,
            traceId,
            span.parentSpanId ?? null,
            span.name,
            span.kind,
            span.statusCode,
            span.statusMessage ?? null,
            span.model ?? null,
            span.provider ?? null,
            startNs,
            endNs,
            orgId,
            agentId,
            sessionId,
          ]
        );

        if (spanResult.rowCount && spanResult.rowCount > 0) {
          spansInserted++;

          // 4a. Store all span attributes in span_attributes_v2
          for (const [attrKey, attrValue] of Object.entries(span.attributes)) {
            if (attrValue === null || attrValue === undefined) continue;
            let valueStr: string | null = null;
            let valueInt: number | null = null;
            let valueFloat: number | null = null;
            let valueBool: boolean | null = null;

            if (typeof attrValue === 'boolean') {
              valueBool = attrValue;
            } else if (typeof attrValue === 'number') {
              if (Number.isInteger(attrValue)) valueInt = attrValue;
              else valueFloat = attrValue;
            } else if (typeof attrValue === 'string') {
              valueStr = attrValue.slice(0, 8192);
            } else {
              valueStr = JSON.stringify(attrValue).slice(0, 8192);
            }

            await client.query(
              `INSERT INTO span_attributes_v2 (span_id, trace_id, key, value_str, value_int, value_float, value_bool)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT DO NOTHING`,
              [span.spanId, traceId, attrKey, valueStr, valueInt, valueFloat, valueBool]
            );
          }

          // 4b. Insert usage facts for LLM spans with token data
          if (span.usage && (span.usage.promptTokens || span.usage.completionTokens || span.usage.totalTokens)) {
            const promptTokens = span.usage.promptTokens ?? 0;
            const completionTokens = span.usage.completionTokens ?? 0;
            const totalTokens = span.usage.totalTokens ?? (promptTokens + completionTokens);

            await client.query(
              `INSERT INTO usage_facts_v2
                 (span_id, trace_id, session_id, org_id, agent_id, model_name, provider,
                  prompt_tokens, completion_tokens, total_tokens)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
               ON CONFLICT (span_id) DO NOTHING`,
              [
                span.spanId,
                traceId,
                sessionId,
                orgId,
                agentId,
                span.model ?? null,
                span.provider ?? null,
                promptTokens,
                completionTokens,
                totalTokens,
              ]
            );

            // 5. Compute and insert cost facts
            const modelKey = span.model ?? '';
            const pricing = modelPricing[modelKey];
            if (pricing && modelKey.length > 0) {
              const promptCost = (promptTokens / 1_000_000) * pricing.input_cost_per_1m;
              const completionCost = (completionTokens / 1_000_000) * pricing.output_cost_per_1m;
              const totalCost = promptCost + completionCost;

              await client.query(
                `INSERT INTO cost_facts_v2
                   (span_id, trace_id, session_id, org_id, agent_id, model_name, provider,
                    prompt_cost_usd, completion_cost_usd, total_cost_usd, pricing_source)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'model_pricing')
                 ON CONFLICT (span_id) DO NOTHING`,
                [
                  span.spanId,
                  traceId,
                  sessionId,
                  orgId,
                  agentId,
                  span.model ?? null,
                  span.provider ?? null,
                  promptCost.toFixed(8),
                  completionCost.toFixed(8),
                  totalCost.toFixed(8),
                ]
              );
            }
          }
        }
      }

      // 6. Refresh session rollup
      await client.query('SELECT update_session_rollup_v2($1)', [sessionId]);

      await client.query('COMMIT');

      this.logger.debug('persistOtlpV2 complete', { sessionId, traceId, spansInserted, totalSpans: spans.length });
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('persistOtlpV2 transaction failed', { sessionId, traceId, error });
      throw error;
    } finally {
      client.release();
    }

    return { spansInserted };
  }

  async listSessionsV2(params: ListSessionsV2Params): Promise<{ sessions: Record<string, unknown>[]; total: number }> {
    const { orgId, agentId, limit, offset, startDate, endDate, hasError, isComplete, minCost, maxCost } = params;
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (orgId !== undefined) {
      values.push(orgId);
      conditions.push(`s.org_id = $${values.length}`);
    }
    if (agentId !== undefined) {
      values.push(agentId);
      conditions.push(`s.agent_id = $${values.length}`);
    }
    if (startDate !== undefined) {
      values.push(startDate);
      conditions.push(`s.created_at >= $${values.length}::date`);
    }
    if (endDate !== undefined) {
      values.push(endDate);
      conditions.push(`s.created_at < ($${values.length}::date + INTERVAL '1 day')`);
    }
    if (hasError !== undefined) {
      values.push(hasError);
      conditions.push(`r.has_error = $${values.length}`);
    }
    if (isComplete !== undefined) {
      values.push(isComplete);
      conditions.push(`r.is_complete = $${values.length}`);
    }
    if (minCost !== undefined) {
      values.push(minCost);
      conditions.push(`COALESCE(r.total_cost_usd, 0) >= $${values.length}`);
    }
    if (maxCost !== undefined) {
      values.push(maxCost);
      conditions.push(`COALESCE(r.total_cost_usd, 0) <= $${values.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const selectQuery = `
      SELECT
        s.session_id,
        s.org_id,
        s.agent_id,
        s.created_at,
        r.total_spans AS total_events,
        r.llm_spans AS llm_calls,
        r.tool_spans AS tool_calls,
        r.error_count,
        r.total_tokens,
        r.total_cost_usd AS estimated_cost_usd,
        CASE
          WHEN r.total_cost_usd > 1    THEN 'high'
          WHEN r.total_cost_usd > 0.1  THEN 'medium'
          ELSE 'low'
        END AS cost_status,
        r.is_complete,
        r.has_error,
        r.last_span_at AS last_event_at,
        s.first_event_at
      FROM sessions_v2 s
      LEFT JOIN session_rollups_v2 r USING (session_id)
      ${where}
      ORDER BY s.created_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `;

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM sessions_v2 s
      LEFT JOIN session_rollups_v2 r USING (session_id)
      ${where}
    `;

    const [listResult, countResult] = await Promise.all([
      this.queryRead(selectQuery, [...values, limit, offset]),
      this.queryRead(countQuery, values),
    ]);

    const total = parseInt((countResult.rows[0] as { total: string }).total, 10);
    return { sessions: listResult.rows as Record<string, unknown>[], total };
  }

  async getSessionRollupV2(sessionId: string): Promise<Record<string, unknown> | null> {
    const result = await this.queryRead(
      `SELECT s.session_id, s.org_id, s.agent_id, s.created_at, s.first_event_at, r.*
       FROM sessions_v2 s
       LEFT JOIN session_rollups_v2 r USING (session_id)
       WHERE s.session_id = $1`,
      [sessionId]
    );
    return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
  }

  async getSpansForSessionV2(
    sessionId: string,
    params: GetSpansForSessionV2Params
  ): Promise<{ spans: Record<string, unknown>[]; total: number }> {
    const { limit, offset, eventType } = params;
    const conditions: string[] = ['session_id = $1'];
    const values: unknown[] = [sessionId];

    if (eventType !== undefined) {
      values.push(parseInt(eventType, 10));
      conditions.push(`kind = $${values.length}`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const [spansResult, countResult] = await Promise.all([
      this.queryRead(
        `SELECT id, span_id, trace_id, parent_span_id, source, name, kind,
                status_code, status_message, model_name, provider,
                start_time_ns, end_time_ns, duration_ns, org_id, agent_id, session_id, created_at
         FROM spans_v2
         ${where}
         ORDER BY start_time_ns ASC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset]
      ),
      this.queryRead(
        `SELECT COUNT(*) AS total FROM spans_v2 ${where}`,
        values
      ),
    ]);

    const total = parseInt((countResult.rows[0] as { total: string }).total, 10);
    return { spans: spansResult.rows as Record<string, unknown>[], total };
  }

  async getSpanAttributes(spanId: string): Promise<Record<string, unknown>[]> {
    const result = await this.queryRead(
      `SELECT key,
              COALESCE(value_str, value_int::text, value_float::text, value_bool::text) AS value,
              CASE
                WHEN value_str   IS NOT NULL THEN 'string'
                WHEN value_int   IS NOT NULL THEN 'int'
                WHEN value_float IS NOT NULL THEN 'float'
                WHEN value_bool  IS NOT NULL THEN 'bool'
                ELSE 'null'
              END AS value_type
       FROM span_attributes_v2
       WHERE span_id = $1
       ORDER BY key`,
      [spanId]
    );
    return result.rows as Record<string, unknown>[];
  }

  async getVersionMetrics(params: { orgId?: string; agentId?: string }): Promise<Record<string, unknown>[]> {
    const { orgId, agentId } = params;
    const conditions: string[] = ['r.agent_version IS NOT NULL'];
    const values: unknown[] = [];

    if (orgId !== undefined) {
      values.push(orgId);
      conditions.push(`r.org_id = $${values.length}`);
    }
    if (agentId !== undefined) {
      values.push(agentId);
      conditions.push(`r.agent_id = $${values.length}`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const result = await this.queryRead(
      `SELECT
         r.agent_id,
         r.agent_version,
         COUNT(*)                                             AS session_count,
         ROUND(AVG(r.total_tokens))                          AS avg_tokens,
         AVG(r.total_cost_usd)                               AS avg_cost_usd,
         AVG(r.total_duration_ns)                            AS avg_duration_ns,
         AVG(CASE WHEN r.has_error THEN 1.0 ELSE 0.0 END)   AS error_rate,
         SUM(r.total_cost_usd)                               AS total_cost_usd,
         ROUND(AVG(r.llm_spans))                             AS avg_llm_spans,
         ROUND(AVG(r.prompt_tokens))                         AS avg_prompt_tokens,
         ROUND(AVG(r.completion_tokens))                     AS avg_completion_tokens
       FROM session_rollups_v2 r
       ${where}
       GROUP BY r.agent_id, r.agent_version
       ORDER BY r.agent_id, r.agent_version`,
      values
    );
    return result.rows as Record<string, unknown>[];
  }

  async getAnalyticsV2(params: GetAnalyticsV2Params): Promise<Record<string, unknown>> {
    const { orgId, agentId, startDate, endDate } = params;
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (orgId !== undefined) {
      values.push(orgId);
      conditions.push(`s.org_id = $${values.length}`);
    }
    if (agentId !== undefined) {
      values.push(agentId);
      conditions.push(`s.agent_id = $${values.length}`);
    }
    if (startDate !== undefined) {
      values.push(startDate);
      conditions.push(`s.created_at >= $${values.length}::date`);
    }
    if (endDate !== undefined) {
      values.push(endDate);
      conditions.push(`s.created_at < ($${values.length}::date + INTERVAL '1 day')`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await this.queryRead(
      `SELECT
         COUNT(s.session_id)                       AS total_sessions,
         COALESCE(SUM(r.total_tokens), 0)          AS total_tokens,
         COALESCE(SUM(r.total_cost_usd), 0)        AS total_cost_usd,
         COALESCE(AVG(r.total_cost_usd), 0)        AS avg_cost_usd,
         COUNT(*) FILTER (WHERE r.has_error)       AS error_sessions
       FROM sessions_v2 s
       LEFT JOIN session_rollups_v2 r USING (session_id)
       ${where}`,
      values
    );

    const row = (result.rows[0] as Record<string, unknown> | undefined) ?? {};
    const totalSessions = parseInt(String(row['total_sessions'] ?? '0'), 10);
    const errorSessions = parseInt(String(row['error_sessions'] ?? '0'), 10);

    return {
      total_sessions: totalSessions,
      total_tokens: parseInt(String(row['total_tokens'] ?? '0'), 10),
      total_cost_usd: parseFloat(String(row['total_cost_usd'] ?? '0')),
      avg_cost_per_session: parseFloat(String(row['avg_cost_usd'] ?? '0')),
      error_sessions: errorSessions,
      error_rate: totalSessions > 0 ? errorSessions / totalSessions : 0,
    };
  }

  async getConversations(params: {
    orgId?: string;
    agentId?: string;
    limit: number;
    offset: number;
  }): Promise<{ conversations: Record<string, unknown>[]; total: number }> {
    const { orgId, agentId, limit, offset } = params;
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (orgId !== undefined) {
      values.push(orgId);
      conditions.push(`c.org_id = $${values.length}`);
    }
    if (agentId !== undefined) {
      values.push(agentId);
      conditions.push(`c.agent_id = $${values.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countValues = [...values];
    const dataValues = [...values, limit, offset];

    const [countResult, dataResult] = await Promise.all([
      this.queryRead(`SELECT COUNT(*) AS total FROM conversations c ${where}`, countValues),
      this.queryRead(
        `SELECT
           c.conversation_id,
           c.org_id,
           c.agent_id,
           c.title,
           c.session_count,
           c.first_session_at,
           c.last_session_at,
           c.created_at,
           COALESCE(
             json_agg(
               json_build_object(
                 'session_id', s.session_id,
                 'agent_version', s.agent_version,
                 'prompt_version', s.prompt_version,
                 'first_event_at', r.first_span_at,
                 'last_event_at', r.last_span_at,
                 'total_tokens', r.total_tokens,
                 'total_cost_usd', r.total_cost_usd,
                 'has_error', r.has_error,
                 'is_complete', r.is_complete
               ) ORDER BY COALESCE(r.first_span_at, s.created_at) ASC
             ) FILTER (WHERE s.session_id IS NOT NULL),
             '[]'
           ) AS sessions
         FROM conversations c
         LEFT JOIN sessions_v2 s ON s.conversation_id = c.conversation_id
         LEFT JOIN session_rollups_v2 r ON r.session_id = s.session_id
         ${where}
         GROUP BY c.conversation_id, c.org_id, c.agent_id, c.title,
                  c.session_count, c.first_session_at, c.last_session_at, c.created_at
         ORDER BY c.last_session_at DESC NULLS LAST
         LIMIT $${dataValues.length - 1} OFFSET $${dataValues.length}`,
        dataValues
      ),
    ]);

    const total = parseInt((countResult.rows[0] as { total: string }).total, 10);
    return { conversations: dataResult.rows as Record<string, unknown>[], total };
  }

  // ── Analytics methods ──────────────────────────────────────────────────────

  private buildAnalyticsWhere(params: {
    orgId?: string;
    agentId?: string;
    startDate?: string;
    endDate?: string;
  }, tableAlias = 'r'): { where: string; values: unknown[] } {
    const { orgId, agentId, startDate, endDate } = params;
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (orgId !== undefined) { values.push(orgId); conditions.push(`${tableAlias}.org_id = $${values.length}`); }
    if (agentId !== undefined) { values.push(agentId); conditions.push(`${tableAlias}.agent_id = $${values.length}`); }
    if (startDate !== undefined) { values.push(startDate); conditions.push(`${tableAlias}.first_span_at >= $${values.length}`); }
    if (endDate !== undefined) { values.push(endDate); conditions.push(`${tableAlias}.first_span_at < $${values.length}::date + interval '1 day'`); }
    return { where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '', values };
  }

  async getLatencyPercentiles(params: { orgId?: string; agentId?: string; startDate?: string; endDate?: string }): Promise<Record<string, unknown>[]> {
    const { where, values } = this.buildAnalyticsWhere(params, 's');
    const result = await this.queryRead(
      `SELECT
         s.agent_id,
         s.model_name,
         CASE
           WHEN s.name ILIKE '%llm%' OR s.name ILIKE '%chat%' OR s.name ILIKE '%completion%' THEN 'llm'
           WHEN s.name ILIKE '%tool%' THEN 'tool'
           ELSE 'other'
         END AS span_type,
         COUNT(*) AS sample_count,
         ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY s.duration_ns) / 1e6) AS p50_ms,
         ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY s.duration_ns) / 1e6) AS p95_ms,
         ROUND(percentile_cont(0.99) WITHIN GROUP (ORDER BY s.duration_ns) / 1e6) AS p99_ms,
         ROUND(AVG(s.duration_ns) / 1e6) AS avg_ms
       FROM spans_v2 s
       ${where}
       GROUP BY s.agent_id, s.model_name, span_type
       ORDER BY p95_ms DESC NULLS LAST`,
      values
    );
    return result.rows as Record<string, unknown>[];
  }

  async getSlowestSpans(params: { orgId?: string; agentId?: string; startDate?: string; endDate?: string; limit: number }): Promise<Record<string, unknown>[]> {
    const { limit, ...rest } = params;
    const { where, values } = this.buildAnalyticsWhere(rest, 's');
    values.push(limit);
    const result = await this.queryRead(
      `SELECT
         s.span_id, s.trace_id, s.session_id, s.name, s.model_name,
         s.agent_id, s.status_code,
         ROUND(s.duration_ns / 1e6) AS duration_ms,
         to_timestamp(s.start_time_ns / 1e9) AS started_at
       FROM spans_v2 s
       ${where}
       ORDER BY s.duration_ns DESC NULLS LAST
       LIMIT $${values.length}`,
      values
    );
    return result.rows as Record<string, unknown>[];
  }

  async getErrorClusters(params: { orgId?: string; agentId?: string; startDate?: string; endDate?: string }): Promise<Record<string, unknown>[]> {
    const { where, values } = this.buildAnalyticsWhere(params, 's');
    const result = await this.queryRead(
      `SELECT
         COALESCE(s.status_message, '(no message)') AS error_message,
         s.agent_id,
         COUNT(*) AS occurrence_count,
         COUNT(DISTINCT s.session_id) AS affected_sessions,
         MAX(to_timestamp(s.start_time_ns / 1e9)) AS last_seen_at
       FROM spans_v2 s
       ${where ? `${where} AND s.status_code = 2` : 'WHERE s.status_code = 2'}
       GROUP BY s.status_message, s.agent_id
       ORDER BY occurrence_count DESC
       LIMIT 50`,
      values
    );
    return result.rows as Record<string, unknown>[];
  }

  async getErrorRateByVersion(params: { orgId?: string; agentId?: string; startDate?: string; endDate?: string }): Promise<Record<string, unknown>[]> {
    const { where, values } = this.buildAnalyticsWhere(params, 'r');
    const result = await this.queryRead(
      `SELECT
         r.agent_id,
         r.agent_version,
         COUNT(*) AS session_count,
         SUM(CASE WHEN r.has_error THEN 1 ELSE 0 END) AS error_sessions,
         ROUND(AVG(CASE WHEN r.has_error THEN 1.0 ELSE 0.0 END) * 100, 2) AS error_rate_pct
       FROM session_rollups_v2 r
       ${where ? `${where} AND r.agent_version IS NOT NULL` : 'WHERE r.agent_version IS NOT NULL'}
       GROUP BY r.agent_id, r.agent_version
       ORDER BY r.agent_id, r.agent_version`,
      values
    );
    return result.rows as Record<string, unknown>[];
  }

  async getToolFailures(params: { orgId?: string; agentId?: string; startDate?: string; endDate?: string }): Promise<Record<string, unknown>[]> {
    const { where, values } = this.buildAnalyticsWhere(params, 's');
    const result = await this.queryRead(
      `SELECT
         s.name AS tool_name,
         s.agent_id,
         COUNT(*) AS total_calls,
         SUM(CASE WHEN s.status_code = 2 THEN 1 ELSE 0 END) AS error_count,
         ROUND(SUM(CASE WHEN s.status_code = 2 THEN 1.0 ELSE 0.0 END) / COUNT(*) * 100, 2) AS error_rate_pct,
         ROUND(AVG(s.duration_ns) / 1e6) AS avg_duration_ms
       FROM spans_v2 s
       ${where ? `${where} AND (s.name ILIKE '%tool%' OR s.kind = 4)` : "WHERE s.name ILIKE '%tool%' OR s.kind = 4"}
       GROUP BY s.name, s.agent_id
       ORDER BY error_count DESC, total_calls DESC
       LIMIT 50`,
      values
    );
    return result.rows as Record<string, unknown>[];
  }

  async getPromptLengthDistribution(params: { orgId?: string; agentId?: string; startDate?: string; endDate?: string }): Promise<Record<string, unknown>[]> {
    const { where, values } = this.buildAnalyticsWhere(params, 'u');
    const result = await this.queryRead(
      `SELECT
         width_bucket(u.prompt_tokens, 0, 128000, 20) AS bucket,
         (width_bucket(u.prompt_tokens, 0, 128000, 20) - 1) * 6400 AS bucket_start,
         width_bucket(u.prompt_tokens, 0, 128000, 20) * 6400 AS bucket_end,
         COUNT(*) AS span_count,
         ROUND(AVG(u.prompt_tokens)) AS avg_prompt_tokens
       FROM usage_facts_v2 u
       ${where ? `${where} AND u.prompt_tokens > 0` : 'WHERE u.prompt_tokens > 0'}
       GROUP BY bucket
       ORDER BY bucket`,
      values
    );
    return result.rows as Record<string, unknown>[];
  }

  async getPromptCompletionRatio(params: { orgId?: string; agentId?: string; startDate?: string; endDate?: string }): Promise<Record<string, unknown>[]> {
    const { where, values } = this.buildAnalyticsWhere(params, 'u');
    const result = await this.queryRead(
      `SELECT
         u.model_name,
         u.agent_id,
         COUNT(*) AS sample_count,
         ROUND(AVG(u.prompt_tokens)) AS avg_prompt_tokens,
         ROUND(AVG(u.completion_tokens)) AS avg_completion_tokens,
         ROUND(AVG(CASE WHEN u.completion_tokens > 0
               THEN u.prompt_tokens::numeric / u.completion_tokens ELSE NULL END), 2) AS avg_prompt_completion_ratio
       FROM usage_facts_v2 u
       ${where ? `${where} AND u.prompt_tokens > 0 AND u.completion_tokens > 0` : 'WHERE u.prompt_tokens > 0 AND u.completion_tokens > 0'}
       GROUP BY u.model_name, u.agent_id
       ORDER BY avg_prompt_completion_ratio DESC NULLS LAST`,
      values
    );
    return result.rows as Record<string, unknown>[];
  }

  async getTokenCostHeatmap(params: { orgId?: string; agentId?: string; startDate?: string; endDate?: string }): Promise<Record<string, unknown>[]> {
    const { where, values } = this.buildAnalyticsWhere(params, 'c');
    const result = await this.queryRead(
      `SELECT
         c.model_name,
         c.provider,
         COUNT(*) AS span_count,
         SUM(c.total_cost_usd) AS total_cost_usd,
         ROUND(AVG(c.total_cost_usd), 6) AS avg_cost_usd,
         SUM(u.prompt_tokens) AS total_prompt_tokens,
         SUM(u.completion_tokens) AS total_completion_tokens,
         SUM(u.cache_read_tokens) AS total_cache_read_tokens
       FROM cost_facts_v2 c
       LEFT JOIN usage_facts_v2 u ON u.span_id = c.span_id AND u.trace_id = c.trace_id
       ${where}
       GROUP BY c.model_name, c.provider
       ORDER BY total_cost_usd DESC NULLS LAST`,
      values
    );
    return result.rows as Record<string, unknown>[];
  }

  async getCacheEfficiency(params: { orgId?: string; agentId?: string; startDate?: string; endDate?: string }): Promise<Record<string, unknown>[]> {
    const { where, values } = this.buildAnalyticsWhere(params, 'u');
    const result = await this.queryRead(
      `SELECT
         u.model_name,
         u.agent_id,
         u.session_id,
         SUM(u.total_tokens) AS total_tokens,
         SUM(u.cache_read_tokens) AS cache_read_tokens,
         ROUND(
           CASE WHEN SUM(u.total_tokens) > 0
             THEN SUM(u.cache_read_tokens)::numeric / SUM(u.total_tokens) * 100
             ELSE 0 END, 2
         ) AS cache_hit_rate_pct
       FROM usage_facts_v2 u
       ${where ? `${where} AND u.total_tokens > 0` : 'WHERE u.total_tokens > 0'}
       GROUP BY u.model_name, u.agent_id, u.session_id
       ORDER BY cache_hit_rate_pct ASC`,
      values
    );
    return result.rows as Record<string, unknown>[];
  }

  async getSpendTrend(params: { orgId?: string; agentId?: string; startDate?: string; endDate?: string; granularity: 'day' | 'week' }): Promise<Record<string, unknown>[]> {
    const { granularity, ...rest } = params;
    const { where, values } = this.buildAnalyticsWhere(rest, 'c');
    const result = await this.queryRead(
      `SELECT
         date_trunc($${values.length + 1}, c.event_date::timestamptz) AS period,
         c.agent_id,
         r.agent_version,
         SUM(c.total_cost_usd) AS total_cost_usd,
         COUNT(DISTINCT c.session_id) AS session_count
       FROM cost_facts_v2 c
       LEFT JOIN session_rollups_v2 r ON r.session_id = c.session_id
       ${where}
       GROUP BY period, c.agent_id, r.agent_version
       ORDER BY period ASC`,
      [...values, granularity]
    );
    return result.rows as Record<string, unknown>[];
  }

  async getCostPerOutputToken(params: { orgId?: string; agentId?: string; startDate?: string; endDate?: string }): Promise<Record<string, unknown>[]> {
    const { where, values } = this.buildAnalyticsWhere(params, 'c');
    const result = await this.queryRead(
      `SELECT
         c.model_name,
         c.provider,
         c.agent_id,
         SUM(c.total_cost_usd) AS total_cost_usd,
         SUM(u.completion_tokens) AS total_completion_tokens,
         ROUND(
           CASE WHEN SUM(u.completion_tokens) > 0
             THEN SUM(c.total_cost_usd) / SUM(u.completion_tokens) * 1000000
             ELSE NULL END, 4
         ) AS cost_per_1m_output_tokens
       FROM cost_facts_v2 c
       LEFT JOIN usage_facts_v2 u ON u.span_id = c.span_id AND u.trace_id = c.trace_id
       ${where ? `${where} AND u.completion_tokens > 0` : 'WHERE u.completion_tokens > 0'}
       GROUP BY c.model_name, c.provider, c.agent_id
       ORDER BY cost_per_1m_output_tokens DESC NULLS LAST`,
      values
    );
    return result.rows as Record<string, unknown>[];
  }

  async getSessionSpanCosts(sessionId: string): Promise<Record<string, unknown>[]> {
    const result = await this.queryRead(
      `SELECT
         s.span_id,
         s.name AS span_name,
         s.model_name,
         ROUND(s.duration_ns / 1e6) AS duration_ms,
         COALESCE(c.total_cost_usd, 0) AS total_cost_usd,
         COALESCE(u.prompt_tokens, 0) AS prompt_tokens,
         COALESCE(u.completion_tokens, 0) AS completion_tokens,
         COALESCE(u.cache_read_tokens, 0) AS cache_read_tokens
       FROM spans_v2 s
       LEFT JOIN cost_facts_v2 c ON c.span_id = s.span_id AND c.session_id = s.session_id
       LEFT JOIN usage_facts_v2 u ON u.span_id = s.span_id AND u.session_id = s.session_id
       WHERE s.session_id = $1
       ORDER BY c.total_cost_usd DESC NULLS LAST`,
      [sessionId]
    );
    return result.rows as Record<string, unknown>[];
  }

  async searchSpanAttributes(params: {
    query: string;
    orgId?: string;
    agentId?: string;
    limit: number;
  }): Promise<Record<string, unknown>[]> {
    const { query, orgId, agentId, limit } = params;
    const conditions: string[] = ['to_tsvector(\'english\', COALESCE(a.value_str, \'\')) @@ plainto_tsquery(\'english\', $1)'];
    const values: unknown[] = [query];

    if (orgId !== undefined) { values.push(orgId); conditions.push(`s.org_id = $${values.length}`); }
    if (agentId !== undefined) { values.push(agentId); conditions.push(`s.agent_id = $${values.length}`); }

    values.push(limit);

    const result = await this.queryRead(
      `SELECT DISTINCT
         a.span_id,
         a.trace_id,
         s.session_id,
         s.name AS span_name,
         s.model_name,
         s.status_code,
         a.key AS matched_key,
         ts_headline('english', a.value_str, plainto_tsquery('english', $1),
           'MaxFragments=1,MaxWords=20,MinWords=5') AS snippet
       FROM span_attributes_v2 a
       JOIN spans_v2 s ON s.span_id = a.span_id AND s.trace_id = a.trace_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY a.span_id
       LIMIT $${values.length}`,
      values
    );
    return result.rows as Record<string, unknown>[];
  }

  async deleteSessionV2(sessionId: string): Promise<void> {
    await this.query('DELETE FROM sessions_v2 WHERE session_id = $1', [sessionId]);
  }

  public getPoolStats() {
    if (!this.pool) return null;
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
    };
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.logger.info('Database pool closed');
    }
  }
}
