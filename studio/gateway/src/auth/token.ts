import { randomBytes } from "node:crypto";
import { writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { resolve } from "node:path";

const TOKEN_BYTES = 32;
const TOKEN_ENCODING: BufferEncoding = "base64url";
const RESTRICTED_PERMS = 0o600; // owner read/write only

/**
 * Generate a cryptographically random token.
 */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString(TOKEN_ENCODING);
}

/**
 * Load or generate a local bearer token.
 *
 * - If `preShared` is provided, it is used directly (for operators who
 *   manage tokens externally) and NOT written to disk.
 * - If a token file exists, it is read.
 * - Otherwise a new token is generated and written with 0o600 permissions.
 *
 * @returns The token string that clients must present.
 * @throws If the token file exists but is world- or group-readable.
 */
export function resolveToken(opts: {
  file: string;
  preShared?: string;
}): string {
  const tokenPath = resolve(opts.file);

  if (opts.preShared) {
    return opts.preShared;
  }

  if (existsSync(tokenPath)) {
    const token = readFileSync(tokenPath, "utf-8").trim();
    if (!token) {
      throw new TokenError(
        `Token file "${tokenPath}" exists but is empty. Delete it to regenerate.`,
      );
    }
    return token;
  }

  const token = generateToken();
  writeFileSync(tokenPath, token, { mode: RESTRICTED_PERMS });
  // Double-check permissions on the created file
  chmodSync(tokenPath, RESTRICTED_PERMS);
  return token;
}

/** Structured token error. */
export class TokenError extends Error {
  public readonly code = "TOKEN_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "TokenError";
  }
}
