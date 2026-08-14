import { z } from "zod";

// ── Bind address ─────────────────────────────────────────────────────────────
// Default: loopback only. Non-loopback requires an explicit secure configuration.
const loopbackPatterns = [
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^\[::1\]$/,
  /^::1$/,
  /^localhost$/i,
] as const;

function isLoopback(host: string): boolean {
  return loopbackPatterns.some((p) => p.test(host));
}

export const bindAddressSchema = z
  .string()
  .min(1)
  .refine(
    () => true, // validation happens post-parse in resolveBind
    { message: "Non-loopback bind requires explicit secure configuration" },
  );

// ── Allowed origins ──────────────────────────────────────────────────────────
export const allowedOriginsSchema = z
  .array(z.string())
  .default([])
  .describe("CORS allowed origins; defaults to empty (loopback only)");

// ── Token config ─────────────────────────────────────────────────────────────
export const tokenConfigSchema = z.object({
  /** Path where the generated token is stored. */
  file: z.string().default(".gateway-token"),
  /**
   * A pre-shared token. If omitted, a cryptographic token is generated
   * on first start and persisted with restrictive file permissions.
   */
  preShared: z.string().optional(),
  /**
   * Accept the well-known "dev-token" in addition to the real token.
   *
   * ADR-0030: this defaults to false so the ordinary end-to-end path
   * exercises real authentication and the web studio must present the real
   * token. Enable it only for local development.
   */
  allowDevToken: z.boolean().default(false),
});

// ── Library roots ────────────────────────────────────────────────────────────
export const libraryRootsSchema = z
  .array(z.string())
  .min(1)
  .default(["."])
  .describe("Workspace / library directories the gateway may read from");

// ── Logging ──────────────────────────────────────────────────────────────────
export const loggingConfigSchema = z.object({
  level: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  /** Pretty-print for development (operator TTY). */
  pretty: z.boolean().default(false),
  /** Redact secrets automatically via pino serializers. */
  redactSecrets: z.boolean().default(true),
});

// ── Gateway runtime config ───────────────────────────────────────────────────
export const gatewayRuntimeSchema = z.object({
  /** Pi RPC JSONL socket path (Unix domain or TCP). Default: auto-discover in workspace. */
  piRpcSocket: z.string().optional(),
  /** Max runtime process restarts before giving up. */
  maxRuntimeRestarts: z.number().int().positive().default(3),
});

// ── Full config schema ───────────────────────────────────────────────────────
export const configSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z
    .number()
    .int()
    .refine((p) => p === 0 || (p >= 1024 && p <= 65535), {
      message: "Port must be 0 (ephemeral) or between 1024-65535",
    })
    .default(0),
  bindAddress: bindAddressSchema.optional(),
  /** Explicit secure configuration flag required for non-loopback bind. */
  allowNonLoopback: z.boolean().default(false),
  /** Explicit TLS configuration required for non-loopback bind. */
  tls: z
    .object({
      cert: z.string(),
      key: z.string(),
    })
    .optional(),
  token: tokenConfigSchema.default({}),
  allowedOrigins: allowedOriginsSchema,
  libraryRoots: libraryRootsSchema,
  logging: loggingConfigSchema.default({}),
  runtime: gatewayRuntimeSchema.default({}),
  /** Correlation-ID header name. */
  correlationIdHeader: z.string().default("x-correlation-id"),
});

export type Config = z.infer<typeof configSchema>;
export type TokenConfig = z.infer<typeof tokenConfigSchema>;
export type LoggingConfig = z.infer<typeof loggingConfigSchema>;
export type GatewayRuntimeConfig = z.infer<typeof gatewayRuntimeSchema>;

/**
 * Validate that the bind address is loopback unless explicit secure
 * configuration has been provided.
 */
export function resolveBindAddress(
  host: string,
  allowNonLoopback: boolean,
  tls?: { cert: string; key: string },
): { host: string; error?: string } {
  const effectiveHost = host || "127.0.0.1";

  if (isLoopback(effectiveHost)) {
    return { host: effectiveHost };
  }

  if (!allowNonLoopback) {
    return {
      host: effectiveHost,
      error:
        `SECURITY: Binding to ${effectiveHost} (non-loopback) is rejected. ` +
        `Set allowNonLoopback=true and provide TLS configuration to enable remote access.`,
    };
  }

  if (!tls) {
    return {
      host: effectiveHost,
      error:
        `SECURITY: Non-loopback bind to ${effectiveHost} requires TLS. ` +
        `Provide tls.cert and tls.key in configuration.`,
    };
  }

  return { host: effectiveHost };
}
