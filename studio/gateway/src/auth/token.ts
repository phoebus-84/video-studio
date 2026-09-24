import { randomBytes } from "node:crypto";
import { writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { readOperatorKey } from "@studio/contracts/src/operator-key.mjs";

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

/**
 * The operator key: generated like the token, then held to the same 0600
 * rule by the reader the CLI uses, so the two cannot disagree about what a
 * valid key file is (avg-qr4.3).
 *
 * `resolveToken` creates or reads the raw bytes; `readOperatorKey` then
 * enforces the permission check `resolveToken` does not make on its own read
 * path, so a key file that exists but is group- or world-readable is refused
 * here rather than handed out.
 */
export function resolveOperatorKey(file: string): string {
  resolveToken({ file });
  const key = readOperatorKey(resolve(file));
  if (!key) throw new TokenError(`Operator key "${file}" could not be created`);
  return key;
}

/** Structured token error. */
export class TokenError extends Error {
  public readonly code = "TOKEN_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "TokenError";
  }
}
