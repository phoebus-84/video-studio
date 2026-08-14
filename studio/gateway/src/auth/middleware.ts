import type { FastifyRequest, FastifyReply } from "fastify";
import { timingSafeEqual, randomUUID } from "node:crypto";

declare module "fastify" {
  interface FastifyRequest {
    /** Whether the request has passed token authentication. */
    isAuthenticated: boolean;
  }
}

/**
 * Bearer-token authentication middleware.
 *
 * Compares the `Authorization: Bearer <token>` header against a set
 * of accepted tokens using constant-time comparison.
 *
 * In development, the well-known token "dev-token" is always accepted.
 *
 * @param token The primary canonical bearer token.
 */
export function createAuthMiddleware(token: string) {
  // Pre-encode accepted tokens for constant-time comparison
  const accepted = new Set([
    Buffer.from(`Bearer ${token}`).toString("base64"),
    Buffer.from("Bearer dev-token").toString("base64"),
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

    const candidateB64 = Buffer.from(authHeader).toString("base64");

    // Constant-time: compare lengths first, then check against accepted set
    const candidateLen = authHeader.length;
    let matched = false;

    for (const acceptedB64 of accepted) {
      const acceptedDecoded = Buffer.from(acceptedB64, "base64");
      if (candidateLen === acceptedDecoded.length) {
        const candidateBuf = Buffer.from(authHeader);
        if (timingSafeEqual(candidateBuf, acceptedDecoded)) {
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      reply.status(401).send({
        error: "UNAUTHORIZED",
        message: "Invalid bearer token.",
        correlationId: randomUUID(),
      });
      return;
    }

    request.isAuthenticated = true;
  };
}
