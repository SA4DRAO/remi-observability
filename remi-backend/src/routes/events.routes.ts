import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { ClickHouseService, SpanRow } from '../services/clickhouse.service';
import type { DatabaseService } from '../services/database.service';
import type { Logger } from '../services/logger';
import { getKeyContext, hasScope, stripSensitiveAttributes } from '../middleware/auth';
import { EventsListQuerySchema } from '../types/validation';
import { RequestScopeResolutionError, resolveRequestScope } from '../utils/request-scope';

type RequireApiKey = (req: Request, res: Response, next: NextFunction) => Promise<void>;

// Map ClickHouse SpanRow to SpanV2 shape the frontend expects.
function toSpanV2(row: SpanRow) {
  const ts = row.timestamp ? new Date(row.timestamp).getTime() * 1_000_000 : 0;
  const statusCode = row.status_code === 'STATUS_CODE_ERROR' ? 2
    : row.status_code === 'STATUS_CODE_OK' ? 1 : 0;
  return {
    span_id:         row.span_id,
    trace_id:        row.trace_id,
    parent_span_id:  row.parent_span_id || null,
    name:            row.span_name,
    kind:            0,
    status_code:     statusCode,
    status_message:  row.status_message || null,
    model_name:      row.attributes['gen_ai.request.model'] ?? null,
    provider:        row.attributes['gen_ai.system'] ?? null,
    start_time_ns:   ts,
    end_time_ns:     ts + Number(row.duration_ns ?? 0),
    duration_ns:     Number(row.duration_ns ?? 0),
    session_id:      row.attributes['gen_ai.conversation.id'] ?? row.trace_id ?? '',
    org_id:          row.org_id ?? '',
    agent_id:        row.service_name,
    created_at:      row.timestamp ?? new Date().toISOString(),
    // Pass through all attributes for the SpanDetailPanel
    attributes:      row.attributes,
  };
}

export function createEventsRoutes(
  getClickHouse: () => ClickHouseService | null,
  getDatabase: () => DatabaseService | null,
  requireApiKey: RequireApiKey,
  logger: Logger
): Router {
  const router = Router();

  // Compat endpoint for useSpans hook — GET /api/v1/events?session_id=X
  router.get('/', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.query['session_id'];
    if (!sessionId || typeof sessionId !== 'string') {
      res.status(400).json({ success: false, error: 'session_id is required' });
      return;
    }
    const ch = getClickHouse();
    if (!ch) { res.status(503).json({ success: false, error: 'Service not available' }); return; }
    try {
      const limit = Math.min(parseInt(String(req.query['limit'] ?? '500'), 10) || 500, 1000);
      const offset = parseInt(String(req.query['offset'] ?? '0'), 10) || 0;
      const { spans, total } = await ch.getSpansForSession(sessionId, { limit, offset });
      const mapped = spans.map((s) => ({
        ...toSpanV2(s),
        attributes: stripSensitiveAttributes(s.attributes, res),
      }));
      res.json({
        success: true,
        data: { events: mapped, pagination: { limit, offset, total: Number(total), hasMore: offset + limit < Number(total) } },
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('Error fetching spans:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Paginated span list for a session
  router.get('/sessions/:sessionId/events', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params as { sessionId: string };

    try {
      resolveRequestScope({
        queryOrgId: req.query['org_id'],
        headerOrgId: req.headers['x-org-id'],
        queryAgentId: req.query['agent_id'],
        headerAgentId: req.headers['x-agent-id'],
      });

      const ch = getClickHouse();
      if (!ch) { res.status(503).json({ success: false, error: 'Service not available' }); return; }

      const parsed = EventsListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid query parameters',
          details: parsed.error.issues.map((e) => ({ path: e.path.join('.'), message: e.message })),
        });
        return;
      }
      const { limit, offset, event_type: eventType } = parsed.data;
      const { spans, total } = await ch.getSpansForSession(sessionId, {
        limit,
        offset,
        ...(eventType !== undefined ? { eventType } : {}),
      });

      const sanitized = spans.map((s) => ({
        ...toSpanV2(s),
        attributes: stripSensitiveAttributes(s.attributes, res),
      }));

      res.json({
        success: true,
        data: {
          events: sanitized,
          pagination: { limit, offset, total: Number(total), hasMore: offset + limit < Number(total) },
        },
      });
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

  // Full attribute map for a single span — triggers audit log on prompt access
  router.get('/spans/:spanId/attributes', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    const { spanId } = req.params as { spanId: string };
    const ch = getClickHouse();
    if (!ch) { res.status(503).json({ success: false, error: 'Service not available' }); return; }

    try {
      const span = await ch.getSpan(spanId);
      if (!span) {
        res.status(404).json({ success: false, error: 'Span not found' });
        return;
      }

      const canReadPrompts = hasScope(res, 'read:prompts');
      const attributes = stripSensitiveAttributes(span.attributes, res);

      // Audit log every access to prompt content
      if (canReadPrompts) {
        const db = getDatabase();
        if (db) {
          const ctx = getKeyContext(res);
          const ipAddress = req.ip;
          const userAgent = req.headers['user-agent'];
          db.writeAuditLog({
            org_id: ctx.orgId,
            actor_key_id: ctx.keyId,
            action: 'read:span_attributes',
            resource_type: 'span',
            resource_id: spanId,
            ...(ipAddress !== undefined ? { ip_address: ipAddress } : {}),
            ...(userAgent !== undefined ? { user_agent: userAgent } : {}),
            request_id: String(res.getHeader('x-request-id') ?? ''),
          }).catch(() => undefined);
        }
      }

      res.json({ success: true, data: { span_id: spanId, attributes } });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(`Error fetching attributes for span ${spanId}:`, error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}
