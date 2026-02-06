import type { Request, Response, NextFunction } from 'express';

export interface ValidatorOptions {
  required?: string[];
  schema?: Record<string, (value: any) => boolean>;
}

export function createValidator(options: ValidatorOptions) {
  return (req: Request, res: Response, next: NextFunction): void | Response => {
    const { required = [], schema = {} } = options;

    // Check required fields
    for (const field of required) {
      if (!(field in req.body)) {
        return res.status(400).json({
          success: false,
          error: `Missing required field: ${field}`,
        });
      }
    }

    // Validate schema
    for (const [field, validator] of Object.entries(schema)) {
      if (field in req.body && !validator(req.body[field])) {
        return res.status(400).json({
          success: false,
          error: `Invalid value for field: ${field}`,
        });
      }
    }

    next();
  };
}
