// ---------------------------------------------------------------------------
// Trust, path, output, and destructive-operation guards
// ---------------------------------------------------------------------------
// Security layer for pi-video-agent. Validates all file paths,
// restricts destructive operations, and ensures output stays within
// the approved library boundary.
// ---------------------------------------------------------------------------

import * as path from "node:path";
import { resolveConfig } from "../src/config.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface TrustCheck {
  /** Whether the check passed. */
  allowed: boolean;
  /** Human-readable reason if rejected. */
  reason?: string;
  /** Machine-readable error code. */
  code?: string;
}

export interface GuardContext {
  /** Episode slug being operated on. */
  episodeSlug?: string;
  /** Operation being performed. */
  operation?: string;
  /** Caller identity (Pi tool name or "operator"). */
  caller?: string;
}

// ── Guard functions ─────────────────────────────────────────────────────────

/**
 * Validate a path is within the library root.
 * Prevents path traversal attacks.
 */
export async function guardPath(libraryRoot: string, targetPath: string): Promise<TrustCheck> {
  if (!targetPath || typeof targetPath !== "string") {
    return { allowed: false, reason: "Invalid path", code: "INVALID_PATH" };
  }

  // Resolve to absolute and check containment
  const resolved = path.resolve(libraryRoot, targetPath);
  const normalizedRoot = path.resolve(libraryRoot);

  // Check if path escapes root
  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    return {
      allowed: false,
      reason: `Path "${targetPath}" escapes library root`,
      code: "PATH_TRAVERSAL",
    };
  }

  // Check for suspicious patterns
  if (targetPath.includes("\0") || targetPath.includes("..")) {
    return {
      allowed: false,
      reason: `Path "${targetPath}" contains suspicious patterns`,
      code: "SUSPICIOUS_PATH",
    };
  }

  return { allowed: true };
}

/**
 * Validate that a candidate path is within the episode directory.
 */
export async function guardEpisodePath(
  libraryRoot: string,
  channel: string,
  series: string,
  episode: string,
  artifactPath: string,
): Promise<TrustCheck> {
  // Validate individual components don't contain separators
  for (const comp of [channel, series, episode]) {
    if (comp.includes("/") || comp.includes("\\") || comp.includes("..")) {
      return {
        allowed: false,
        reason: `Invalid component: ${comp}`,
        code: "INVALID_COMPONENT",
      };
    }
  }

  // Build and validate the full path
  const fullPath = path.join(channel, series, episode, artifactPath ?? "");
  return guardPath(libraryRoot, fullPath);
}

/**
 * Guard destructive operations.
 * Operations like "delete", "truncate", or "overwrite-final-render"
 * may require operator confirmation.
 */
export function guardDestructive(
  operation: string,
  ctx?: GuardContext,
): TrustCheck {
  const destructiveOps = new Set([
    "delete",
    "truncate",
    "overwrite",
    "reinitialize",
    "reset-budget",
    "force-rerun",
    "destroy-workspace",
  ]);

  const alwaysAllowed = new Set([
    "read",
    "list",
    "status",
    "probe",
    "validate",
  ]);

  if (alwaysAllowed.has(operation)) {
    return { allowed: true };
  }

  if (destructiveOps.has(operation)) {
    return {
      allowed: false,
      reason: `Operation "${operation}" requires operator confirmation`,
      code: "OPERATOR_CONFIRMATION_REQUIRED",
    };
  }

  // Unknown operations are allowed but logged
  return { allowed: true };
}

/**
 * Guard output boundaries.
 * Generated output must stay within the approved library or temp directories.
 */
export function guardOutput(
  outputPath: string,
  libraryRoot: string,
): TrustCheck {
  const allowedPrefixes = [
    path.resolve(libraryRoot),
    path.resolve(process.cwd(), "tmp"),
    path.resolve(process.cwd(), ".pi-output"),
  ];

  const resolved = path.resolve(outputPath);

  for (const prefix of allowedPrefixes) {
    if (resolved.startsWith(prefix + path.sep) || resolved === prefix) {
      return { allowed: true };
    }
  }

  return {
    allowed: false,
    reason: `Output path "${outputPath}" is outside approved directories`,
    code: "OUTPUT_BOUNDARY_VIOLATION",
  };
}

/**
 * Sanitize a user-provided episode slug.
 * Ensures it matches channel/series/episode pattern.
 */
export function sanitizeSlug(slug: string): TrustCheck & { sanitized?: string } {
  if (!slug || typeof slug !== "string") {
    return { allowed: false, reason: "Missing slug", code: "INVALID_SLUG" };
  }

  // Slug must match: word-word/word-word/word-word
  const pattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?\/[a-z0-9]([a-z0-9-]*[a-z0-9])?\/[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

  if (!pattern.test(slug)) {
    return {
      allowed: false,
      reason: `Slug "${slug}" does not match pattern <channel>/<series>/<episode>`,
      code: "INVALID_SLUG",
    };
  }

  const parts = slug.split("/");
  if (parts.length !== 3) {
    return { allowed: false, reason: "Slug must have exactly 3 segments", code: "INVALID_SLUG" };
  }

  // Check segment lengths
  for (const part of parts) {
    if (part!.length > 64) {
      return {
        allowed: false,
        reason: `Segment "${part}" exceeds 64 characters`,
        code: "SLUG_TOO_LONG",
      };
    }
  }

  return { allowed: true, sanitized: slug };
}

/**
 * Composite guard: check all trust boundaries for an operation.
 */
export async function trustGuard(
  operation: string,
  params: {
    channel?: string;
    series?: string;
    episode?: string;
    path?: string;
    outputPath?: string;
    caller?: string;
  },
): Promise<TrustCheck> {
  const config = await resolveConfig();

  // 1. Destructive operation check
  const destructive = guardDestructive(operation, { caller: params.caller });
  if (!destructive.allowed) return destructive;

  // 2. Slug validation
  if (params.channel && params.series && params.episode) {
    const slug = sanitizeSlug(`${params.channel}/${params.series}/${params.episode}`);
    if (!slug.allowed) return slug;
  }

  // 3. Path containment
  if (params.path) {
    const pathCheck = await guardEpisodePath(
      config.libraryRoot,
      params.channel ?? "unknown",
      params.series ?? "unknown",
      params.episode ?? "unknown",
      params.path,
    );
    if (!pathCheck.allowed) return pathCheck;
  }

  // 4. Output boundary
  if (params.outputPath) {
    const outputCheck = guardOutput(params.outputPath, config.libraryRoot);
    if (!outputCheck.allowed) return outputCheck;
  }

  return { allowed: true };
}
