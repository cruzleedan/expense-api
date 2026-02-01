import type { Context, MiddlewareHandler, ErrorHandler } from 'hono';
import { AppError } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { ZodError } from 'zod';

interface ErrorResponse {
  error: {
    message: string;
    code?: string;
    details?: unknown;
  };
}

// Middleware-style error handler (for non-OpenAPI routes)
export const errorHandler: MiddlewareHandler = async (c, next) => {
  try {
    await next();
  } catch (error) {
    return handleError(c, error);
  }
};

// Global error handler for Hono's app.onError (catches OpenAPI route errors)
export const globalErrorHandler: ErrorHandler = (error, c) => {
  return handleError(c, error);
};

export function handleError(c: Context, error: unknown): Response {
  if (error instanceof AppError) {
    logger.warn('Application error', {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
    });

    const response: ErrorResponse = {
      error: {
        message: error.message,
        code: error.code,
      },
    };

    return c.json(response, error.statusCode as 400 | 401 | 403 | 404 | 409 | 500);
  }

  if (error instanceof ZodError) {
    logger.warn('Validation error', { issues: error.issues });

    const response: ErrorResponse = {
      error: {
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    };

    return c.json(response, 400);
  }

  // Unknown error
  const message = error instanceof Error ? error.message : 'Unknown error';
  const stack = error instanceof Error ? error.stack : undefined;

  logger.error('Unhandled error', { message, stack });

  const response: ErrorResponse = {
    error: {
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    },
  };

  return c.json(response, 500);
}
