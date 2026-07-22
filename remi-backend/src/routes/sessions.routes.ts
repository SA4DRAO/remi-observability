import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { ClickHouseService, SessionRow } from '../services/clickhouse.service';
import type { DatabaseService } from '../services/database.service';
import type { Logger } from '../services/logger';
import { getKeyContext, hasScope } from '../middleware/auth';
import { SessionListQuerySchema, AnalyticsQuerySchema } from '../types/validation';
import { RequestScopeResolutionError, resolveRequestScope } from '../utils/request-scope';

// Map ClickHouse SessionRow to the shape the frontend expects (SessionV2 / SessionDetailV2).
// Keeps the frontend working without changes while the response shapes converge over time.
function toSessionV2(row: SessionRow) {
  const promptTokens = Number(row.prompt_tokens ?? 0);
  const completionTokens = Number(row.completion_tokens ?? 0);
  const spanCount = Number(row.span_count ?? 0);
  const errorCount = Number(row.error_count ?? 0);
  const durationMs = row.start_time && row.end_time
    ? new Date(row.end_time).getTime() - new Date(row.start_time).getTime()
    : null;
  return {
    session_id:          row.session_id,
    org_id:              row.org_id,
    agent_id:            row.agent_id,
    created_at:          row.start_time ?? new Date().toISOString(),
    first_event_at:      row.start_time ?? null,
    last_event_at:       row.end_time ?? null,
    total_events:        spanCount,
    total_spans:         spanCount,
    llm_calls:           0,
    llm_spans:           0,
    tool_calls:          0,
    tool_spans:          0,
    error_count:         errorCount,
    prompt_tokens:       promptTokens,
    completion_tokens:   completionTokens,
    total_tokens:        promptTokens + completionTokens,
    cache_read_tokens:   0,
    estimated_cost_usd:  '0',
    total_cost_usd:      '0',
    cost_status:         'low' as const,
    is_complete:         Boolean(row.is_complete),
    has_error:           Boolean(row.has_error),
    total_duration_ns:   durationMs !== null ? durationMs * 1_000_000 : null,
    model_usage:         {},
    tool_usage:          {},
  };
}

