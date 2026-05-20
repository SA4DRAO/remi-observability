import type { Request, Response, NextFunction } from 'express';

/**
 * Auth middleware - validates API key from Authorization header.
 * Must run BEFORE any validation middleware to prevent DoS attacks.
 */
const expectedApiKey = process.env.REMI_API_KEY;
if (!expectedApiKey) {
  throw new Error('REMI_API_KEY environment variable is required');
}

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ success: false, error: 'Missing authorization header' });
    return;
  }

  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (token !== expectedApiKey) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  next();
}
