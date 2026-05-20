import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import type { DatabaseService } from '../services';
import { Logger } from '../services/logger';
import { validateBody } from '../middleware';
import { OtlpPayloadSchema } from '../types/validation';
import type { OtlpPayload } from '../types/validation';
import {
  collectTraceResolutionCandidates,
  normalizeOtlpPayload,
} from '../services/otlp.service';
import type { TraceIdentity } from '../services/otlp.service';
import type { PersistOtlpV2Span } from '../services/database.service';

function createTraceIdentity(
  sessionId: string,
  orgId?: string,
  agentId?: string
): TraceIdentity {
  const identity: TraceIdentity = { sessionId };
  if (orgId !== undefined) identity.orgId = orgId;
  if (agentId !== undefined) identity.agentId = agentId;
  return identity;
}

function createSessionId(): string {
  return `session-${Date.now()}-${randomUUID().split('-')[0]}`;
}

export function createTracesRoutes(
  getDatabase: () => DatabaseService | null,
  logger: Logger
): Router {
  const router = Router();

  const webhookSecret = process.env.REMI_WEBHOOK_SECRET ?? '';
  const apiKey = process.env.REMI_API_KEY ?? '';

  const authenticate = (req: Request, res: Response, next: NextFunction): void => {
    if (req.headers['x-test-connection'] === 'true') {
      res.status(200).json({ success: true, data: { status: 'ok' } });
      return;
    }

    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.includes('application/json')) {
      res.status(415).json({ success: false, error: 'Content-Type must be application/json' });
      return;
    }

    const incomingWebhookSecret = req.headers['x-remi-webhook-secret'];
    const incomingApiKey = req.headers['x-api-key'];

    if (
      webhookSecret.length > 0 &&
      typeof incomingWebhookSecret === 'string' &&
      incomingWebhookSecret === webhookSecret
    ) {
      res.locals['otlpSource'] = 'webhook';
      next();
      return;
    }

    if (
      apiKey.length > 0 &&
      typeof incomingApiKey === 'string' &&
      incomingApiKey === apiKey
    ) {
      res.locals['otlpSource'] = 'sdk';
      next();
      return;
    }

    res.status(401).json({ success: false, error: 'Unauthorized' });
  };

  router.post(
    ['/batch', '/v1/traces'],
    authenticate,
    validateBody(OtlpPayloadSchema),
    async (req: Request, res: Response): Promise<void> => {
      const source = (res.locals['otlpSource'] as 'webhook' | 'sdk') ?? 'sdk';
      const requestId = res.getHeader('x-request-id');
      const reqId = typeof requestId === 'string' ? requestId : 'n/a';

      const payload = req.body as OtlpPayload;

      const headerOrgId = req.headers['x-remi-org-id'];
      const headerAgentId = req.headers['x-remi-agent-id'];
      const headerIdentity: { orgId?: string; agentId?: string } = {};
      if (typeof headerOrgId === 'string' && headerOrgId.length > 0) headerIdentity.orgId = headerOrgId;
      if (typeof headerAgentId === 'string' && headerAgentId.length > 0) headerIdentity.agentId = headerAgentId;

      if (!payload.resourceSpans || payload.resourceSpans.length === 0) {
        res.status(400).json({
          success: false,
          error: 'resourceSpans is required and must not be empty',
        });
        return;
      }

      const db = getDatabase();
      if (!db) {
        res.status(503).json({ success: false, error: 'Database not available' });
        return;
      }

      const filteredResourceSpans = (payload.resourceSpans ?? []).filter((rs) => {
        const ns = (rs.resource?.attributes ?? []).find(
          (a) => a.key === 'service.namespace'
        );
        return ns?.value?.stringValue !== 'remi-internal';
      });

      if (filteredResourceSpans.length === 0) {
        res.status(202).json({
          success: true,
          data: { accepted: 0, sessions: 0 },
        });
        return;
      }

      const filteredPayload = { ...payload, resourceSpans: filteredResourceSpans };

      const traceCandidates = collectTraceResolutionCandidates(filteredPayload);
      const traceResolutions = new Map<string, TraceIdentity>();

      for (const candidate of traceCandidates) {
        let traceMapping = null;
        if (candidate.explicitIdentity.sessionId === undefined) {
          traceMapping = await db.getTraceSessionMapping(candidate.traceId);
        }

        let aliasMapping = null;
        if (candidate.explicitIdentity.sessionId === undefined && traceMapping === null) {
          for (const alias of candidate.aliases) {
            aliasMapping = await db.getProviderAliasSession(
              alias.provider,
              alias.aliasType,
              alias.aliasValue
            );
            if (aliasMapping !== null) break;
          }
        }

        const sessionId =
          candidate.explicitIdentity.sessionId ??
          traceMapping?.sessionId ??
          aliasMapping?.sessionId ??
          createSessionId();

        const orgId =
          candidate.explicitIdentity.orgId ??
          headerIdentity.orgId ??
          traceMapping?.orgId ??
          aliasMapping?.orgId;

        const agentId =
          candidate.explicitIdentity.agentId ??
          headerIdentity.agentId ??
          traceMapping?.agentId ??
          aliasMapping?.agentId;

        traceResolutions.set(candidate.traceId, createTraceIdentity(sessionId, orgId, agentId));
      }

      const batches = normalizeOtlpPayload(filteredPayload, source, headerIdentity, traceResolutions);

      if (batches.length === 0) {
        res.status(400).json({
          success: false,
          error: 'No processable spans found in payload',
        });
        return;
      }

      const totalSpanCount = batches.reduce((sum, b) => sum + b.events.length, 0);

      logger.info('OTLP traces ingest received', {
        requestId: reqId,
        source,
        batchCount: batches.length,
        totalSpans: totalSpanCount,
      });

      const pricing = await db.loadModelPricing();
      const pricingRecord: Record<string, { input_cost_per_1m: number; output_cost_per_1m: number }> = {};
      for (const [k, v] of pricing.entries()) {
        pricingRecord[k] = v;
      }

      let totalSpansInserted = 0;
      const sessionIds: string[] = [];

      for (const batch of batches) {
        sessionIds.push(batch.session_id);

        const traceSpanMap = new Map<string, PersistOtlpV2Span[]>();

        for (const event of batch.events) {
          const d = event.data;
          const traceId = typeof d['trace_id'] === 'string' ? d['trace_id'] : 'unknown';
          const spanId = typeof d['span_id'] === 'string' ? d['span_id'] : '';
          const spanName = typeof d['span_name'] === 'string' ? d['span_name'] : '';
          const kind = typeof d['span_kind'] === 'number' ? d['span_kind'] : 0;
          const statusCode = typeof d['status_code'] === 'number' ? d['status_code'] : 0;
          const statusMessage = typeof d['status_message'] === 'string' ? d['status_message'] : null;
          const parentSpanId = typeof d['parent_span_id'] === 'string' ? d['parent_span_id'] : null;
          const startTimeNs = typeof d['start_time_ns'] === 'string' ? BigInt(d['start_time_ns']) :
                              typeof d['start_time_ns'] === 'number' ? d['start_time_ns'] : 0;
          const endTimeNs = typeof d['end_time_ns'] === 'string' ? BigInt(d['end_time_ns']) :
                            typeof d['end_time_ns'] === 'number' ? d['end_time_ns'] : 0;

          const model = typeof d['model'] === 'string' && d['model'].length > 0 ? d['model'] : null;

          const rawAttrs = d['attributes'];
          const provider = rawAttrs && typeof rawAttrs === 'object' && !Array.isArray(rawAttrs)
            ? (() => {
                const a = rawAttrs as Record<string, unknown>;
                for (const key of ['gen_ai.system', 'llm.system', 'llm.provider', 'openinference.provider', 'provider']) {
                  const val = a[key];
                  if (typeof val === 'string' && val.length > 0) return val;
                }
                return null;
              })()
            : null;

          const rawUsage = d['usage'];
          let usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null = null;
          if (rawUsage && typeof rawUsage === 'object' && !Array.isArray(rawUsage)) {
            const u = rawUsage as Record<string, unknown>;
            const built: { promptTokens?: number; completionTokens?: number; totalTokens?: number } = {};
            if (typeof u['prompt_tokens'] === 'number') built.promptTokens = u['prompt_tokens'];
            if (typeof u['completion_tokens'] === 'number') built.completionTokens = u['completion_tokens'];
            if (typeof u['total_tokens'] === 'number') built.totalTokens = u['total_tokens'];
            usage = built;
          }

          const span: PersistOtlpV2Span = {
            spanId,
            parentSpanId,
            name: spanName,
            kind,
            statusCode,
            statusMessage,
            model,
            provider,
            startTimeNs,
            endTimeNs,
            attributes: rawAttrs && typeof rawAttrs === 'object' && !Array.isArray(rawAttrs)
              ? (rawAttrs as Record<string, unknown>)
              : {},
            usage,
          };

          const existing = traceSpanMap.get(traceId);
          if (existing) {
            existing.push(span);
          } else {
            traceSpanMap.set(traceId, [span]);
          }
        }

        const orgId = batch.org_id ?? 'unknown';
        const agentId = batch.agent_id ?? 'unknown';

        for (const [traceId, spans] of traceSpanMap.entries()) {
          try {
            const result = await db.persistOtlpV2({
              sessionId: batch.session_id,
              traceId,
              orgId,
              agentId,
              ...(batch.agent_version !== undefined ? { agentVersion: batch.agent_version } : {}),
              ...(batch.conversation_id !== undefined ? { conversationId: batch.conversation_id } : {}),
              ...(batch.prompt_version !== undefined ? { promptVersion: batch.prompt_version } : {}),
              ...(batch.final_output !== undefined ? { finalOutput: batch.final_output } : {}),
              spans,
              modelPricing: pricingRecord,
            });
            totalSpansInserted += result.spansInserted;
          } catch (persistError) {
            logger.warn('Failed to persist OTLP V2 trace', {
              requestId: reqId,
              sessionId: batch.session_id,
              traceId,
              error: persistError,
            });
          }
        }
      }

      logger.info('OTLP traces stored to V2', {
        requestId: reqId,
        source,
        totalSpans: totalSpanCount,
        spansInserted: totalSpansInserted,
        sessions: sessionIds.length,
      });

      res.status(202).json({
        success: true,
        data: {
          accepted: totalSpanCount,
          sessions: sessionIds,
          stored: 'v2',
        },
      });
    }
  );

  return router;
}
