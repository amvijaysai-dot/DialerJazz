import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(public statusCode: number, public message: string, public code: string = 'internal_error') {
    super(message);
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

export const errorHandler = (error: unknown, req: Request, res: Response, next: NextFunction) => {
  if (error instanceof ApiError) {
    console.error('[ApiError]', {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      stack: error.stack,
    });
    return res.status(error.statusCode).json({
      error: { code: error.code, message: error.message },
    });
  }

  if (error instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'validation_error',
        message: 'Request validation failed',
        details: error.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
          code: String(e.code),
        })),
      },
    });
  }

  // Log full stack trace for unhandled errors
  console.error('[Unhandled Server Error]', {
    error: error,
    message: (error as any)?.message,
    stack: (error as any)?.stack,
    request: {
      method: req.method,
      url: req.url,
      body: req.body,
    },
  });
  const detail = (error as any)?.message || JSON.stringify(error) || 'An unexpected internal error occurred';
  return res.status(500).json({
    error: { code: 'server_error', message: detail },
  });
};
