import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { trace } from '@opentelemetry/api';
import { DatabaseService, KafkaService, RedisService } from '../services';
import { Logger } from '../services/logger';
import { requireApiKey, validateBody } from '../middleware';
import { EventBatchSchema, EventsListQuerySchema, GeneralEventsListQuerySchema, ValidatedEventBatch } from '../types/validation';
import { OrgIdResolutionError, resolveOrgId } from '../utils/org-id';
import {
  RequestScope,
  RequestScopeResolutionError,
  resolveRequestScope,
} from '../utils/request-scope';

export function createEventsRoutes(
  getDatabase: () => DatabaseService | null,
  getKafka: () => KafkaService | null,
  getRedis: () => RedisService | null,
  logger: Logger
): Router {
  const router = Router();

  const getRequestId = (res: Response): string => {
    const id = res.getHeader('x-request-id');
    return typeof id === 'string' ? id : 'n/a';
  };

  const getExistingOrgId = (session: Record<string, unknown> | null): string | null => {
    const orgId = session?.['org_id'];
    return typeof orgId === 'string' && orgId.trim() ? orgId : null;
  };

  const getRequestedScope = (req: Request): RequestScope =>
    resolveRequestScope({
      queryOrgId: req.query.org_id,
      headerOrgId: req.headers['x-org-id'],
      queryAgentId: req.query.agent_id,
      headerAgentId: req.headers['x-agent-id'],
    });

  const getScopeCacheSegment = ({ orgId, agentId }: RequestScope): string =>
    `org:${orgId ?? 'all'}:agent:${agentId ?? 'all'}`;

  router.get('/sessions/:sessionId/events', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params as { sessionId: string };
    const requestId = getRequestId(res);

    try {
      const scope = getRequestedScope(req);
      const database = getDatabase();
      const redis = getRedis();

      const queryResult = EventsListQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid query parameters',
          details: queryResult.error.issues.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        });
        return;
      }
      const { limit, offset, event_type: eventType } = queryResult.data;

      logger.debug('Session events query start', {
        requestId,
        sessionId,
        limit,
        offset,
        eventType: eventType || null,
        orgId: scope.orgId,
        agentId: scope.agentId,
      });

      const cacheKey = `events:v2:${getScopeCacheSegment(scope)}:${sessionId}:${limit}:${offset}${
        eventType ? `:${eventType}` : ''
      }`;
      if (redis) {
        const cached = await redis.getJSON(cacheKey);
        if (cached) {
          logger.debug('Session events served from cache', { requestId, sessionId, cacheKey });
          res.json({ success: true, data: cached, source: 'cache' });
          return;
        }
      }

      if (!database) {
        res.status(503).json({ success: false, error: 'Database not available yet.' });
        return;
      }

      const spansParams: Parameters<typeof database.getSpansForSessionV2>[1] = { limit, offset };
      if (eventType) spansParams.eventType = eventType;
      const { spans, total } = await database.getSpansForSessionV2(sessionId, spansParams);

      const responseData = {
        events: spans,
        pagination: { limit, offset, total, hasMore: offset + limit < total },
      };

      if (redis) {
        await redis.setJSON(cacheKey, responseData, 10);
      }

      logger.info('Session events query complete', {
        requestId,
        sessionId,
        source: 'database',
        returned: spans.length,
        total,
        hasMore: offset + limit < total,
        orgId: scope.orgId,
        agentId: scope.agentId,
      });

      res.json({ success: true, data: responseData, source: 'database' });
    } catch (err) {
      if (err instanceof RequestScopeResolutionError) {
        res.status(err.status).json({ success: false, error: err.message });
        return;
      }

      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(`Error fetching session events [${sessionId}]:`, error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/spans/:spanId/attributes', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    const { spanId } = req.params as { spanId: string };
    const database = getDatabase();
    if (!database) {
      res.status(503).json({ success: false, error: 'Database not available' });
      return;
    }
    try {
      const attrs = await database.getSpanAttributes(spanId);
      res.json({ success: true, data: { span_id: spanId, attributes: attrs } });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(`Error fetching attributes for span ${spanId}:`, error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/health', (_req: Request, res: Response): void => {
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
    });
  });

  router.post(
    '/batch',
    requireApiKey,
    validateBody(EventBatchSchema),
    async (req: Request, res: Response): Promise<void> => {
      const requestId = getRequestId(res);
      try {
        const database = getDatabase();
        const kafka = getKafka();
        const redis = getRedis();
        const { events, session_id, org_id, agent_id } = req.body as ValidatedEventBatch;

        const resolvedSessionId =
          typeof session_id === 'string' && session_id.trim()
            ? session_id.trim()
            : `session-${Date.now()}-${randomUUID().split('-')[0]}`;

        const existingSession = database ? await database.getSession(resolvedSessionId) : null;
        const resolvedOrgId = resolveOrgId({
          bodyOrgId: org_id,
          headerOrgId: req.headers['x-org-id'],
          existingOrgId: getExistingOrgId(existingSession),
          sessionId: resolvedSessionId,
        });

        const rawHeaderAgentId = req.headers['x-agent-id'];
        const headerAgentId = Array.isArray(rawHeaderAgentId) ? rawHeaderAgentId[0] : rawHeaderAgentId;
        const normalizedBodyAgentId =
          typeof agent_id === 'string' && agent_id.trim() ? agent_id.trim() : null;
        const normalizedHeaderAgentId =
          typeof headerAgentId === 'string' && headerAgentId.trim() ? headerAgentId.trim() : null;
        if (
          normalizedBodyAgentId !== null &&
          normalizedHeaderAgentId !== null &&
          normalizedBodyAgentId !== normalizedHeaderAgentId
        ) {
          res.status(400).json({
            success: false,
            error: 'agent_id in request body does not match X-Agent-Id header',
          });
          return;
        }
        const requestAgentId = normalizedBodyAgentId ?? normalizedHeaderAgentId;
        const existingAgentId =
          typeof existingSession?.['agent_id'] === 'string' ? existingSession['agent_id'] : null;
        if (requestAgentId !== null && existingAgentId !== null && requestAgentId !== existingAgentId) {
          res.status(409).json({
            success: false,
            error: `Conflicting agent_id for session ${resolvedSessionId}`,
          });
          return;
        }
        const resolvedAgentId = existingAgentId ?? requestAgentId;

        const activeSpan = trace.getActiveSpan();
        if (activeSpan) {
          activeSpan.setAttributes({
            'remi.session_id': resolvedSessionId,
            'remi.org_id': resolvedOrgId ?? '',
            'remi.agent_id': resolvedAgentId ?? '',
            'remi.events.count': events.length,
          });
        }

        logger.info(`Batch ingestion: ${events.length} events (session: ${resolvedSessionId})`);

        const LARGE_EVENT_THRESHOLD_BYTES = 102400;
        events.forEach((event, idx) => {
          if (event.data) {
            const dataSize = JSON.stringify(event.data).length;
            if (dataSize > LARGE_EVENT_THRESHOLD_BYTES) {
              logger.warn('Large event detected', {
                requestId,
                sessionId: resolvedSessionId,
                eventIndex: idx,
                eventType: event.event_type,
                dataSizeBytes: dataSize,
                dataSizeKB: (dataSize / 1024).toFixed(2),
                seq: event._seq ?? null,
              });
            }
          }
        });

        logger.debug('Batch ingestion details', {
          requestId,
          sessionId: resolvedSessionId,
          orgId: resolvedOrgId,
          agentId: resolvedAgentId,
          eventsCount: events.length,
          hasKafka: !!kafka,
          hasRedis: !!redis,
          hasDatabase: !!database,
        });

        let kafkaPublished = false;
        if (kafka) {
          try {
            await kafka.publishEventBatch(resolvedSessionId, events, undefined, {
              requestId,
              orgId: resolvedOrgId,
              agentId: resolvedAgentId,
            });
            kafkaPublished = true;
          } catch (kafkaError) {
            logger.warn('Failed to publish batch to Kafka:', kafkaError);
          }
        } else {
          logger.warn('Kafka unavailable — batch not published');
        }

        if (redis) {
          try {
            await redis.invalidatePattern(`events:*:${resolvedSessionId}:*`);
          } catch (cacheError) {
            logger.warn('Failed to invalidate cache:', cacheError);
          }
        }

        if (!kafkaPublished) {
          res.status(207).json({
            success: true,
            events_received: events.length,
            session_id: resolvedSessionId,
            org_id: resolvedOrgId,
            agent_id: resolvedAgentId,
            kafka_published: false,
            warning: 'Kafka unavailable — events were not queued for processing. Retry the batch.',
          });
          logger.warn('Batch ingestion accepted but not queued to Kafka', {
            requestId,
            sessionId: resolvedSessionId,
            orgId: resolvedOrgId,
            agentId: resolvedAgentId,
            eventsCount: events.length,
          });
          return;
        }

        res.status(202).json({
          success: true,
          events_received: events.length,
          session_id: resolvedSessionId,
          org_id: resolvedOrgId,
          agent_id: resolvedAgentId,
          kafka_published: true,
          message: 'Events ingested and queued for processing',
        });
        logger.info('Batch ingestion complete', {
          requestId,
          sessionId: resolvedSessionId,
          orgId: resolvedOrgId,
          agentId: resolvedAgentId,
          eventsCount: events.length,
          kafkaPublished,
        });
      } catch (err) {
        if (err instanceof OrgIdResolutionError) {
          res.status(err.status).json({ success: false, error: err.message });
          return;
        }

        const error = err instanceof Error ? err : new Error(String(err));
        logger.error('Batch ingest error:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    }
  );

  router.get('/', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    const requestId = getRequestId(res);
    const database = getDatabase();

    const queryResult = GeneralEventsListQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid query parameters',
        details: queryResult.error.issues.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      });
      return;
    }
    const { limit, offset, session_id: sessionParam, event_type: eventTypeParam } = queryResult.data;

    try {
      const scope = getRequestedScope(req);
      logger.debug('List events query start', {
        requestId,
        limit,
        offset,
        sessionId: sessionParam || null,
        eventType: eventTypeParam || null,
        orgId: scope.orgId,
        agentId: scope.agentId,
      });

      if (!database) {
        res.status(503).json({ success: false, error: 'Database not available yet.' });
        return;
      }

      if (!sessionParam) {
        res.json({
          success: true,
          data: {
            events: [],
            pagination: { limit, offset, total: 0, hasMore: false },
          },
          source: 'database',
        });
        return;
      }

      const redis = getRedis();
      const getScopeCacheSegmentLocal = (s: { orgId: string | null; agentId: string | null }) =>
        `${s.orgId ?? 'null'}:${s.agentId ?? 'null'}`;
      const cacheKey = `events:v2:general:${getScopeCacheSegmentLocal(scope)}:${sessionParam}:${eventTypeParam ?? 'all'}:${limit}:${offset}`;

      if (redis) {
        const cached = await redis.getJSON(cacheKey);
        if (cached) {
          logger.debug('General events served from cache', { requestId, cacheKey });
          res.json({ success: true, data: cached, source: 'cache' });
          return;
        }
      }

      const generalSpansParams: Parameters<typeof database.getSpansForSessionV2>[1] = { limit, offset };
      if (eventTypeParam) generalSpansParams.eventType = eventTypeParam;
      const { spans, total } = await database.getSpansForSessionV2(sessionParam, generalSpansParams);

      const responseData = {
        events: spans,
        pagination: { limit, offset, total, hasMore: offset + limit < total },
      };

      if (redis) {
        await redis.setJSON(cacheKey, responseData, 10);
      }

      res.json({
        success: true,
        data: responseData,
        source: 'database',
      });
      logger.info('List events query complete', {
        requestId,
        total,
        returned: spans.length,
        limit,
        offset,
        orgId: scope.orgId,
        agentId: scope.agentId,
      });
    } catch (err) {
      if (err instanceof RequestScopeResolutionError) {
        res.status(err.status).json({ success: false, error: err.message });
        return;
      }

      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('Error listing events:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}
