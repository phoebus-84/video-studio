import { describe, it, expect } from "vitest";
import { GatewayError, ErrorCode } from "../src/errors/index.js";
import { registerErrorHandler } from "../src/errors/middleware.js";
import Fastify from "fastify";

describe("Errors", () => {
  describe("GatewayError", () => {
    it("assigns a correlationId when none is provided", () => {
      const err = new GatewayError({
        code: ErrorCode.INTERNAL,
        message: "test",
      });
      expect(err.correlationId).toBeTruthy();
      expect(err.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it("preserves a provided correlationId", () => {
      const err = new GatewayError({
        code: ErrorCode.PI_DISCONNECTED,
        message: "Pi gone",
        correlationId: "custom-correlation",
      });
      expect(err.correlationId).toBe("custom-correlation");
    });

    it("maps error codes to correct HTTP status codes", () => {
      expect(new GatewayError({ code: ErrorCode.UNAUTHORIZED, message: "" }).statusCode).toBe(401);
      expect(new GatewayError({ code: ErrorCode.NOT_FOUND, message: "" }).statusCode).toBe(404);
      expect(new GatewayError({ code: ErrorCode.VALIDATION, message: "" }).statusCode).toBe(400);
      expect(new GatewayError({ code: ErrorCode.BAD_REQUEST, message: "" }).statusCode).toBe(400);
      expect(new GatewayError({ code: ErrorCode.GATEWAY_NOT_READY, message: "" }).statusCode).toBe(503);
      expect(new GatewayError({ code: ErrorCode.RUNTIME_UNREACHABLE, message: "" }).statusCode).toBe(503);
      expect(new GatewayError({ code: ErrorCode.PI_DISCONNECTED, message: "" }).statusCode).toBe(503);
      expect(new GatewayError({ code: ErrorCode.ADAPTER_UNREACHABLE, message: "" }).statusCode).toBe(503);
      expect(new GatewayError({ code: ErrorCode.INTERNAL, message: "" }).statusCode).toBe(500);
      expect(new GatewayError({ code: ErrorCode.CONFIG_ERROR, message: "" }).statusCode).toBe(500);
    });

    it("serializes to a clean JSON envelope without secrets", () => {
      const err = new GatewayError({
        code: ErrorCode.VALIDATION,
        message: "Missing field: name",
        correlationId: "corr-1",
        details: { field: "name", constraint: "required" },
      });
      const json = err.toJSON();
      expect(json).toEqual({
        error: "VALIDATION",
        message: "Missing field: name",
        correlationId: "corr-1",
        details: { field: "name", constraint: "required" },
      });
      // No stack trace in the API response
      expect(json).not.toHaveProperty("stack");
    });
  });

  describe("registerErrorHandler", () => {
    it("handles GatewayError with proper structured response", async () => {
      const app = Fastify({ logger: false });
      registerErrorHandler(app);

      app.get("/test-gw-error", async () => {
        throw new GatewayError({
          code: ErrorCode.RUNTIME_UNREACHABLE,
          message: "Cannot reach runtime",
          correlationId: "corr-1",
        });
      });

      const response = await app.inject({ method: "GET", url: "/test-gw-error" });
      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("RUNTIME_UNREACHABLE");
      expect(body.message).toBe("Cannot reach runtime");
      expect(body.correlationId).toBe("corr-1");
    });

    it("wraps unknown errors as INTERNAL", async () => {
      const app = Fastify({ logger: false });
      registerErrorHandler(app);

      app.get("/test-unknown-error", async () => {
        throw new Error("Boom!");
      });

      const response = await app.inject({ method: "GET", url: "/test-unknown-error" });
      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("INTERNAL");
      expect(body.message).toBe("An unexpected internal error occurred.");
      // Must never leak internal error messages
      expect(body.message).not.toContain("Boom");
    });

    it("handles Fastify validation errors as VALIDATION", async () => {
      const app = Fastify({ logger: false });
      registerErrorHandler(app);

      app.post("/test-validation", {
        schema: {
          body: {
            type: "object",
            required: ["name"],
            properties: { name: { type: "string" } },
          },
        },
      }, async () => ({ ok: true }));

      const response = await app.inject({
        method: "POST",
        url: "/test-validation",
        payload: {},
      });
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("VALIDATION");
    });
  });
});
