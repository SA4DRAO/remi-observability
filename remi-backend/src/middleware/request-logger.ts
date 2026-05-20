import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { Logger } from '../services/logger';

export function createRequestLogger(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    const requestId = req.headers['x-request-id']?.toString() || randomUUID();
    res.setHeader('x-request-id', requestId);

    const body = req.body as Record<string, unknown> | undefined;
    const events = Array.isArray(body?.events) ? body?.events : undefined;

    logger.debug('HTTP request start', {
      requestId,
      method: req.method,
      path: req.path,
      query: req.query,
      hasAuthorization: !!req.headers.authorization,
      contentLength: req.headers['content-length'] || null,
      sessionId: body?.session_id,
      eventsCount: events?.length,
      bodyKeys: body ? Object.keys(body).slice(0, 20) : [],
      remoteAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info('HTTP request complete', {
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: duration,
      });
    });

    res.on('close', () => {
      if (!res.writableEnded) {
        const duration = Date.now() - start;
        logger.warn('HTTP request terminated early', {
          requestId,
          method: req.method,
          path: req.path,
          durationMs: duration,
        });
      }
    });

    next();
  };
}
