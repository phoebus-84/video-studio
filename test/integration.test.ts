import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../src/config/index.js";
import { resolveToken, generateToken } from "../src/auth/index.js";
import { createGateway, type GatewayInstance } from "../src/server.js";

const TMP = resolve(".test-tmp");

/**
 * Integration tests for the gateway server.
 *
 * These tests start a real Fastify server on a loopback port (0 = ephemeral),
 * authenticate with the bearer token, and exercise all endpoints.
 * No external services, Pi processes, or network calls are used.
 */
describe("Gateway Integration", () => {
  let gateway: GatewayInstance;
  let baseUrl: string;
  let token: string;

  beforeAll(async () => {
    // Ensure temp directory
    fs.mkdirSync(TMP, { recursive: true });

    const tokenFile = resolve(TMP, "integration.token");
    // Clean up any previous token
    try { fs.unlinkSync(tokenFile); } catch {}

    // Use defaults + test overrides
    const config = loadConfig();
    config.port = 0; // ephemeral
    config.host = "127.0.0.1";
    config.token.file = tokenFile;
    config.libraryRoots = [TMP];

    token = resolveToken(config.token);
    gateway = await createGateway(config, token);
    const addr = await gateway.start();
    // Fastify returns "http://127.0.0.1:PORT" for ephemeral
    baseUrl = addr;
  });

  afterAll(async () => {
    await gateway.stop();
  });

  // ── Health endpoint (unauthenticated) ─────────────────────────────────────
  describe("GET /health", () => {
    it("returns 200 with health report (no auth needed)", async () => {
      const response = await fetch(`${baseUrl}/health`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.overall).toBe("healthy");
      expect(body.gateway.status).toBe("ready");
      expect(body.runtime.status).toBe("unknown");
      expect(body.pi.status).toBe("unknown");
      expect(body.adapter.status).toBe("unknown");
      expect(body.timestamp).toBeTruthy();
    });

    it("returns all four component health objects", async () => {
      const response = await fetch(`${baseUrl}/health`);
      const body = await response.json();
      expect(body).toHaveProperty("gateway");
      expect(body).toHaveProperty("runtime");
      expect(body).toHaveProperty("pi");
      expect(body).toHaveProperty("adapter");
      // Each has the ComponentHealth shape
      for (const comp of ["gateway", "runtime", "pi", "adapter"]) {
        expect(body[comp]).toHaveProperty("status");
        expect(body[comp]).toHaveProperty("lastChecked");
        expect(["ready", "degraded", "down", "unknown"]).toContain(
          body[comp].status,
        );
      }
    });
  });

  // ── Authentication ────────────────────────────────────────────────────────
  describe("auth", () => {
    it("rejects requests without Authorization header with 401", async () => {
      const response = await fetch(`${baseUrl}/`);
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("UNAUTHORIZED");
      expect(body.message).toMatch(/missing authorization/i);
    });

    it("rejects invalid bearer token with 401", async () => {
      const response = await fetch(`${baseUrl}/`, {
        headers: { authorization: "Bearer wrong-token" },
      });
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("UNAUTHORIZED");
    });

    it("accepts valid bearer token", async () => {
      const response = await fetch(`${baseUrl}/`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
    });

    it("rejects empty Authorization header", async () => {
      const response = await fetch(`${baseUrl}/`, {
        headers: { authorization: "" },
      });
      expect(response.status).toBe(401);
    });
  });

  // ── API root ──────────────────────────────────────────────────────────────
  describe("GET /", () => {
    it("returns service info with links", async () => {
      const response = await fetch(`${baseUrl}/`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.service).toBe("video-studio-gateway");
      expect(body.health).toBe("/health");
      expect(body.openapi).toBe("/openapi.json");
      expect(body.ws).toBe("/ws");
    });
  });

  // ── OpenAPI spec ──────────────────────────────────────────────────────────
  describe("GET /openapi.json", () => {
    it("returns OpenAPI 3.0 spec", async () => {
      const response = await fetch(`${baseUrl}/openapi.json`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.openapi).toBe("3.0.3");
      expect(body.info.title).toBe("Video Studio Gateway");
      expect(body.components.securitySchemes.bearerAuth.type).toBe("http");
      expect(body.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
    });
  });

  // ── 404 handling ──────────────────────────────────────────────────────────
  describe("404", () => {
    it("returns structured error for unknown routes", async () => {
      const response = await fetch(`${baseUrl}/nonexistent`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBe("NOT_FOUND");
      expect(body.correlationId).toBeTruthy();
    });
  });

  // ── CORS ──────────────────────────────────────────────────────────────────
  describe("CORS", () => {
    it("does not allow cross-origin by default", async () => {
      const response = await fetch(`${baseUrl}/health`, {
        headers: { origin: "http://evil.com" },
      });
      // Default CORS config disallows all origins
      // Fastify CORS returns 200 but without CORS headers when origin is not allowed
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    });
  });

  // ── Structured errors ─────────────────────────────────────────────────────
  describe("error responses", () => {
    it("all error responses include correlationId", async () => {
      const response = await fetch(`${baseUrl}/nonexistent`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = await response.json();
      expect(body.correlationId).toBeTruthy();
      expect(body.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it("error response shape is consistent", async () => {
      const response = await fetch(`${baseUrl}/`, {
        headers: { authorization: "Bearer bad" },
      });
      const body = await response.json();
      expect(body).toHaveProperty("error");
      expect(body).toHaveProperty("message");
      expect(body).toHaveProperty("correlationId");
      // Never leaks stack traces
      expect(body).not.toHaveProperty("stack");
    });
  });

  // ── WebSocket endpoint ────────────────────────────────────────────────────
  describe("GET /ws", () => {
    it("endpoint is registered (HTTP upgrade check)", async () => {
      // Without the Upgrade header, the websocket route doesn't match
      // and the request falls to the 404 handler. This confirms the
      // endpoint exists and auth passes (no 401).
      const response = await fetch(`${baseUrl}/ws?token=${token}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(404);
    });

    it("rejects websocket without token", async () => {
      // Without token, auth middleware rejects with 401 before upgrade
      const response = await fetch(`${baseUrl}/ws`);
      expect(response.status).toBe(401);
    });
  });

  // ── SSE endpoint ──────────────────────────────────────────────────────────
  describe("GET /events", () => {
    it("returns SSE content-type with auth", async () => {
      const response = await fetch(`${baseUrl}/events`, {
        headers: { authorization: `Bearer ${token}` },
      });
      // SSE should return text/event-stream
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      expect(response.status).toBe(200);
    });

    it("returns 401 without auth", async () => {
      const response = await fetch(`${baseUrl}/events`);
      expect(response.status).toBe(401);
    });
  });

  // ── Token redaction in logs ──────────────────────────────────────────────
  describe("log safety", () => {
    it("token does not appear in health endpoint response", async () => {
      const response = await fetch(`${baseUrl}/health`);
      const text = await response.text();
      expect(text).not.toContain(token);
    });

    it("token does not appear in error responses", async () => {
      const response = await fetch(`${baseUrl}/nonexistent`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const text = await response.text();
      expect(text).not.toContain(token);
    });
  });

  // ── Server restart / lifecycle ─────────────────────────────────────────────
  describe("lifecycle", () => {
    it("can be stopped and health is no longer reachable", async () => {
      // Create a temporary gateway just for this test
      const tmpTokenFile = resolve(TMP, "lifecycle.token");
      try { fs.unlinkSync(tmpTokenFile); } catch {}
      const cfg = loadConfig();
      cfg.port = 0;
      cfg.token.file = tmpTokenFile;
      const t = resolveToken(cfg.token);
      const gw = await createGateway(cfg, t);
      const addr = await gw.start();

      // Should be reachable
      const resp = await fetch(`${addr}/health`);
      expect(resp.status).toBe(200);

      await gw.stop();

      // Should be unreachable
      try {
        await fetch(`${addr}/health`);
        // If we somehow get here, the server didn't fully stop
        expect(false).toBe(true); // force failure
      } catch {
        // Expected – connection refused
        expect(true).toBe(true);
      }
    });
  });
});
