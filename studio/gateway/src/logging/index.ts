import type { FastifyInstance, FastifyRequest } from "fastify";
import type { LoggingConfig } from "../config/schema.js";

export { redactObject, redactHeaders, SENSITIVE_KEY_PATTERNS, SENSITIVE_HEADER_PATTERNS, REDACTED } from "./redact.js";
import { REDACTED } from "./redact.js";

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
 * A URL with the value of every `token` query parameter replaced.
 *
 * avg-qr4.3 final review, I2: the studio opens `/ws?token=<operator key>`,
 * because a browser WebSocket cannot send an Authorization header, and
 * Fastify logs `req.url` on every request. Pino's redact paths address
 * fields, not substrings of a URL, so the signing key reached the log.
 */
export function redactUrl(url: string): string {
  return url.replace(/([?&]token=)[^&#]*/gi, `$1${REDACTED}`);
}

/**
 * The gateway's logger options. One function, so the server and the test
 * that pins what reaches the log are looking at the same configuration.
 *
 * The request serializer is Fastify 4's own (lib/logger.js) with the URL
 * passed through `redactUrl`. It applies whether or not `redactSecrets` is
 * set: that flag governs body and header fields; a credential in a URL is
 * never something a person wants in a log.
 */
export function gatewayLoggerOptions(config: LoggingConfig) {
  return {
    level: config.level,
    ...(config.redactSecrets ? { redact: getRedactPaths() } : {}),
    serializers: {
      req(req: FastifyRequest) {
        return {
          method: req.method,
          url: redactUrl(req.url),
          version: ((v) => (Array.isArray(v) ? v[0] : v))(req.headers?.["accept-version"]),
          hostname: req.hostname,
          remoteAddress: req.ip,
          remotePort: req.socket ? req.socket.remotePort : undefined,
        };
      },
    },
    transport: config.pretty
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
  };
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
