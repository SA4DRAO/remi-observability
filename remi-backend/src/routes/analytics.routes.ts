import { Router } from 'express';
import type { Request, Response } from 'express';
import type { DatabaseService } from '../services';
import type { Logger } from '../services/logger';
import { requireApiKey } from '../middleware';
import { resolveRequestScope } from '../utils/request-scope';

export function createAnalyticsRoutes(
  getDatabase: () => DatabaseService | null,
  logger: Logger
): Router {
  const router = Router();

  function getScope(req: Request) {
    return resolveRequestScope({
      queryOrgId: req.query['org_id'],
      headerOrgId: req.headers['x-org-id'] as string | undefined,
      queryAgentId: req.query['agent_id'],
      headerAgentId: req.headers['x-agent-id'] as string | undefined,
    });
  }

  // Helper: extract common scope + date range query params
  // Returns only defined keys so exactOptionalPropertyTypes is satisfied
  function baseParams(req: Request): {
    orgId?: string;
    agentId?: string;
    startDate?: string;
    endDate?: string;
  } {
    const scope = getScope(req);
    const params: { orgId?: string; agentId?: string; startDate?: string; endDate?: string } = {};
    if (scope.orgId !== null) params.orgId = scope.orgId;
    if (scope.agentId !== null) params.agentId = scope.agentId;
    const startDate = req.query['start_date'];
    const endDate = req.query['end_date'];
    if (typeof startDate === 'string') params.startDate = startDate;
    if (typeof endDate === 'string') params.endDate = endDate;
    return params;
  }

  async function runQuery(
    res: Response,
    fn: (db: DatabaseService) => Promise<unknown>
  ): Promise<void> {
    const database = getDatabase();
    if (!database) { res.status(503).json({ success: false, error: 'Database not available' }); return; }
    try {
      const data = await fn(database);
      res.json({ success: true, data });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('Analytics query error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ── P50/P95/P99 latency per agent, per model, per span type ─────────────
  router.get('/latency-percentiles', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    await runQuery(res, async (db) => db.getLatencyPercentiles(baseParams(req)));
  });

  // ── Slowest spans leaderboard ─────────────────────────────────────────────
  router.get('/slowest-spans', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    await runQuery(res, async (db) => {
      const limit = Math.min(parseInt(String(req.query['limit'] ?? '20'), 10) || 20, 100);
      return db.getSlowestSpans({ ...baseParams(req), limit });
    });
  });

  // ── Error clustering ──────────────────────────────────────────────────────
  router.get('/error-clusters', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    await runQuery(res, async (db) => db.getErrorClusters(baseParams(req)));
  });

  // ── Error rate trend by agent version ─────────────────────────────────────
  router.get('/error-rate-by-version', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    await runQuery(res, async (db) => db.getErrorRateByVersion(baseParams(req)));
  });

  // ── Tool failure analysis ─────────────────────────────────────────────────
  router.get('/tool-failures', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    await runQuery(res, async (db) => db.getToolFailures(baseParams(req)));
  });

  // ── Prompt length distribution (histogram) ────────────────────────────────
  router.get('/prompt-length-distribution', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    await runQuery(res, async (db) => db.getPromptLengthDistribution(baseParams(req)));
  });

  // ── Prompt/completion ratio ───────────────────────────────────────────────
  router.get('/prompt-completion-ratio', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    await runQuery(res, async (db) => db.getPromptCompletionRatio(baseParams(req)));
  });

  // ── Token cost heatmap by model ───────────────────────────────────────────
  router.get('/token-cost-heatmap', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    await runQuery(res, async (db) => db.getTokenCostHeatmap(baseParams(req)));
  });

  // ── Cache efficiency ──────────────────────────────────────────────────────
  router.get('/cache-efficiency', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    await runQuery(res, async (db) => db.getCacheEfficiency(baseParams(req)));
  });

  // ── Spend trend (daily/weekly cost per agent version) ─────────────────────
  router.get('/spend-trend', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    await runQuery(res, async (db) => {
      const granularity = req.query['granularity'] === 'week' ? 'week' as const : 'day' as const;
      return db.getSpendTrend({ ...baseParams(req), granularity });
    });
  });

  // ── Cost per output token (efficiency) ───────────────────────────────────
  router.get('/cost-per-output-token', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    await runQuery(res, async (db) => db.getCostPerOutputToken(baseParams(req)));
  });

  // ── Span cost breakdown for a session (pie/bar) ───────────────────────────
  router.get('/session-span-costs/:sessionId', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params as { sessionId: string };
    await runQuery(res, async (db) => db.getSessionSpanCosts(sessionId));
  });

  // ── Full-text search across span attributes ────────────────────────────────
  router.get('/search', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    const q = req.query['q'];
    if (typeof q !== 'string' || q.trim().length < 2) {
      res.status(400).json({ success: false, error: 'q must be at least 2 characters' });
      return;
    }
    await runQuery(res, async (db) => {
      const limit = Math.min(parseInt(String(req.query['limit'] ?? '30'), 10) || 30, 100);
      const params = baseParams(req);
      const searchParams: { query: string; limit: number; orgId?: string; agentId?: string } = { query: q.trim(), limit };
      if (params.orgId !== undefined) searchParams.orgId = params.orgId;
      if (params.agentId !== undefined) searchParams.agentId = params.agentId;
      return db.searchSpanAttributes(searchParams);
    });
  });

  return router;
}
