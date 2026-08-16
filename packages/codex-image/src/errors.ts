// ── Errors ──────────────────────────────────────────────────────────────────
//
// One error type with a machine-readable code. Callers dispatch on `code`;
// `detail` carries what a human needs to fix it, which for an undocumented
// backend is usually the difference between "it broke" and "log in again".
// ---------------------------------------------------------------------------

export type CodexImageErrorCode =
  /** No usable credential was supplied. */
  | "NO_CREDENTIAL"
  /** The credential is not a token we can read an account id out of. */
  | "BAD_CREDENTIAL"
  /** Transport failed — DNS, TLS, connection reset. */
  | "NETWORK"
  /** The backend answered with a non-2xx status. */
  | "HTTP"
  /** The backend rejected the request for the content of the prompt. */
  | "MODERATION"
  /** Quota or rate limit. Distinct from HTTP so callers can back off. */
  | "RATE_LIMIT"
  /** A well-formed response that carried no image. */
  | "NO_IMAGE"
  /** The response did not have the shape the protocol promises. */
  | "PROTOCOL"
  /** The caller's deadline elapsed or its signal aborted. */
  | "ABORTED";

export class CodexImageError extends Error {
  readonly code: CodexImageErrorCode;
  readonly detail: string;
  readonly status?: number;

  constructor(code: CodexImageErrorCode, message: string, detail = "", status?: number) {
    super(message);
    this.name = "CodexImageError";
    this.code = code;
    this.detail = detail;
    if (status !== undefined) this.status = status;
  }
}
