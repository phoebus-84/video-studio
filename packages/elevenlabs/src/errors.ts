/** Why an ElevenLabs call failed; `code` is what callers branch on. */
export type ElevenLabsErrorCode =
  | "auth"          // 401/403: the key is wrong or lacks the permission; never retried
  | "quota"         // the account's quota is used up; never retried
  | "rate-limited"  // 429 after the retries
  | "bad-request"   // 400/422: the request itself is wrong
  | "server"        // 5xx after the retries
  | "unreachable"   // no connection was made: nothing was sent
  | "uncertain";    // the connection broke after the request left: it may have been processed

export class ElevenLabsError extends Error {
  constructor(readonly code: ElevenLabsErrorCode, message: string, readonly status?: number) {
    super(message);
    this.name = "ElevenLabsError";
  }
}
