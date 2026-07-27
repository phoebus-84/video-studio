// ---------------------------------------------------------------------------
// Structured domain errors
//
// Every error returned by the runtime carries a machine-readable `code` so
// consumers (CLI, gateway, Pi) can branch without string-matching messages.
// ---------------------------------------------------------------------------

/** Canonical set of error codes owned by this module. */
export const ErrorCode = {
  // Generic
  INTERNAL: "E_INTERNAL",
  INVALID_ARGUMENT: "E_INVALID_ARGUMENT",
  NOT_FOUND: "E_NOT_FOUND",
  PERMISSION_DENIED: "E_PERMISSION_DENIED",
  ALREADY_EXISTS: "E_ALREADY_EXISTS",
  TIMEOUT: "E_TIMEOUT",
  CANCELLED: "E_CANCELLED",
  UNAVAILABLE: "E_UNAVAILABLE",

  // Domain-specific (space reserved for future phases)
  WORKSPACE_NOT_INITIALIZED: "E_WORKSPACE_NOT_INITIALIZED",
  PIPELINE_RESOLUTION_FAILED: "E_PIPELINE_RESOLUTION_FAILED",
  SNAPSHOT_INVALID: "E_SNAPSHOT_INVALID",
  LEASE_CONFLICT: "E_LEASE_CONFLICT",
  LEASE_EXPIRED: "E_LEASE_EXPIRED",
  ARTIFACT_VALIDATION_FAILED: "E_ARTIFACT_VALIDATION_FAILED",
  STALE_DEPENDENCY: "E_STALE_DEPENDENCY",
  BUDGET_EXCEEDED: "E_BUDGET_EXCEEDED",
  APPROVAL_REQUIRED: "E_APPROVAL_REQUIRED",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

// ---- Base error ------------------------------------------------------------

/**
 * Structured error base class.
 *
 * Every error that crosses a public API boundary extends this so callers
 * receive a predictable `code` field alongside diagnostic `details`.
 */
export class RuntimeError extends Error {
  public readonly code: ErrorCodeValue;
  public readonly details: Record<string, unknown> | undefined;

  constructor(
    code: ErrorCodeValue,
    message: string,
    options?: {
      cause?: unknown;
      details?: Record<string, unknown>;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = "RuntimeError";
    this.code = code;
    this.details = options?.details;
  }

  /** JSON-safe representation for logging / serialisation. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

// ---- Factory helpers -------------------------------------------------------

export function internalError(
  message: string,
  cause?: unknown,
): RuntimeError {
  return new RuntimeError(ErrorCode.INTERNAL, message, { cause });
}

export function invalidArgument(
  message: string,
  details?: Record<string, unknown>,
): RuntimeError {
  return new RuntimeError(ErrorCode.INVALID_ARGUMENT, message, { details });
}

export function notFound(
  message: string,
  details?: Record<string, unknown>,
): RuntimeError {
  return new RuntimeError(ErrorCode.NOT_FOUND, message, { details });
}

export function permissionDenied(
  message: string,
  details?: Record<string, unknown>,
): RuntimeError {
  return new RuntimeError(ErrorCode.PERMISSION_DENIED, message, { details });
}

export function alreadyExists(
  message: string,
  details?: Record<string, unknown>,
): RuntimeError {
  return new RuntimeError(ErrorCode.ALREADY_EXISTS, message, { details });
}

export function timeoutError(
  message: string,
  details?: Record<string, unknown>,
): RuntimeError {
  return new RuntimeError(ErrorCode.TIMEOUT, message, { details });
}

export function cancelledError(
  message: string,
  details?: Record<string, unknown>,
): RuntimeError {
  return new RuntimeError(ErrorCode.CANCELLED, message, { details });
}

export function leaseConflict(
  message: string,
  details?: Record<string, unknown>,
): RuntimeError {
  return new RuntimeError(ErrorCode.LEASE_CONFLICT, message, { details });
}

export function leaseExpired(
  message: string,
  details?: Record<string, unknown>,
): RuntimeError {
  return new RuntimeError(ErrorCode.LEASE_EXPIRED, message, { details });
}
