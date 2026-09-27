/**
 * Gateway token injected at build time by vite.config.ts.
 *
 * Empty string when none is available, so the studio reports an unauthenticated
 * state rather than sending a token it knows the gateway will reject.
 */
declare const __GATEWAY_TOKEN__: string;

/**
 * Operator key injected at build time by vite.config.ts (avg-qr4.3).
 *
 * Empty string when none is available, in which case `credentialFor` falls
 * back to the agent token — the studio still works, and its approvals become
 * requests rather than silently claiming a credential it does not hold.
 */
declare const __OPERATOR_KEY__: string;
