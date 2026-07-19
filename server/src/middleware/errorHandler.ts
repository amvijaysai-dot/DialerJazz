import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(public statusCode: number, public message: string, public code: string = 'internal_error') {
    super(message);
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/**
 * Sanitize database error messages to prevent leaking sensitive information
 * (schema details, constraint names, internal query structure)
 */
function sanitizeDbError(error: any): string {
  if (!error?.message) return 'Database error';
  
  const msg = error.message;
  
  // Common PostgreSQL error patterns that leak schema info
  const sensitivePatterns = [
    /relation ".*" does not exist/gi,
    /column ".*" does not exist/gi,
    /constraint ".*" does not exist/gi,
    /index ".*" does not exist/gi,
    /function ".*" does not exist/gi,
    /type ".*" does not exist/gi,
    /permission denied for .*/gi,
    /duplicate key value violates unique constraint ".*"/gi,
    /foreign key constraint ".*" violated/gi,
    /check constraint ".*" violated/gi,
    /null value in column ".*" violates not-null constraint/gi,
    /syntax error at or near ".*"/gi,
    /unterminated quoted string at or near ".*"/gi,
    /invalid input syntax for type .*/gi,
  ];
  
  // Check if error matches sensitive patterns
  for (const pattern of sensitivePatterns) {
    if (pattern.test(msg)) {
      // Return generic message based on error type
      if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
        return 'A record with this value already exists';
      }
      if (msg.includes('foreign key constraint') || msg.includes('violates foreign key')) {
        return 'Referenced record does not exist';
      }
      if (msg.includes('not-null constraint') || msg.includes('violates not-null')) {
        return 'Required field is missing';
      }
      if (msg.includes('permission denied')) {
        return 'Database permission error';
      }
      if (msg.includes('does not exist')) {
        return 'Database configuration error';
      }
      if (msg.includes('syntax error') || msg.includes('invalid input syntax')) {
        return 'Invalid query parameters';
      }
      return 'Database operation failed';
    }
  }
  
  // For other errors, return a generic message
  return 'Database operation failed';
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

  // Check for PostgreSQL errors (pg library)
  const isPgError = error && typeof error === 'object' && 'code' in error && 'detail' in error;
  
  // Log full stack trace for unhandled errors (server-side only)
  console.error('[Unhandled Server Error]', {
    error: error,
    message: (error as any)?.message,
    stack: (error as any)?.stack,
    request: {
      method: req.method,
      url: req.url,
      // Don't log request body in production - may contain secrets
      body: process.env.NODE_ENV === 'production' ? '[REDACTED]' : req.body,
    },
  });
  
  // Sanitize error message for client response
  let detail = 'An unexpected internal error occurred';
  if (isPgError) {
    detail = sanitizeDbError(error);
  } else if ((error as any)?.message) {
    detail = (error as any).message;
  }
  
  return res.status(500).json({
    error: { code: 'server_error', message: detail },
  });
};
