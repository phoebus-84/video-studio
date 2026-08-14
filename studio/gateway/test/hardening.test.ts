// ---------------------------------------------------------------------------
// Auth hardening tests
// ---------------------------------------------------------------------------
// Tests: rate limiter, secure headers, CSRF origin validation,
// content-disposition sanitization, audit logger.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RateLimiter, validateOrigin, sanitizeDisposition, AuditLogger, registerSecureHeaders } from "../src/auth/hardening.js";
import Fastify from "fastify";

// ── Rate limiter ────────────────────────────────────────────────────────────

describe("RateLimiter", () => {
  it("allows requests within limit", () => {
    const rl = new RateLimiter(60_000, 5);
    for (let i = 0; i < 5; i++) {
      expect(rl.allow("127.0.0.1")).toBe(true);
    }
  });

  it("blocks requests over limit", () => {
    const rl = new RateLimiter(60_000, 3);
    rl.allow("127.0.0.1");
    rl.allow("127.0.0.1");
    rl.allow("127.0.0.1");
    expect(rl.allow("127.0.0.1")).toBe(false);
  });

  it("resets after window expires", () => {
    const rl = new RateLimiter(1, 2); // 1ms window
    rl.allow("127.0.0.1");
    rl.allow("127.0.0.1");
    expect(rl.allow("127.0.0.1")).toBe(false);
    // Wait for window to expire
    return new Promise((resolve) => {
      setTimeout(() => {
        expect(rl.allow("127.0.0.1")).toBe(true);
        resolve(undefined);
      }, 5);
    });
  });

  it("tracks remaining and retry-after", () => {
    const rl = new RateLimiter(60_000, 10);
    rl.allow("10.0.0.1");
    expect(rl.remaining("10.0.0.1")).toBe(9);
    expect(rl.retryAfter("unknown")).toBe(0);
  });

  it("stops cleanup interval", () => {
    const rl = new RateLimiter(60_000, 10);
    rl.stop();
  });
});

// ── Origin validation ───────────────────────────────────────────────────────

describe("validateOrigin", () => {
  const allowed = ["http://localhost:5199", "http://127.0.0.1:5199"];

  it("allows safe methods without origin check", () => {
    expect(validateOrigin(
      { method: "GET", headers: {} } as any,
      allowed,
    )).toBe(true);
    expect(validateOrigin(
      { method: "OPTIONS", headers: {} } as any,
      allowed,
    )).toBe(true);
  });

  it("allows matching origin on POST", () => {
    expect(validateOrigin(
      { method: "POST", headers: { origin: "http://localhost:5199" } } as any,
      allowed,
    )).toBe(true);
  });

  it("rejects mismatched origin on POST", () => {
    expect(validateOrigin(
      { method: "POST", headers: { origin: "https://evil.com" } } as any,
      allowed,
    )).toBe(false);
  });

  it("allows missing origin on POST (CLI clients)", () => {
    // Non-browser clients don't send Origin
    expect(validateOrigin(
      { method: "POST", headers: {} } as any,
      allowed,
    )).toBe(true);
  });

  it("wildcard allows all", () => {
    expect(validateOrigin(
      { method: "DELETE", headers: { origin: "https://anywhere.com" } } as any,
      ["*"],
    )).toBe(true);
  });
});

// ── Content-Disposition ────────────────────────────────────────────────────

describe("sanitizeDisposition", () => {
  it("uses inline for safe text types", () => {
    const header = sanitizeDisposition("text/markdown", "brief.md");
    expect(header).toContain("inline");
    expect(header).toContain("brief.md");
  });

  it("uses attachment for binary types", () => {
    const header = sanitizeDisposition("application/octet-stream", "data.bin");
    expect(header).toContain("attachment");
  });

  it("sanitizes dangerous characters in filename", () => {
    const header = sanitizeDisposition("text/plain", "../../etc/passwd");
    expect(header).not.toContain("/");
    expect(header).toContain("_");
  });

  it("handles unknown MIME types", () => {
    const header = sanitizeDisposition("application/x-unknown", "file.xyz");
    expect(header).toContain("attachment");
  });
});

// ── Audit logger ────────────────────────────────────────────────────────────

describe("AuditLogger", () => {
  it("logs and retrieves entries", () => {
    const logger = new AuditLogger(100);
    logger.log({
      timestamp: new Date().toISOString(),
      method: "GET", path: "/health", ip: "127.0.0.1",
      userAgent: "test", statusCode: 200, durationMs: 5,
      authProvided: false,
    });
    expect(logger.totalEntries).toBe(1);
    expect(logger.recent().length).toBe(1);
  });

  it("filters by status code", () => {
    const logger = new AuditLogger(100);
    logger.log({ timestamp: "", method: "GET", path: "/", ip: "", userAgent: "", statusCode: 200, durationMs: 0, authProvided: false });
    logger.log({ timestamp: "", method: "POST", path: "/", ip: "", userAgent: "", statusCode: 500, durationMs: 0, authProvided: false });
    logger.log({ timestamp: "", method: "GET", path: "/", ip: "", userAgent: "", statusCode: 404, durationMs: 0, authProvided: false });

    expect(logger.byStatus(200, 299).length).toBe(1);
    expect(logger.byStatus(400, 499).length).toBe(1);
    expect(logger.byStatus(500, 599).length).toBe(1);
  });

  it("enforces max entries", () => {
    const logger = new AuditLogger(5);
    for (let i = 0; i < 20; i++) {
      logger.log({ timestamp: "", method: "GET", path: `/api/${i}`, ip: "", userAgent: "", statusCode: 200, durationMs: 0, authProvided: false });
    }
    expect(logger.totalEntries).toBeLessThanOrEqual(10); // Truncated to half of max
  });

  it("clears all entries", () => {
    const logger = new AuditLogger(100);
    logger.log({ timestamp: "", method: "GET", path: "/", ip: "", userAgent: "", statusCode: 200, durationMs: 0, authProvided: false });
    logger.clear();
    expect(logger.totalEntries).toBe(0);
  });
});

// ── Secure headers ──────────────────────────────────────────────────────────

describe("secure headers", () => {
  it("adds secure headers to all responses", async () => {
    const app = Fastify();
    registerSecureHeaders(app);
    app.get("/test", async () => ({ ok: true }));

    const res = await app.inject({ method: "GET", url: "/test" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["x-xss-protection"]).toBe("1; mode=block");
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });
});
