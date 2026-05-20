import type { Request, Response, NextFunction } from 'express';
import { Logger } from '../services/logger';

export class ErrorHandler {
  constructor(private logger: Logger) {}

  handle(error: Error, req: Request, res: Response): void {
    this.logger.error(`${req.method} ${req.path}:`, error);

    const status = (error as any).status || 500;
    const message = error.message || 'Internal Server Error';

    res.status(status).json({
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
    });
  }

  notFound(req: Request, res: Response): void {
    res.status(404).json({
      success: false,
      error: 'Route not found',
      path: req.path,
      timestamp: new Date().toISOString(),
    });
  }
}

export function createErrorHandler(logger: Logger) {
  const handler = new ErrorHandler(logger);
  return {
    errorHandler: (err: Error, req: Request, res: Response, _next: NextFunction) =>
      handler.handle(err, req, res),
    notFoundHandler: (req: Request, res: Response) => handler.notFound(req, res),
  };
}
