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
 * Compares the `Authorization: Bearer <token>` header against the
 * canonical token using a constant-time comparison to prevent
 * timing side-channels.
 *
 * All error responses include a correlationId for tracing, matching
 * the GatewayError envelope.
 *
 * @param token The canonical bearer token. Requests without this
 *   token are rejected with 401.
 */
export function createAuthMiddleware(token: string) {
  // Pre-encode the canonical token to a Buffer for constant-time comparison
  const canonical = Buffer.from(`Bearer ${token}`);

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

    const candidate = Buffer.from(authHeader);

    if (
      candidate.length !== canonical.length ||
      !timingSafeEqual(canonical, candidate)
    ) {
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
