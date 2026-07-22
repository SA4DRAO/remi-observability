import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { ClickHouseService } from '../services/clickhouse.service';
import type { Logger } from '../services/logger';
import { resolveRequestScope } from '../utils/request-scope';

type RequireApiKey = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export function createAnalyticsRoutes(
  getClickHouse: () => ClickHouseService | null,
  requireApiKey: RequireApiKey,
  logger: Logger
): Router {
  const router = Router();

  function baseParams(req: Request) {
    const scope = resolveRequestScope({
      queryOrgId: req.query['org_id'],
      headerOrgId: req.headers['x-org-id'] as string | undefined,
      queryAgentId: req.query['agent_id'],
      headerAgentId: req.headers['x-agent-id'] as string | undefined,
    });
    const params: { orgId?: string; agentId?: string; startDate?: string; endDate?: string } = {};
    if (scope.orgId !== null) params.orgId = scope.orgId;
    if (scope.agentId !== null) params.agentId = scope.agentId;
    if (typeof req.query['start_date'] === 'string') params.startDate = req.query['start_date'];
    if (typeof req.query['end_date'] === 'string') params.endDate = req.query['end_date'];
    return params;
  }

  async function run(res: Response, fn: (ch: ClickHouseService) => Promise<unknown>): Promise<void> {
    const ch = getClickHouse();
    if (!ch) { res.status(503).json({ success: false, error: 'Service not available' }); return; }
    try {
      const data = await fn(ch);
      res.json({ success: true, data });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('Analytics query error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  router.get('/latency-percentiles', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    await run(res, (ch) => ch.getLatencyPercentiles(baseParams(req)));
  });

  router.get('/slowest-spans', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    await run(res, (ch) => {
      const limit = Math.min(parseInt(String(req.query['limit'] ?? '20'), 10) || 20, 100);
      return ch.getSlowestSpans({ ...baseParams(req), limit });
    });
  });

  router.get('/error-clusters', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    await run(res, (ch) => ch.getErrorClusters(baseParams(req)));
  });

  router.get('/error-rate-by-version', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    await run(res, (ch) => ch.getErrorRateByVersion(baseParams(req)));
  });

  router.get('/tool-failures', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    await run(res, (ch) => ch.getToolFailures(baseParams(req)));
  });

  router.get('/prompt-length-distribution', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    await run(res, (ch) => ch.getPromptLengthDistribution(baseParams(req)));
  });

  router.get('/prompt-completion-ratio', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    await run(res, (ch) => ch.getPromptCompletionRatio(baseParams(req)));
  });

  router.get('/cache-efficiency', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    await run(res, (ch) => ch.getCacheEfficiency(baseParams(req)));
  });

  router.get('/search', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    const q = req.query['q'];
    if (typeof q !== 'string' || q.trim().length < 2) {
      res.status(400).json({ success: false, error: 'q must be at least 2 characters' });
      return;
    }
    await run(res, (ch) => {
      const limit = Math.min(parseInt(String(req.query['limit'] ?? '30'), 10) || 30, 100);
      const params = baseParams(req);
      return ch.searchSpanAttributes({ query: q.trim(), limit, ...params });
    });
  });

  return router;
}
