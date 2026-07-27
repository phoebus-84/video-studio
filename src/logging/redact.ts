/**
 * Pure redaction functions. These are separate from the logging configuration
 * so they can be used by serializers without importing Fastify.
 */

// ── Sensitive field patterns ────────────────────────────────────────────────

export const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /authorization/i,
  /api[_-]?key/i,
  /credential/i,
  /bearer/i,
  /private[_-]?key/i,
  /access[_-]?key/i,
];

export const SENSITIVE_HEADER_PATTERNS = [
  /authorization/i,
  /x-api-key/i,
  /cookie/i,
  /set-cookie/i,
];

export const REDACTED = "[REDACTED]";

/**
 * Recursively walk an object and replace sensitive values.
 * Returns a new object; never mutates the input.
 */
export function redactObject(obj: unknown, depth: number = 0): unknown {
  if (depth > 10) return obj; // safety net

  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.map((v) => redactObject(v, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERNS.some((p) => p.test(key))) {
      result[key] = REDACTED;
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactObject(value, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Redact sensitive headers from a headers object.
 * Returns a new object; never mutates the input.
 */
export function redactHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  const result: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADER_PATTERNS.some((p) => p.test(key))) {
      result[key] = REDACTED;
    } else {
      result[key] = value;
    }
  }
  return result;
}
