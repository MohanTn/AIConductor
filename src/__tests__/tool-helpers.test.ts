/**
 * Unit tests for tool-helpers utility functions
 * Tests MCP argument extraction and result formatting
 */

import { requireString, optionalString, requireEnum, optionalNumber, wrapResult } from '../tool-helpers.js';

describe('requireString', () => {
  test('returns trimmed string when valid', () => {
    const result = requireString({ name: '  value  ' }, 'name');
    expect(result).toBe('value');
  });

  test('throws when field is missing', () => {
    expect(() => requireString({}, 'name')).toThrow('Missing or invalid required field');
  });

  test('throws when field is empty string', () => {
    expect(() => requireString({ name: '' }, 'name')).toThrow('Missing or invalid required field');
  });

  test('throws when field is only whitespace', () => {
    expect(() => requireString({ name: '   ' }, 'name')).toThrow('Missing or invalid required field');
  });

  test('throws when field is not a string', () => {
    expect(() => requireString({ name: 123 }, 'name')).toThrow('Missing or invalid required field');
  });

  test('throws when field is null', () => {
    expect(() => requireString({ name: null }, 'name')).toThrow('Missing or invalid required field');
  });
});

describe('optionalString', () => {
  test('returns trimmed string when present', () => {
    const result = optionalString({ field: '  text  ' }, 'field');
    expect(result).toBe('text');
  });

  test('returns undefined when field is undefined', () => {
    expect(optionalString({}, 'field')).toBeUndefined();
  });

  test('returns undefined when field is null', () => {
    expect(optionalString({ field: null }, 'field')).toBeUndefined();
  });

  test('returns undefined when field is empty string', () => {
    expect(optionalString({ field: '' }, 'field')).toBeUndefined();
  });

  test('returns undefined when field is whitespace only', () => {
    expect(optionalString({ field: '   ' }, 'field')).toBeUndefined();
  });

  test('throws when field is not a string', () => {
    expect(() => optionalString({ field: 123 }, 'field')).toThrow('Invalid field');
  });

  test('throws when field is a boolean', () => {
    expect(() => optionalString({ field: true }, 'field')).toThrow('Invalid field');
  });
});

describe('requireEnum', () => {
  test('returns value when it matches allowed enum', () => {
    const result = requireEnum({ status: 'active' }, 'status', ['active', 'inactive']);
    expect(result).toBe('active');
  });

  test('throws when value is not in allowed enum', () => {
    expect(() => requireEnum({ status: 'unknown' }, 'status', ['active', 'inactive'])).toThrow(
      'Invalid value for'
    );
  });

  test('throws when field is missing', () => {
    expect(() => requireEnum({}, 'status', ['active', 'inactive'])).toThrow(
      'Missing or invalid required field'
    );
  });

  test('works with string literal union types', () => {
    const roles = ['admin', 'user', 'guest'] as const;
    const result = requireEnum({ role: 'admin' }, 'role', roles);
    expect(result).toBe('admin');
  });

  test('includes allowed values in error message', () => {
    expect(() => requireEnum({ level: 'bad' }, 'level', ['high', 'medium', 'low'])).toThrow(
      'high, medium, low'
    );
  });
});

describe('optionalNumber', () => {
  test('returns number when valid', () => {
    expect(optionalNumber({ count: 42 }, 'count')).toBe(42);
  });

  test('returns zero when zero provided', () => {
    expect(optionalNumber({ count: 0 }, 'count')).toBe(0);
  });

  test('returns negative number', () => {
    expect(optionalNumber({ count: -5 }, 'count')).toBe(-5);
  });

  test('returns undefined when field is undefined', () => {
    expect(optionalNumber({}, 'count')).toBeUndefined();
  });

  test('returns undefined when field is null', () => {
    expect(optionalNumber({ count: null }, 'count')).toBeUndefined();
  });

  test('throws when field is not a number', () => {
    expect(() => optionalNumber({ count: '42' }, 'count')).toThrow('Invalid field');
  });

  test('throws when field is boolean', () => {
    expect(() => optionalNumber({ count: true }, 'count')).toThrow('Invalid field');
  });
});

describe('wrapResult', () => {
  test('wraps success result without error flag', () => {
    const result = wrapResult({ success: true, message: 'Done' });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.isError).toBeUndefined();
  });

  test('wraps error result with error flag', () => {
    const result = wrapResult({ success: false, error: 'Failed' });
    expect(result.content).toHaveLength(1);
    expect(result.isError).toBe(true);
  });

  test('wraps null value', () => {
    const result = wrapResult(null);
    expect(result.content[0].text).toContain('null');
  });

  test('wraps string value', () => {
    const result = wrapResult('simple text');
    expect(result.content[0].text).toContain('simple text');
  });

  test('wraps object without success field', () => {
    const result = wrapResult({ data: 'value' });
    expect(result.isError).toBeUndefined();
  });

  test('wraps object with success true', () => {
    const result = wrapResult({ success: true, data: 'value' });
    expect(result.isError).toBeUndefined();
  });

  test('wraps object with success false', () => {
    const result = wrapResult({ success: false, error: 'Error message' });
    expect(result.isError).toBe(true);
  });

  test('prettifies JSON output', () => {
    const result = wrapResult({ nested: { field: 'value' } });
    expect(result.content[0].text).toContain('\n');
  });

  test('handles undefined value', () => {
    const result = wrapResult(undefined);
    // JSON.stringify(undefined) returns undefined, not a string with "undefined"
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
  });

  test('handles array value', () => {
    const result = wrapResult([1, 2, 3]);
    expect(result.content[0].text).toContain('[');
  });
});
