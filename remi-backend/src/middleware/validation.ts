import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';

/**
 * Generic validation middleware factory.
 * Creates middleware that validates request body against a Zod schema.
 * 
 * @param schema - Zod schema to validate request body against
 * @returns Express middleware function
 * 
 * @example
 * router.post('/batch', validateBody(EventBatchSchema), handler);
 */
export const validateBody = <T>(schema: z.ZodType<T>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Parse and validate request body
      // If successful, replace req.body with validated data
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // Return structured validation errors
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.issues.map((e: z.ZodIssue) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        });
      } else {
        // Unexpected error, pass to error handler
        next(error);
      }
    }
  };
};
