/**
 * Unit tests for custom error classes (errors.ts)
 * Tests all 5 domain error types: NotFoundError, ValidationError, ConflictError, PermissionError, ConcurrencyConflictError
 */

import {
  NotFoundError,
  ValidationError,
  ConflictError,
  PermissionError,
  ConcurrencyConflictError,
} from '../errors.js';

describe('NotFoundError', () => {
  test('should instantiate with message', () => {
    const err = new NotFoundError('Resource not found');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.name).toBe('NotFoundError');
    expect(err.message).toBe('Resource not found');
    expect(err.statusCode).toBe(404);
    expect(err.context).toBeUndefined();
  });

  test('should store optional context', () => {
    const context = { resourceId: '123', type: 'feature' };
    const err = new NotFoundError('Feature not found', context);
    expect(err.context).toEqual(context);
    expect(err.statusCode).toBe(404);
  });

  test('should preserve instanceof after thrown/caught', () => {
    const err = new NotFoundError('Test');
    expect(err instanceof NotFoundError).toBe(true);
  });
});

describe('ValidationError', () => {
  test('should instantiate with message', () => {
    const err = new ValidationError('Invalid input');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.name).toBe('ValidationError');
    expect(err.message).toBe('Invalid input');
    expect(err.statusCode).toBe(400);
    expect(err.context).toBeUndefined();
  });

  test('should store optional context', () => {
    const context = { field: 'featureSlug', value: '' };
    const err = new ValidationError('Feature slug is required', context);
    expect(err.context).toEqual(context);
    expect(err.statusCode).toBe(400);
  });

  test('should be catchable with instanceof', () => {
    try {
      throw new ValidationError('Test error');
    } catch (e) {
      expect(e instanceof ValidationError).toBe(true);
      expect(e instanceof Error).toBe(true);
    }
  });
});

describe('ConflictError', () => {
  test('should instantiate with message', () => {
    const err = new ConflictError('Feature already exists');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.name).toBe('ConflictError');
    expect(err.message).toBe('Feature already exists');
    expect(err.statusCode).toBe(409);
    expect(err.context).toBeUndefined();
  });

  test('should store optional context', () => {
    const context = { featureSlug: 'my-feature' };
    const err = new ConflictError('Duplicate feature', context);
    expect(err.context).toEqual(context);
    expect(err.statusCode).toBe(409);
  });
});

describe('PermissionError', () => {
  test('should instantiate with message', () => {
    const err = new PermissionError('Access denied');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PermissionError);
    expect(err.name).toBe('PermissionError');
    expect(err.message).toBe('Access denied');
    expect(err.statusCode).toBe(403);
    expect(err.context).toBeUndefined();
  });

  test('should store optional context', () => {
    const context = { actor: 'user123', action: 'delete' };
    const err = new PermissionError('User cannot delete this feature', context);
    expect(err.context).toEqual(context);
    expect(err.statusCode).toBe(403);
  });
});

describe('ConcurrencyConflictError', () => {
  test('should format message with task details', () => {
    const err = new ConcurrencyConflictError('T01', 5, 6);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ConcurrencyConflictError);
    expect(err.name).toBe('ConcurrencyConflictError');
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain('T01');
    expect(err.message).toContain('version 5');
    expect(err.message).toContain('version 6');
    expect(err.message).toContain('Reload');
  });

  test('should work with different task IDs', () => {
    const err1 = new ConcurrencyConflictError('task-alpha', 1, 2);
    expect(err1.message).toContain('task-alpha');

    const err2 = new ConcurrencyConflictError('T999', 100, 101);
    expect(err2.message).toContain('T999');
    expect(err2.message).toContain('version 100');
    expect(err2.message).toContain('version 101');
  });
});

describe('Error status code mapping', () => {
  test('NotFoundError maps to 404', () => {
    expect(new NotFoundError('').statusCode).toBe(404);
  });

  test('ValidationError maps to 400', () => {
    expect(new ValidationError('').statusCode).toBe(400);
  });

  test('ConflictError maps to 409', () => {
    expect(new ConflictError('').statusCode).toBe(409);
  });

  test('PermissionError maps to 403', () => {
    expect(new PermissionError('').statusCode).toBe(403);
  });

  test('ConcurrencyConflictError maps to 409', () => {
    expect(new ConcurrencyConflictError('T01', 1, 2).statusCode).toBe(409);
  });
});

describe('Error prototype chain', () => {
  test('all errors are instances of Error', () => {
    const errors = [
      new NotFoundError(''),
      new ValidationError(''),
      new ConflictError(''),
      new PermissionError(''),
      new ConcurrencyConflictError('T', 1, 2),
    ];

    errors.forEach(err => {
      expect(err instanceof Error).toBe(true);
      expect(err.name).toBeDefined();
      expect(err.message).toBeDefined();
      expect(err.statusCode).toBeDefined();
    });
  });
});
