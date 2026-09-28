import type { Config } from "./schema.js";

/**
 * Secure defaults for the gateway.
 *
 * Every default is chosen for the loopback-only, token-authenticated,
 * single-developer scenario. Broadening access requires explicit opt-in.
 */
export const DEFAULTS: Partial<Config> & { host: string } = {
  host: "127.0.0.1",
  port: 0, // OS-assigned ephemeral port
  allowNonLoopback: false,
  token: {
    file: ".gateway-token",
    // ADR-0030: real authentication by default.
    allowDevToken: false,
  },
  // The operator's credential (avg-qr4.3), generated next to the token.
  // Whoever can read this file is the operator; Pi is never given it.
  operatorKey: {
    file: ".operator-key",
  },
  allowedOrigins: ["http://localhost:5199"],
  libraryRoots: ["."],
  logging: {
    level: "info",
    pretty: false,
    redactSecrets: true,
  },
  runtime: {
    maxRuntimeRestarts: 3,
  },
  correlationIdHeader: "x-correlation-id",
};
