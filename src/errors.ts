/**
 * Shared domain error classes.
 *
 * Kept in a separate module so they can be imported by tests and other
 * lightweight callers without dragging in heavy dependencies (like
 * DatabaseHandler which uses import.meta.url).
 */

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
