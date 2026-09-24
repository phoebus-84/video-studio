import type { FastifyRequest, FastifyReply } from "fastify";
import { timingSafeEqual, randomUUID } from "node:crypto";

declare module "fastify" {
  interface FastifyRequest {
    /** Whether the request has passed token authentication. */
    isAuthenticated: boolean;
    /**
     * Which credential authenticated this request (avg-qr4.3). The browser
     * and CLI hold the operator key; Pi holds the agent token. Only a review
     * decision and an attended claim look at the difference.
     */
    principal: "operator" | "agent";
  }
}

/**
 * Bearer-token authentication middleware.
 *
 * Compares the `Authorization: Bearer <token>` header against the accepted
 * credentials using constant-time comparison, and records which one matched
 * as `request.principal` (avg-qr4.3): the operator key means `"operator"`,
 * the gateway token — and, if enabled, "dev-token" — means `"agent"`.
 *
 * The well-known "dev-token" is accepted only when `allowDevToken` is true.
 * Per ADR-0030 that defaults to false, so the ordinary path exercises real
 * authentication. It was previously accepted unconditionally, which meant any
 * caller sending `Bearer dev-token` authenticated against a production
 * gateway. It is never treated as the operator: a convenience for local
 * development must not be able to sign a review — that would let anyone who
 * enabled it grant approvals as a human who was never asked (avg-qr4.3).
 *
 * @param token         The primary canonical bearer token (the agent's).
 * @param operatorKey   The operator's credential. Must differ from `token`,
 *                       or the two principals would be indistinguishable.
 * @param allowDevToken Whether to additionally accept "dev-token", as agent.
 */
export function createAuthMiddleware(token: string, operatorKey: string, allowDevToken = false) {
  // A shared secret authenticates two different principals only because the
  // gateway looks the presented value up in a map. If the two credentials
  // were equal, both entries would match on the same comparison and there
  // would be no way to tell an operator's request from an agent's — the
  // exact distinction this middleware exists to make (avg-qr4.3).
  if (token === operatorKey) {
    throw new Error(
      "The operator key and the gateway token must be distinct, or the two principals are indistinguishable",
    );
  }

  const accepted = new Map<string, "operator" | "agent">([
    [`Bearer ${operatorKey}`, "operator"],
    [`Bearer ${token}`, "agent"],
    // dev-token is a convenience for local development, never a person.
    ...(allowDevToken ? ([[`Bearer dev-token`, "agent"] as const] as const) : []),
  ]);

  return async function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      reply.status(401).send({
        error: "UNAUTHORIZED",
        message:
          "Missing Authorization header. Provide a Bearer token from the gateway token file.",
        correlationId: randomUUID(),
      });
      return;
    }

    let principal: "operator" | "agent" | undefined;
    const candidate = Buffer.from(authHeader);
    for (const [expected, who] of accepted) {
      const buf = Buffer.from(expected);
      // Keep scanning after a match rather than returning early: stopping at
      // the first hit would make the loop's duration depend on which
      // credential matched, which leaks which one it was to a timing
      // observer just as surely as an unequal-length short-circuit would.
      if (buf.length === candidate.length && timingSafeEqual(buf, candidate)) principal = who;
    }

    if (!principal) {
      reply.status(401).send({
        error: "UNAUTHORIZED",
        message: "Invalid bearer token.",
        correlationId: randomUUID(),
      });
      return;
    }

    request.isAuthenticated = true;
    request.principal = principal;
  };
}
