// ─── Structured errors for fal-media-adapter ──────────────────────────
// Every failure path produces a typed, machine-readable error.

/** Base error for all fal-adapter failures. */
export class FalAdapterError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly details: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    retryable = false,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "FalAdapterError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }

  /** Machine-readable envelope for logging / diagnostics. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      details: this.details,
    };
  }
}

/**
 * Typed unavailable state – the adapter cannot operate because a required
 * secret (FAL_KEY) is missing.  This is **not** a runtime exception; it is
 * an explicit state that callers can branch on.
 */
export class FalUnavailableError extends FalAdapterError {
  public readonly reason: string;

  constructor(reason: string) {
    super(
      `fal.ai adapter is unavailable: ${reason}`,
      "FAL_UNAVAILABLE",
      false,
      { reason },
    );
    this.name = "FalUnavailableError";
    this.reason = reason;
  }
}

/** The server returned a non-2xx status. */
export class FalHttpError extends FalAdapterError {
  public readonly status: number;
  public readonly responseBody: string;

  constructor(status: number, responseBody: string, retryable = false) {
    const truncated = responseBody.slice(0, 500);
    super(
      `fal API returned HTTP ${status}: ${truncated}`,
      "FAL_HTTP_ERROR",
      retryable,
      { status },
    );
    this.name = "FalHttpError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

/** Network-level failure (DNS, connection refused, TLS, etc.). */
export class FalNetworkError extends FalAdapterError {
  public readonly cause: string;

  constructor(cause: string) {
    super(`Network error: ${cause}`, "FAL_NETWORK_ERROR", true, { cause });
    this.name = "FalNetworkError";
    this.cause = cause;
  }
}

/** The operation was cancelled by an AbortSignal. */
export class FalCancelledError extends FalAdapterError {
  constructor(reason = "operation cancelled") {
    super(reason, "FAL_CANCELLED", false, {});
    this.name = "FalCancelledError";
  }
}

/** A timeout elapsed before the operation completed. */
export class FalTimeoutError extends FalAdapterError {
  public readonly timeoutMs: number;

  constructor(timeoutMs: number, context = "operation") {
    super(
      `${context} timed out after ${timeoutMs}ms`,
      "FAL_TIMEOUT",
      true,
      { timeoutMs },
    );
    this.name = "FalTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/** The response payload did not match the expected contract. */
export class FalContractError extends FalAdapterError {
  constructor(field: string, expected: string, received: string) {
    super(
      `Contract violation in "${field}": expected ${expected}, got ${received}`,
      "FAL_CONTRACT_ERROR",
      false,
      { field, expected, received },
    );
    this.name = "FalContractError";
  }
}

/** Parameter validation failed – unknown/invalid parameters rejected before spend. */
export class FalValidationError extends FalAdapterError {
  constructor(
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message, "FAL_VALIDATION_ERROR", false, details);
    this.name = "FalValidationError";
  }
}

/** The requested profile is deprecated and should be migrated. */
export class FalDeprecatedProfileError extends FalAdapterError {
  constructor(
    profileId: string,
    message: string,
    migrationTarget?: string,
  ) {
    super(
      message,
      "FAL_DEPRECATED_PROFILE",
      false,
      { profileId, migrationTarget: migrationTarget ?? null },
    );
    this.name = "FalDeprecatedProfileError";
  }
}

/** Download validation failed (e.g. hash mismatch). */
export class FalDownloadError extends FalAdapterError {
  constructor(url: string, reason: string, retryable = true) {
    super(
      `Download failed for ${url}: ${reason}`,
      "FAL_DOWNLOAD_ERROR",
      retryable,
      { url, reason },
    );
    this.name = "FalDownloadError";
  }
}