type RequireApiKey = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export function createSessionsRoutes(
  getClickHouse: () => ClickHouseService | null,
  getDatabase: () => DatabaseService | null,
  requireApiKey: RequireApiKey,
  logger: Logger
): Router {
  const router = Router();

  function getScope(req: Request) {
    return resolveRequestScope({
      queryOrgId: req.query['org_id'],
      headerOrgId: req.headers['x-org-id'],
      queryAgentId: req.query['agent_id'],
      headerAgentId: req.headers['x-agent-id'],
    });
  }

  router.get('/', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    const ch = getClickHouse();
    if (!ch) { res.status(503).json({ success: false, error: 'Service not available' }); return; }

    try {
      const { orgId, agentId } = getScope(req);

      const parsed = SessionListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid query parameters',
          details: parsed.error.issues.map((e) => ({ path: e.path.join('.'), message: e.message })),
        });
        return;
      }
      const { limit, offset, date_from, date_to, status } = parsed.data;

      const { sessions, total } = await ch.listSessions({
        limit,
        offset,
        ...(orgId !== null ? { orgId } : {}),
        ...(agentId !== null ? { agentId } : {}),
        ...(date_from !== undefined ? { startDate: date_from } : {}),
        ...(date_to !== undefined ? { endDate: date_to } : {}),
        ...(status === 'error' ? { hasError: true } : {}),
        ...(status === 'complete' ? { isComplete: true } : {}),
      });

      res.json({ success: true, data: { sessions: sessions.map(toSessionV2), pagination: { limit, offset, total } } });
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
    const ch = getClickHouse();
    if (!ch) { res.status(503).json({ success: false, error: 'Service not available' }); return; }

    try {
      const { orgId, agentId } = getScope(req);
      const parsed = AnalyticsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: 'Invalid query parameters' });
        return;
      }
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - parsed.data.days);

      const analytics = await ch.getSessionAnalytics({
        ...(orgId !== null ? { orgId } : {}),
        ...(agentId !== null ? { agentId } : {}),
        startDate: cutoff.toISOString().slice(0, 10),
      });

      res.json({ success: true, data: { period: `${parsed.data.days}d`, ...analytics as object } });
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

  router.get('/conversations', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    const ch = getClickHouse();
    if (!ch) { res.status(503).json({ success: false, error: 'Service not available' }); return; }
    try {
      const scope = getScope(req);
      const limit = Math.min(parseInt(String(req.query['limit'] ?? '20'), 10) || 20, 100);
      const offset = parseInt(String(req.query['offset'] ?? '0'), 10) || 0;
      const result = await ch.getConversations({
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

  router.get('/versions', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    const ch = getClickHouse();
    if (!ch) { res.status(503).json({ success: false, error: 'Service not available' }); return; }
    try {
      const scope = getScope(req);
      const rows = await ch.getVersionMetrics({
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

  router.get('/:sessionId/metrics', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params as { sessionId: string };
    const ch = getClickHouse();
    if (!ch) { res.status(503).json({ success: false, error: 'Service not available' }); return; }
    try {
      const session = await ch.getSession(sessionId);
      if (!session) {
        res.status(404).json({ success: false, error: 'No metrics found for session' });
        return;
      }
      res.json({ success: true, data: toSessionV2(session) });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(`Error fetching metrics for session ${sessionId}:`, error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/:sessionId', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params as { sessionId: string };
    const ch = getClickHouse();
    if (!ch) { res.status(503).json({ success: false, error: 'Service not available' }); return; }
    try {
      const session = await ch.getSession(sessionId);
      if (!session) {
        res.status(404).json({ success: false, error: 'Session not found' });
        return;
      }
      res.json({ success: true, data: toSessionV2(session) });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(`Error fetching session ${sessionId}:`, error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.delete('/:sessionId', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params as { sessionId: string };
    const ch = getClickHouse();
    if (!ch) { res.status(503).json({ success: false, error: 'Service not available' }); return; }
    try {
      await ch.deleteSessionSpans(sessionId);
      logger.info(`Session spans deleted: ${sessionId}`);
      res.json({ success: true, session_id: sessionId });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(`Error deleting session ${sessionId}:`, error);
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

    const ch = getClickHouse();
    if (!ch) { res.status(503).json({ success: false, error: 'Service not available' }); return; }

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      res.status(503).json({ success: false, error: 'OPENAI_API_KEY not configured' });
      return;
    }

    try {
      const [{ spans }, target] = await Promise.all([
        ch.getSpansForSession(sessionId, { limit: 500, offset: 0 }),
        ch.getSpan(spanId),
      ]);

      if (!target) {
        res.status(404).json({ success: false, error: 'Span not found' });
        return;
      }

      const canReadPrompts = hasScope(res, 'read:prompts');
      const attrs = target.attributes;

      const children = spans
        .filter((s) => s.parent_span_id === spanId)
        .map((s) => ({
          name: s.span_name,
          model: s.attributes['gen_ai.request.model'] ?? null,
          duration_ms: Math.round(s.duration_ns / 1_000_000),
          status: s.status_code === 'STATUS_CODE_ERROR' ? 'error' : 'ok',
        }))
        .sort((a, b) => b.duration_ms - a.duration_ms);

      const targetDurationMs = Math.round(target.duration_ns / 1_000_000);
      const promptText = canReadPrompts ? (attrs['gen_ai.input.messages'] ?? attrs['gen_ai.prompt'] ?? '') : '[redacted — key lacks read:prompts scope]';
      const completionText = canReadPrompts ? (attrs['gen_ai.output.message'] ?? attrs['gen_ai.completion'] ?? '') : '';
      const promptTokens = attrs['gen_ai.usage.input_tokens'] ?? '';
      const completionTokens = attrs['gen_ai.usage.output_tokens'] ?? '';

      const childSummary = children.length > 0
        ? children.map((c) => {
            const pct = targetDurationMs > 0 ? Math.round((c.duration_ms / targetDurationMs) * 100) : 0;
            return `  - "${c.name}" (${c.model ? `model: ${c.model}, ` : ''}${c.duration_ms}ms, ${pct}% of parent${c.status === 'error' ? ', ERROR' : ''})`;
          }).join('\n')
        : '  (no child spans — this is a leaf span)';

      const systemPrompt = `You are an expert LLM application performance advisor. Analyze the given span telemetry.

Respond with ONLY a raw JSON object — no markdown, no code fences, no explanation before or after. Use exactly this schema:
{"summary":"<1-2 sentence overview>","time_breakdown":[{"span":"<name>","duration_ms":<number>,"pct":<0-100>}],"suggestions":[{"category":"<model|prompt|architecture|caching|parallelism>","title":"<short title>","detail":"<concrete advice with numbers>","impact":"<high|medium|low>"}]}

Provide 2-4 actionable suggestions. Be specific: name cheaper models, estimate token savings, suggest concrete changes.`;

      const model = attrs['gen_ai.request.model'] ?? 'unknown';
      const userPrompt = `Span: "${target.span_name}"
Model: ${model}
Duration: ${targetDurationMs}ms
Status: ${target.status_code === 'STATUS_CODE_ERROR' ? 'ERROR' : 'OK'}
Prompt tokens: ${promptTokens || 'unknown'}
Completion tokens: ${completionTokens || 'unknown'}

Child spans (time breakdown):
${childSummary}

${promptText ? `Prompt (first 800 chars):\n${promptText.slice(0, 800)}` : ''}
${completionText ? `\nCompletion (first 400 chars):\n${completionText.slice(0, 400)}` : ''}`;

      const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
      const openaiModel = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

      const llmRes = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: openaiModel,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
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
      const candidate = jsonStart !== -1 && jsonEnd > jsonStart ? stripped.slice(jsonStart, jsonEnd + 1) : stripped;

      let analysis: Record<string, unknown>;
      try {
        analysis = JSON.parse(candidate) as Record<string, unknown>;
      } catch {
        analysis = { summary: rawContent || 'No analysis returned.', time_breakdown: [], suggestions: [] };
      }

      // Write audit log for prompt access if key has read:prompts scope
      if (canReadPrompts && promptText) {
        const db = getDatabase();
        if (db) {
          const ctx = getKeyContext(res);
          db.writeAuditLog({
            org_id: ctx.orgId,
            actor_key_id: ctx.keyId,
            action: 'read:prompt_content',
            resource_type: 'span',
            resource_id: spanId,
            request_id: String(res.getHeader('x-request-id') ?? ''),
          }).catch(() => undefined);
        }
      }

      res.json({ success: true, data: { span_id: spanId, model_used: openaiModel, analysis } });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(`Error analyzing span ${spanId}:`, error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}
