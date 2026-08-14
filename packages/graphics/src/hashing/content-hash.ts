// ── Stable content hashing ──
// Uses SHA-256 with deterministic canonical JSON serialization.
// Keys are sorted alphabetically; values follow JSON.stringify rules.

import { createHash } from 'node:crypto';

/**
 * Compute a SHA-256 content hash of any JSON-serializable value.
 *
 * Serialization is deterministic:
 * - Object keys are sorted alphabetically.
 * - Floats are serialized with enough precision to round-trip.
 * - Undefined values are normalized to null.
 *
 * @returns Canonical `sha256:`-prefixed lowercase digest
 */
export function computeContentHash(value: unknown): string {
  const canonical = serializeCanonical(value);
  const hash = createHash('sha256');
  hash.update(canonical, 'utf8');
  return `sha256:${hash.digest('hex')}`;
}

/**
 * Generate a stable opaque ID with a typed prefix.
 *
 * Format: `<prefix>_<hash-truncated>`
 * The prefix identifies the entity type (lowercase, single segment).
 * Consumers compare IDs for equality but must not parse the payload.
 *
 * @param prefix - Type prefix, e.g. "gr" for graphic render
 * @param value - Value to derive identity from
 * @returns Stable opaque ID
 */
export function generateStableId(prefix: string, value: unknown): string {
  const hash = computeContentHash(value).slice('sha256:'.length);
  // Use first 32 hex chars (128 bits) — sufficient for collision resistance
  return `${prefix}_${hash.slice(0, 32)}`;
}

/**
 * Verify that two values have the same content hash.
 */
export function contentHashEquals(a: unknown, b: unknown): boolean {
  return computeContentHash(a) === computeContentHash(b);
}

// ── Canonical serializer ──

function serializeCanonical(value: unknown): string {
  const normalized = normalizeForCanonical(value);
  return JSON.stringify(normalized);
}

function normalizeForCanonical(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Map) {
    // Convert Maps to sorted objects
    const obj: Record<string, unknown> = {};
    const sortedKeys = [...value.keys()].sort();
    for (const k of sortedKeys) {
      obj[String(k)] = normalizeForCanonical(value.get(k));
    }
    return obj;
  }
  if (value instanceof Set) {
    // Convert Sets to sorted arrays
    return [...value].map(normalizeForCanonical).sort();
  }
  if (Array.isArray(value)) {
    return value.map(normalizeForCanonical);
  }
  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value).sort();
    for (const k of keys) {
      sorted[k] = normalizeForCanonical((value as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  return value;
}

/**
 * Sort the keys of an object and return a new object.
 * Used internally. Also available for callers that need
 * to normalize objects before comparison.
 */
export function sortObjectKeys<T extends Record<string, unknown>>(obj: T): T {
  const sorted = Object.keys(obj)
    .sort()
    .reduce(
      (acc, key) => {
        acc[key] = obj[key];
        return acc;
      },
      {} as Record<string, unknown>,
    );
  return sorted as T;
}
