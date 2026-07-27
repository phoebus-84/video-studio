import { resolve, normalize, isAbsolute } from "node:path";
import { realpathSync } from "node:fs";
import { GatewayError, ErrorCode } from "../errors/index.js";

/**
 * Validate and canonicalize allowed library roots.
 *
 * Every root is resolved to an absolute real path. Symlinks are followed.
 * Roots that do not exist throw a descriptive CONFIG_ERROR.
 */
export function canonicalizeRoots(roots: string[]): string[] {
  return roots.map((root) => {
    const abs = isAbsolute(root) ? root : resolve(root);
    try {
      return realpathSync(normalize(abs));
    } catch {
      throw new GatewayError({
        code: ErrorCode.CONFIG_ERROR,
        message: `Library root "${root}" (resolved to "${abs}") does not exist or is inaccessible.`,
      });
    }
  });
}

/**
 * Check whether `targetPath` is within any of the allowed roots.
 *
 * Symlinks are resolved before comparison to prevent escape via
 * symlink traversal.
 */
export function isWithinRoots(
  targetPath: string,
  allowedRoots: string[],
): boolean {
  let resolved: string;
  try {
    resolved = realpathSync(normalize(resolve(targetPath)));
  } catch {
    return false;
  }

  return allowedRoots.some((root) => {
    // Must be equal or a child
    if (resolved === root) return true;
    // Check with trailing separator to avoid false prefix matches
    // e.g., /workspace-foo should not match /workspace
    return resolved.startsWith(root + "/") || resolved.startsWith(root + "\\");
  });
}

/**
 * Assert that `targetPath` is within the allowed roots.
 * @throws {GatewayError} with code BAD_REQUEST if outside roots.
 */
export function assertWithinRoots(
  targetPath: string,
  allowedRoots: string[],
): void {
  if (!isWithinRoots(targetPath, allowedRoots)) {
    throw new GatewayError({
      code: ErrorCode.BAD_REQUEST,
      message: `Path "${targetPath}" is outside the allowed library roots.`,
      details: {
        resolvedRoots: allowedRoots,
      },
    });
  }
}
