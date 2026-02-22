/**
 * Shared helpers for MCP tool argument extraction and result formatting.
 * These are pure utility functions with no side effects or singletons.
 */

// ─── Argument extraction helpers ─────────────────────────────────────────────

export function requireString(args: Record<string, unknown>, field: string): string {
  const val = args[field];
  if (typeof val !== 'string' || val.trim() === '') {
    throw new Error(
      `Missing or invalid required field: '${field}' (expected non-empty string, got ${typeof val})`
    );
  }
  return val.trim();
}

export function optionalString(
  args: Record<string, unknown>,
  field: string
): string | undefined {
  const val = args[field];
  if (val === undefined || val === null) return undefined;
  if (typeof val !== 'string') {
    throw new Error(`Invalid field '${field}': expected string, got ${typeof val}`);
  }
  return val.trim() || undefined;
}

export function requireEnum<T extends string>(
  args: Record<string, unknown>,
  field: string,
  allowed: readonly T[]
): T {
  const val = requireString(args, field);
  if (!allowed.includes(val as T)) {
    throw new Error(`Invalid value for '${field}': '${val}'. Allowed: ${allowed.join(', ')}`);
  }
  return val as T;
}

export function optionalNumber(
  args: Record<string, unknown>,
  field: string
): number | undefined {
  const val = args[field];
  if (val === undefined || val === null) return undefined;
  if (typeof val !== 'number') {
    throw new Error(`Invalid field '${field}': expected number, got ${typeof val}`);
  }
  return val;
}

// ─── Result formatting ────────────────────────────────────────────────────────

/** Standardised MCP tool result type. */
export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

/**
 * Wrap any value as an MCP tool result.
 * Automatically sets `isError: true` when the result has `success: false`.
 */
export function wrapResult(result: unknown): ToolResult {
  const isErrorResult =
    result &&
    typeof result === 'object' &&
    'success' in result &&
    (result as Record<string, unknown>).success === false;
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    ...(isErrorResult ? { isError: true } : {}),
  };
}
