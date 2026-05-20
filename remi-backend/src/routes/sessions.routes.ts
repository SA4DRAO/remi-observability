import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import type { DatabaseService } from '../services';
import type { Logger } from '../services/logger';
import { requireApiKey, validateBody } from '../middleware';
import { SessionCreateSchema, SessionListQuerySchema, AnalyticsQuerySchema, ValidatedSessionCreate } from '../types/validation';
import { OrgIdResolutionError, resolveOrgId } from '../utils/org-id';
import {
  RequestScopeResolutionError,
  resolveRequestScope,
} from '../utils/request-scope';

export function createSessionsRoutes(
  getDatabase: () => DatabaseService | null,
  logger: Logger
): Router {
  const router = Router();

  const getRequestedScope = (req: Request) =>
    resolveRequestScope({
      queryOrgId: req.query.org_id,
      headerOrgId: req.headers['x-org-id'],
      queryAgentId: req.query.agent_id,
      headerAgentId: req.headers['x-agent-id'],
    });

  router.get('/', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    const db = getDatabase();
    if (!db) {
      res.status(503).json({ success: false, error: 'Database not available' });
      return;
    }

    try {
      const { orgId, agentId } = getRequestedScope(req);

      const paginationResult = SessionListQuerySchema.safeParse(req.query);
      if (!paginationResult.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid query parameters',
          details: paginationResult.error.issues.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        });
        return;
      }
      const { limit, offset, date_from, date_to, status, min_cost, max_cost } = paginationResult.data;

      const listParams: Parameters<typeof db.listSessionsV2>[0] = { limit, offset };
      if (orgId !== null) listParams.orgId = orgId;
      if (agentId !== null) listParams.agentId = agentId;
      if (date_from !== undefined) listParams.startDate = date_from;
      if (date_to !== undefined) listParams.endDate = date_to;
      if (status === 'complete') listParams.isComplete = true;
      else if (status === 'error') listParams.hasError = true;
      if (min_cost !== undefined) listParams.minCost = min_cost;
      if (max_cost !== undefined) listParams.maxCost = max_cost;

      const { sessions, total } = await db.listSessionsV2(listParams);

      res.json({
        success: true,
        data: {
          sessions,
          pagination: { limit, offset, total },
        },
      });
    } catch (err) {
      if (err instanceof RequestScopeResolutionError) {
        res.status(err.status).json({ success: false, error: err.message });
        return;
      }

      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('Error listing sessions:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/analytics', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    const db = getDatabase();
    if (!db) {
      res.status(503).json({ success: false, error: 'Database not available' });
      return;
    }

    try {
      const { orgId, agentId } = getRequestedScope(req);

      const analyticsResult = AnalyticsQuerySchema.safeParse(req.query);
      if (!analyticsResult.success) {
        res.status(400).json({ success: false, error: 'Invalid query parameters' });
        return;
      }
      const { days } = analyticsResult.data;

      const analyticsParams: Parameters<typeof db.getAnalyticsV2>[0] = {};
      if (orgId !== null) analyticsParams.orgId = orgId;
      if (agentId !== null) analyticsParams.agentId = agentId;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      analyticsParams.startDate = cutoff.toISOString().slice(0, 10);

      const analytics = await db.getAnalyticsV2(analyticsParams);

      res.json({ success: true, data: { period: `${days}d`, ...analytics } });
    } catch (err) {
      if (err instanceof RequestScopeResolutionError) {
        res.status(err.status).json({ success: false, error: err.message });
        return;
      }

      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('Error fetching analytics:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/', requireApiKey, validateBody(SessionCreateSchema), async (req: Request, res: Response): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      const expectedApiKey = process.env.REMI_API_KEY ?? 'test-key-123';

      if (authHeader) {
        const token = authHeader.replace('Bearer ', '');
        if (token !== expectedApiKey) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
      }

      const { name, metadata, org_id, agent_id } = req.body as ValidatedSessionCreate;
      const resolvedOrgId = resolveOrgId({
        bodyOrgId: org_id,
        headerOrgId: req.headers['x-org-id'],
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
      const resolvedAgentId = normalizedBodyAgentId ?? normalizedHeaderAgentId;

      const sessionId = `session-${Date.now()}-${randomUUID().split('-')[0]}`;
      logger.info(`New session created: ${sessionId}${name ? ` (${name})` : ''}`);

      const db = getDatabase();
      if (db) {
        try {
          await db.createSessionV2(sessionId, resolvedOrgId, resolvedAgentId, null, metadata ?? null);
        } catch (dbError) {
          logger.warn('Failed to store session in database:', dbError);
        }
      }

      res.status(201).json({
        success: true,
        session_id: sessionId,
        name: name ?? null,
        metadata: metadata ?? {},
        org_id: resolvedOrgId,
        agent_id: resolvedAgentId,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      if (err instanceof OrgIdResolutionError) {
        res.status(err.status).json({ success: false, error: err.message });
        return;
      }

      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('Session creation error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/:sessionId/metrics', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params as { sessionId: string };
    const db = getDatabase();
    if (!db) {
      res.status(503).json({ success: false, error: 'Database not available' });
      return;
    }

    try {
      const rollup = await db.getSessionRollupV2(sessionId);

      if (!rollup) {
        res.status(404).json({ success: false, error: 'No metrics found for session' });
        return;
      }

      res.json({
        success: true,
        data: rollup,
      });
    } catch (err) {
      if (err instanceof RequestScopeResolutionError) {
        res.status(err.status).json({ success: false, error: err.message });
        return;
      }

      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(`Error fetching metrics for session ${sessionId}:`, error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/:sessionId', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params as { sessionId: string };
    const db = getDatabase();
    if (!db) {
      res.status(503).json({ success: false, error: 'Database not available' });
      return;
    }

    try {
      const rollup = await db.getSessionRollupV2(sessionId);

      if (!rollup) {
        res.status(404).json({ success: false, error: 'Session not found' });
        return;
      }

      res.json({ success: true, data: rollup });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(`Error fetching session ${sessionId}:`, error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.delete('/:sessionId', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params as { sessionId: string };
    const db = getDatabase();
    if (!db) {
      res.status(503).json({ success: false, error: 'Database not available' });
      return;
    }

    try {
      await db.deleteSessionV2(sessionId);
      logger.info(`Session deleted: ${sessionId}`);
      res.json({ success: true, session_id: sessionId });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(`Error deleting session ${sessionId}:`, error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ── Conversations ──────────────────────────────────────────────────────────
  router.get('/conversations', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    const db = getDatabase();
    if (!db) { res.status(503).json({ success: false, error: 'Database not available' }); return; }
    try {
      const scope = getRequestedScope(req);
      const limit = Math.min(parseInt(String(req.query['limit'] ?? '20'), 10) || 20, 100);
      const offset = parseInt(String(req.query['offset'] ?? '0'), 10) || 0;
      const result = await db.getConversations({
        ...(scope.orgId !== null ? { orgId: scope.orgId } : {}),
        ...(scope.agentId !== null ? { agentId: scope.agentId } : {}),
        limit,
        offset,
      });
      res.json({ success: true, data: result.conversations, pagination: { total: result.total, limit, offset } });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('Error fetching conversations:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ── Version metrics ────────────────────────────────────────────────────────
  router.get('/versions', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    const db = getDatabase();
    if (!db) { res.status(503).json({ success: false, error: 'Database not available' }); return; }
    try {
      const scope = getRequestedScope(req);
      const rows = await db.getVersionMetrics({
        ...(scope.orgId !== null ? { orgId: scope.orgId } : {}),
        ...(scope.agentId !== null ? { agentId: scope.agentId } : {}),
      });
      res.json({ success: true, data: rows });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('Error fetching version metrics:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ── LLM-as-a-judge span analysis ──────────────────────────────────────────
  router.post('/:sessionId/analyze-span', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params as { sessionId: string };
    const { spanId } = req.body as { spanId?: string };

    if (!spanId || typeof spanId !== 'string') {
      res.status(400).json({ success: false, error: 'spanId is required' });
      return;
    }

    const db = getDatabase();
    if (!db) { res.status(503).json({ success: false, error: 'Database not available' }); return; }

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      res.status(503).json({ success: false, error: 'OPENAI_API_KEY not configured' });
      return;
    }

    try {
      const [{ spans }, attrs] = await Promise.all([
        db.getSpansForSessionV2(sessionId, { limit: 500, offset: 0 }),
        db.getSpanAttributes(spanId),
      ]);

      const target = (spans as Record<string, unknown>[]).find((s) => s['span_id'] === spanId);
      if (!target) {
        res.status(404).json({ success: false, error: 'Span not found in session' });
        return;
      }

      const children = (spans as Record<string, unknown>[])
        .filter((s) => s['parent_span_id'] === spanId)
        .map((s) => ({
          name: s['name'],
          model: s['model_name'] ?? null,
          duration_ms: s['duration_ns'] ? Math.round(Number(s['duration_ns']) / 1_000_000) : 0,
          status: s['status_code'] === 2 ? 'error' : 'ok',
        }))
        .sort((a, b) => b.duration_ms - a.duration_ms);

      const targetDurationMs = target['duration_ns'] ? Math.round(Number(target['duration_ns']) / 1_000_000) : 0;

      const attrMap = Object.fromEntries(
        (attrs as { key: string; value: string | null }[]).map((a) => [a.key, a.value ?? ''])
      );
      const promptText = attrMap['llm.prompt'] ?? '';
      const completionText = attrMap['llm.completion'] ?? '';
      const promptTokens = attrMap['gen_ai.usage.prompt_tokens'] ?? attrMap['llm.usage.prompt_tokens'] ?? '';
      const completionTokens = attrMap['gen_ai.usage.completion_tokens'] ?? attrMap['llm.usage.completion_tokens'] ?? '';

      const childSummary = children.length > 0
        ? children.map((c) => {
            const pct = targetDurationMs > 0 ? Math.round((c.duration_ms / targetDurationMs) * 100) : 0;
            return `  - "${String(c.name)}" (${c.model ? `model: ${String(c.model)}, ` : ''}${c.duration_ms}ms, ${pct}% of parent${c.status === 'error' ? ', ERROR' : ''})`;
          }).join('\n')
        : '  (no child spans — this is a leaf span)';

      const systemPrompt = `You are an expert LLM application performance advisor. Analyze the given span telemetry.

Respond with ONLY a raw JSON object — no markdown, no code fences, no explanation before or after. Use exactly this schema:
{"summary":"<1-2 sentence overview>","time_breakdown":[{"span":"<name>","duration_ms":<number>,"pct":<0-100>}],"suggestions":[{"category":"<model|prompt|architecture|caching|parallelism>","title":"<short title>","detail":"<concrete advice with numbers>","impact":"<high|medium|low>"}]}

Provide 2-4 actionable suggestions. Be specific: name cheaper models, estimate token savings, suggest concrete changes.`;

      const userPrompt = `Span: "${String(target['name'])}"
Model: ${String(target['model_name'] ?? 'unknown')}
Duration: ${targetDurationMs}ms
Status: ${target['status_code'] === 2 ? 'ERROR' : 'OK'}
Prompt tokens: ${promptTokens || 'unknown'}
Completion tokens: ${completionTokens || 'unknown'}

Child spans (time breakdown):
${childSummary}

${promptText ? `Prompt (first 800 chars):\n${promptText.slice(0, 800)}` : ''}
${completionText ? `\nCompletion (first 400 chars):\n${completionText.slice(0, 400)}` : ''}`;

      const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
      const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

      const llmRes = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!llmRes.ok) {
        const errText = await llmRes.text();
        logger.error('LLM API error', { status: llmRes.status, body: errText });
        res.status(502).json({ success: false, error: `LLM API returned ${llmRes.status}` });
        return;
      }

      const llmJson = await llmRes.json() as { choices?: Array<{ message?: { content?: string } }> };
      const rawContent = llmJson.choices?.[0]?.message?.content ?? '';

      const stripped = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
      const jsonStart = stripped.indexOf('{');
      const jsonEnd = stripped.lastIndexOf('}');
      const jsonCandidate = jsonStart !== -1 && jsonEnd > jsonStart
        ? stripped.slice(jsonStart, jsonEnd + 1)
        : stripped;

      let analysis: Record<string, unknown>;
      try {
        analysis = JSON.parse(jsonCandidate) as Record<string, unknown>;
      } catch {
        analysis = { summary: rawContent || 'No analysis returned.', time_breakdown: [], suggestions: [] };
      }

      res.json({ success: true, data: { span_id: spanId, model_used: model, analysis } });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(`Error analyzing span ${spanId}:`, error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}
