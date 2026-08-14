import { randomUUID } from "node:crypto";

// ── Error codes ──────────────────────────────────────────────────────────────

export const ErrorCode = {
  // Gateway-level
  GATEWAY_NOT_READY: "GATEWAY_NOT_READY",
  CONFIG_ERROR: "CONFIG_ERROR",
  TOKEN_ERROR: "TOKEN_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",

  // Runtime
  RUNTIME_UNREACHABLE: "RUNTIME_UNREACHABLE",
  RUNTIME_TIMEOUT: "RUNTIME_TIMEOUT",

  // Pi
  PI_DISCONNECTED: "PI_DISCONNECTED",
  PI_RPC_ERROR: "PI_RPC_ERROR",
  PI_TIMEOUT: "PI_TIMEOUT",

  // Adapter
  ADAPTER_UNREACHABLE: "ADAPTER_UNREACHABLE",

  // Generic
  INTERNAL: "INTERNAL",
  VALIDATION: "VALIDATION",
  NOT_FOUND: "NOT_FOUND",
  BAD_REQUEST: "BAD_REQUEST",
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

// ── Structured application error ─────────────────────────────────────────────

/**
 * Every error emitted by the gateway carries:
 *  - a machine-readable `code`
 *  - a user-actionable `message`
 *  - a `correlationId` for tracing across components
 *  - optional `details` for structured context (never secrets)
 */
export class GatewayError extends Error {
  public readonly code: ErrorCodeType;
  public readonly correlationId: string;
  public readonly details?: Record<string, unknown>;
  public readonly statusCode: number;

  constructor(opts: {
    code: ErrorCodeType;
    message: string;
    correlationId?: string;
    details?: Record<string, unknown>;
    statusCode?: number;
  }) {
    super(opts.message);
    this.name = "GatewayError";
    this.code = opts.code;
    this.correlationId = opts.correlationId ?? randomUUID();
    this.details = opts.details;
    this.statusCode = opts.statusCode ?? statusForCode(opts.code);
  }

  /** Serialize for the API response body (secrets already redacted). */
  toJSON(): Record<string, unknown> {
    return {
      error: this.code,
      message: this.message,
      correlationId: this.correlationId,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

/** Map error codes to HTTP status codes. */
function statusForCode(code: ErrorCodeType): number {
  switch (code) {
    case ErrorCode.UNAUTHORIZED:
      return 401;
    case ErrorCode.NOT_FOUND:
      return 404;
    case ErrorCode.VALIDATION:
    case ErrorCode.BAD_REQUEST:
      return 400;
    case ErrorCode.CONFIG_ERROR:
    case ErrorCode.TOKEN_ERROR:
      return 500;
    case ErrorCode.GATEWAY_NOT_READY:
    case ErrorCode.RUNTIME_UNREACHABLE:
    case ErrorCode.RUNTIME_TIMEOUT:
    case ErrorCode.PI_DISCONNECTED:
    case ErrorCode.PI_RPC_ERROR:
    case ErrorCode.PI_TIMEOUT:
    case ErrorCode.ADAPTER_UNREACHABLE:
      return 503;
    case ErrorCode.INTERNAL:
    default:
      return 500;
  }
}
