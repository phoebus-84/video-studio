import type { FastifyInstance } from "fastify";
import { GatewayError, ErrorCode } from "./index.js";

/**
 * Register global error handler on the Fastify instance.
 *
 * - GatewayErrors are serialized to the structured envelope.
 * - Unknown errors are wrapped and logged; the client sees a generic
 *   INTERNAL error to avoid leaking internals.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    // Fastify validation errors
    if (error.validation) {
      const gwErr = new GatewayError({
        code: ErrorCode.VALIDATION,
        message: error.message,
        details: { validation: error.validation },
      });
      return reply.status(gwErr.statusCode).send(gwErr.toJSON());
    }

    if (error instanceof GatewayError) {
      return reply.status(error.statusCode).send(error.toJSON());
    }

    // Unknown error – log and return generic
    const correlationId =
      (request.headers["x-correlation-id"] as string) ?? undefined;

    request.log.error({ err: error, correlationId }, "Unhandled error");

    const gwErr = new GatewayError({
      code: ErrorCode.INTERNAL,
      message: "An unexpected internal error occurred.",
      correlationId,
    });

    return reply.status(gwErr.statusCode).send(gwErr.toJSON());
  });
}
