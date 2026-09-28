/**
 * Gateway token injected at build time by vite.config.ts.
 *
 * Empty string when none is available, so the studio reports an unauthenticated
 * state rather than sending a token it knows the gateway will reject.
 */
declare const __GATEWAY_TOKEN__: string;

