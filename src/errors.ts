/**
 * Shared domain error classes.
 *
 * Kept in a separate module so they can be imported by tests and other
 * lightweight callers without dragging in heavy dependencies (like
 * DatabaseHandler which uses import.meta.url).
 */

/**
 * Thrown when a requested resource does not exist.
 * Maps to HTTP 404 Not Found.
 */
export class NotFoundError extends Error {
  readonly statusCode = 404;
  readonly context?: Record<string, unknown>;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'NotFoundError';
    this.context = context;
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/**
 * Thrown when input validation fails (invalid parameters, missing required fields, etc.).
 * Maps to HTTP 400 Bad Request.
 */
export class ValidationError extends Error {
  readonly statusCode = 400;
  readonly context?: Record<string, unknown>;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'ValidationError';
    this.context = context;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * Thrown when a duplicate or conflicting operation is attempted.
 * Maps to HTTP 409 Conflict.
 */
export class ConflictError extends Error {
  readonly statusCode = 409;
  readonly context?: Record<string, unknown>;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'ConflictError';
    this.context = context;
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

/**
 * Thrown when an actor lacks permission to perform an operation.
 * Maps to HTTP 403 Forbidden.
 */
export class PermissionError extends Error {
  readonly statusCode = 403;
  readonly context?: Record<string, unknown>;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'PermissionError';
    this.context = context;
    Object.setPrototypeOf(this, PermissionError.prototype);
  }
}

/**
 * Thrown when a save is rejected because another writer has already incremented
 * the task version between the load and the save (optimistic concurrency control).
 */
export class ConcurrencyConflictError extends Error {
  /** HTTP-compatible status code so Express middleware can map it correctly. */
  readonly statusCode = 409;

  constructor(taskId: string, expected: number, actual: number) {
    super(
      `Concurrency conflict on task '${taskId}': ` +
      `expected version ${expected} but database has version ${actual}. ` +
      `Reload the feature and retry.`
    );
    this.name = 'ConcurrencyConflictError';
  }
}
