import { Router } from 'express';
import type { Request, Response } from 'express';
import type { HealthStatus } from '../types';

const startTime = Date.now();
const version = '1.0.0';

export function createHealthRoutes(): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    const response: HealthStatus = {
      status: 'OK',
      sessionId: String(Date.now()),
      pages: 0,
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      environment: process.env.NODE_ENV || 'development',
      version,
    };

    res.json(response);
  });

  router.get('/info', (_req: Request, res: Response) => {
    res.json({
      name: 'Remi Browser Agent',
      version,
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
