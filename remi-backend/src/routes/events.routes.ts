import { Router } from 'express';
import type { Request, Response } from 'express';
import { DatabaseService, RedisService } from '../services';
import { Logger } from '../services/logger';
import { requireApiKey } from '../middleware';
import { EventsListQuerySchema } from '../types/validation';
import {
  RequestScope,
  RequestScopeResolutionError,
  resolveRequestScope,
} from '../utils/request-scope';

export function createEventsRoutes(
  getDatabase: () => DatabaseService | null,
  getRedis: () => RedisService | null,
  logger: Logger
): Router {
  const router = Router();

  const getRequestId = (res: Response): string => {
    const id = res.getHeader('x-request-id');
    return typeof id === 'string' ? id : 'n/a';
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

  return router;
}
