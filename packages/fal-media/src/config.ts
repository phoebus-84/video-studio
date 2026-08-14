// ─── Configuration resolution ────────────────────────────────────────
// Reads FAL_KEY from the environment and applies defaults.  Exposes a
// typed unavailable state when the key is missing so callers never have
// to guess.

import { FalUnavailableError } from "./errors.js";
import type { FalAdapterConfig } from "./types.js";

const FAL_KEY_ENV = "FAL_KEY";
const DEFAULT_BASE_URL = "https://queue.fal.run";
const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
const DEFAULT_MAX_RETRIES = 3;

/**
 * Resolve adapter configuration from the process environment.
 *
 * Returns a {@link FalUnavailableError} when FAL_KEY is missing so the
 * caller can distinguish "not configured" from "failed".
 */
export function resolveConfig(env: typeof process.env = process.env): FalAdapterConfig | FalUnavailableError {
  const rawKey = env[FAL_KEY_ENV];

  if (!rawKey || rawKey.trim().length === 0) {
    return new FalUnavailableError(
      `${FAL_KEY_ENV} environment variable is not set or empty`,
    );
  }

  return {
    falKey: rawKey.trim(),
    baseUrl: env["FAL_BASE_URL"]?.trim() || DEFAULT_BASE_URL,
    defaultTimeoutMs: parsePositiveInt(
      env["FAL_DEFAULT_TIMEOUT_MS"],
      DEFAULT_TIMEOUT_MS,
    ),
    maxRetries: parsePositiveInt(
      env["FAL_MAX_RETRIES"],
      DEFAULT_MAX_RETRIES,
    ),
  };
}

/**
 * Assert that config resolved successfully or throw the unavailable error.
 */
export function requireConfig(
  env: typeof process.env = process.env,
): FalAdapterConfig {
  const result = resolveConfig(env);
  if (result instanceof FalUnavailableError) {
    throw result;
  }
  return result;
}

// ─── Key redaction ────────────────────────────────────────────────────

/**
 * Return a redacted version of a fal key safe for logging and diagnostics.
 *
 * Format: `fal-<first 4>...<last 4>`  (or a shorter placeholder for very
 * short keys).
 */
export function redactKey(key: string): string {
  if (key.length <= 8) {
    return "fal-****";
  }
  return `fal-${key.slice(0, 4)}...${key.slice(-4)}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) return fallback;
  return n;
}
