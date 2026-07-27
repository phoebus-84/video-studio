import type { FastifyInstance } from "fastify";
import type { LoggingConfig } from "../config/schema.js";

export { redactObject, redactHeaders, SENSITIVE_KEY_PATTERNS, SENSITIVE_HEADER_PATTERNS, REDACTED } from "./redact.js";

/**
 * Pino redact paths for log serialization.
 *
 * These are JSON dot-paths into the Fastify log object. Pino replaces
 * matching values with `[Redacted]` before writing the log line.
 *
 * IMPORTANT: redaction happens at log-serialization time, never on the
 * live request/response objects. The auth middleware always sees the
 * original Authorization header.
 */
export function getRedactPaths(): string[] {
  return [
    // Sensitive request headers
    "req.headers.authorization",
    "req.headers.cookie",
    'req.headers["set-cookie"]',
    'req.headers["x-api-key"]',
    // Sensitive body fields (prompts, tokens, secrets)
    "req.body.token",
    "req.body.secret",
    "req.body.password",
    "req.body.apiKey",
    "req.body.api_key",
    "req.body.credential",
    // Nested provider configs
    "req.body.providers.*.apiKey",
    "req.body.providers.*.secret",
    // Error object secrets
    "err.token",
    "err.secret",
    "err.password",
    "err.apiKey",
    "err.api_key",
    "err.authorization",
    "err.config.token",
    // Response leaks
    "res.headers.authorization",
    'res.headers["set-cookie"]',
  ];
}

/**
 * Configure Fastify logging with secret redaction.
 *
 * Primary redaction is done via pino's redact option at Fastify
 * construction time (see getRedactPaths). This function handles
 * additional runtime logging configuration.
 */
export function configureLogging(
  _app: FastifyInstance,
  _config: LoggingConfig,
): void {
  // Primary redaction is configured at Fastify construction time via
  // the `logger.redact` option. This function remains as a hook point
  // for future runtime logging configuration.
}
