/**
 * Centralized Express error handling middleware (T01)
 *
 * Provides:
 *  - Custom typed error classes with HTTP status codes
 *  - asyncHandler: wraps async route handlers and forwards thrown errors to next()
 *  - errorMiddleware: global error handler registered after all routes in dashboard.ts
 */
import { Request, Response, NextFunction, RequestHandler } from 'express';

// ─── Custom Error Classes ────────────────────────────────────────────────────

/**
 * Base class for all application errors.
 * Subclasses set an HTTP statusCode so errorMiddleware can map them correctly.
 */
export class AppError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    // Maintains correct prototype chain in TypeScript transpiled output
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 400 Bad Request — missing or invalid input */
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

/** 404 Not Found — resource does not exist */
export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404);
  }
}

/** 409 Conflict — e.g. duplicate record or version mismatch */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}

// ─── asyncHandler ────────────────────────────────────────────────────────────

/**
 * Wraps an async Express route handler so that any thrown error (or rejected
 * promise) is forwarded to Express's next() and handled by errorMiddleware.
 *
 * @example
 * router.get('/tasks', asyncHandler(async (req, res) => {
 *   const data = await reviewManager.getTasks(...);
 *   res.json(data);
 * }));
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => unknown
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Wrap result in Promise.resolve so that both synchronous throws and
      // async rejections are forwarded to next() for the error middleware.
      Promise.resolve(fn(req, res, next)).catch(next);
    } catch (err) {
      next(err);
    }
  };
}

// ─── Global Error Middleware ─────────────────────────────────────────────────

/**
 * Global Express error handler — register as the LAST middleware in dashboard.ts
 * (after all routes) using: app.use(errorMiddleware)
 *
 * Maps known error types to appropriate HTTP status codes and returns a
 * consistent { error: string } JSON body.  In production, stack traces are
 * stripped from the response; the full error is always logged server-side.
 */
export function errorMiddleware(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Always log the full error server-side for debugging
  console.error('[Dashboard Error]', err);

  // Determine HTTP status code
  let statusCode = 500;
  if (err instanceof AppError) {
    statusCode = err.statusCode;
  } else if (err.message) {
    // Heuristic mapping for errors thrown by AIConductor / DatabaseHandler
    // that don't use typed error classes yet
    const msg = err.message.toLowerCase();
    if (msg.includes('not found') || msg.includes('does not exist')) {
      statusCode = 404;
    } else if (
      msg.includes('required') ||
      msg.includes('invalid') ||
      msg.includes('missing') ||
      msg.includes('must be')
    ) {
      statusCode = 400;
    } else if (msg.includes('unique constraint') || msg.includes('conflict')) {
      statusCode = 409;
    }
  }

  // Build response — strip stack traces in production
  const isDev = process.env.NODE_ENV !== 'production';
  const body: Record<string, unknown> = {
    error: err.message || 'An unexpected error occurred',
  };
  if (isDev && err.stack) {
    body['stack'] = err.stack;
  }

  res.status(statusCode).json(body);
}
