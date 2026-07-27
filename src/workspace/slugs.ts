// ---------------------------------------------------------------------------
// Slug validation
//
// Every workspace (channel, series, episode) is identified by a URL-safe
// slug that also serves as its directory name.
//
// Rules (strict, no silent coercion):
//   - Non-empty, max 64 characters.
//   - Lowercase ASCII letters, digits, and single hyphens only.
//   - Must start and end with an alphanumeric character.
//   - No consecutive hyphens.
//   - No leading/trailing hyphens.
// ---------------------------------------------------------------------------

import type { Result } from "../result.js";
import { ok, err } from "../result.js";
import { invalidArgument } from "../errors.js";

/** Maximum slug length in characters. */
export const SLUG_MAX_LENGTH = 64;

/**
 * Regular expression for a valid slug.
 *
 * - Start with alphanumeric
 * - Middle: alphanumeric or single hyphen
 * - End with alphanumeric
 * - Total length 1–64
 */
const SLUG_RE = /^[a-z0-9]([a-z0-9]|-(?=[a-z0-9])){0,62}[a-z0-9]$/;

/** Single-char slugs that are also valid. */
const SLUG_SINGLE_RE = /^[a-z0-9]$/;

/**
 * Validate a slug string.
 *
 * Returns `Ok<slug>` when valid, `Err<RuntimeError>` with a
 * machine-actionable message otherwise.
 */
export function validateSlug(raw: string): Result<string, ReturnType<typeof invalidArgument>> {
  if (raw.length === 0) {
    return err(
      invalidArgument("Slug must not be empty", { raw, reason: "empty" }),
    );
  }

  if (raw.length > SLUG_MAX_LENGTH) {
    return err(
      invalidArgument("Slug exceeds maximum length", {
        raw,
        maxLength: SLUG_MAX_LENGTH,
        actualLength: raw.length,
        reason: "too-long",
      }),
    );
  }

  // Single character slug: must be alphanumeric
  if (raw.length === 1) {
    if (SLUG_SINGLE_RE.test(raw)) {
      return ok(raw);
    }
    return err(
      invalidArgument("Single-character slug must be a lowercase letter or digit", {
        raw,
        reason: "invalid-char",
      }),
    );
  }

  if (!SLUG_RE.test(raw)) {
    // Provide a specific diagnostic for common mistakes.
    let reason = "invalid-format";
    const details: Record<string, unknown> = { raw };

    if (raw !== raw.toLowerCase()) {
      reason = "uppercase";
      details.hint = "Use only lowercase letters";
    } else if (raw.startsWith("-") || raw.endsWith("-")) {
      reason = "leading-trailing-hyphen";
      details.hint = "Slug must start and end with alphanumeric";
    } else if (raw.includes("--")) {
      reason = "consecutive-hyphens";
      details.hint = "Use single hyphens only";
    } else {
      const badChar = raw.match(/[^a-z0-9-]/);
      if (badChar) {
        reason = "invalid-char";
        details.hint = `Character '${badChar[0]}' is not allowed`;
      }
    }

    return err(invalidArgument(`Invalid slug: ${raw}`, { ...details, reason }));
  }

  return ok(raw);
}
