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
import type { ResolvedTraceIdentity, OtlpSource } from '../services/otlp.service';
import type { PersistOtlpV2Span } from '../services/database.service';

function setOtlpSource(res: Response, s: OtlpSource): void {
  res.locals['otlpSource'] = s;
}

function getOtlpSource(res: Response): OtlpSource {
  const v = res.locals['otlpSource'];
  if (v === 'webhook' || v === 'sdk' || v === 'openrouter') return v;
  return 'sdk';
}

function createTraceIdentity(
  sessionId: string,
  orgId?: string,
  agentId?: string
): ResolvedTraceIdentity {
  const identity: ResolvedTraceIdentity = { sessionId };
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
      setOtlpSource(res, 'webhook');
      next();
      return;
    }

    if (
      apiKey.length > 0 &&
      typeof incomingApiKey === 'string' &&
      incomingApiKey === apiKey
    ) {
      setOtlpSource(res, 'sdk');
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
      const source = getOtlpSource(res);
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
      const traceResolutions = new Map<string, ResolvedTraceIdentity>();

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

          const startTimeNs = d.start_time_ns !== undefined ? BigInt(d.start_time_ns) : 0n;
          const endTimeNs   = d.end_time_ns   !== undefined ? BigInt(d.end_time_ns)   : 0n;

          const usage = d.usage
            ? {
                promptTokens:     d.usage.prompt_tokens,
                completionTokens: d.usage.completion_tokens,
                totalTokens:      d.usage.total_tokens,
              }
            : null;

          const span: PersistOtlpV2Span = {
            spanId:        d.span_id,
            parentSpanId:  d.parent_span_id ?? null,
            name:          d.span_name,
            kind:          d.span_kind ?? 0,
            statusCode:    d.status_code ?? 0,
            statusMessage: d.status_message ?? null,
            model:         d.model ?? null,
            provider:      d.provider,
            startTimeNs,
            endTimeNs,
            attributes:    d.attributes,
            usage,
          };

          const traceId = d.trace_id;
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
