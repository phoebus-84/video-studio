import { describe, it, expect, vi } from "vitest";
import { createLogger, redactRecord, redactHeaders } from "../src/logger.js";
import type { LogEntry } from "../src/logger.js";

describe("createLogger", () => {
  it("emits structured JSON entries", () => {
    const entries: LogEntry[] = [];
    const logger = createLogger((entry) => entries.push(entry));

    logger.info("test message", { key: "value" });

    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe("info");
    expect(entries[0].msg).toBe("test message");
    expect(entries[0].key).toBe("value");
    expect(entries[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("supports all log levels", () => {
    const entries: LogEntry[] = [];
    const logger = createLogger((entry) => entries.push(entry));

    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(entries.map((e) => e.level)).toEqual([
      "debug",
      "info",
      "warn",
      "error",
    ]);
  });
});

describe("redactRecord", () => {
  it("redacts authorization header value", () => {
    const result = redactRecord({ authorization: "Bearer secret-token" });
    expect(result.authorization).toBe("***REDACTED***");
  });

  it("redacts Authorization (case-insensitive)", () => {
    const result = redactRecord({ Authorization: "Key fal-abc123" });
    expect(result.Authorization).toBe("***REDACTED***");
  });

  it("redacts proxy-authorization", () => {
    const result = redactRecord({ "proxy-authorization": "Basic dXNlcjpwYXNz" });
    expect(result["proxy-authorization"]).toBe("***REDACTED***");
  });

  it("redacts x-api-key header", () => {
    const result = redactRecord({ "x-api-key": "sk-12345" });
    expect(result["x-api-key"]).toBe("***REDACTED***");
  });

  it("redacts cookie and set-cookie headers", () => {
    const result = redactRecord({
      cookie: "session=abc",
      "set-cookie": "session=abc; HttpOnly",
    });
    expect(result.cookie).toBe("***REDACTED***");
    expect(result["set-cookie"]).toBe("***REDACTED***");
  });

  it("redacts key-like fields", () => {
    const result = redactRecord({
      falKey: "fal-abc123xyzSecret!",
      apiKey: "sk-12345",
      secret: "s3cr3t",
      token: "jwt-token",
      password: "p@ssw0rd",
    });
    expect(result.falKey).toBe("***REDACTED***");
    // Other key-like fields get fully redacted
    expect(result.apiKey).toBe("***REDACTED***");
    expect(result.secret).toBe("***REDACTED***");
    expect(result.token).toBe("***REDACTED***");
    expect(result.password).toBe("***REDACTED***");
  });

  it("redacts secret field names regardless of casing or separator", () => {
    const result = redactRecord({
      FAL_KEY: "fal-uppercase-secret",
      API_KEY: "api-uppercase-secret",
      accessToken: "access-token-secret",
      client_secret: "client-secret",
      PRIVATE_KEY: "private-key-secret",
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("fal-uppercase-secret");
    expect(serialized).not.toContain("api-uppercase-secret");
    expect(serialized).not.toContain("access-token-secret");
    expect(serialized).not.toContain("client-secret");
    expect(serialized).not.toContain("private-key-secret");
    expect(result.API_KEY).toBe("***REDACTED***");
  });

  it("passes through safe fields unchanged", () => {
    const result = redactRecord({
      endpointId: "fal-ai/flux/dev",
      status: 200,
      count: 42,
    });
    expect(result.endpointId).toBe("fal-ai/flux/dev");
    expect(result.status).toBe(200);
    expect(result.count).toBe(42);
  });

  it("recurses into nested objects", () => {
    const result = redactRecord({
      request: {
        headers: { authorization: "Bearer abc" },
        body: { prompt: "hello" },
      },
    });
    const req = result.request as Record<string, unknown>;
    const headers = req.headers as Record<string, string>;
    const body = req.body as Record<string, unknown>;
    expect(headers.authorization).toBe("***REDACTED***");
    expect(body.prompt).toBe("hello");
  });

  it("recurses into arrays of objects", () => {
    const result = redactRecord({
      items: [
        { headers: { authorization: "a" } },
        { headers: { authorization: "b" } },
      ],
    });
    const items = result.items as Array<Record<string, unknown>>;
    expect(
      (items[0].headers as Record<string, string>).authorization,
    ).toBe("***REDACTED***");
    expect(
      (items[1].headers as Record<string, string>).authorization,
    ).toBe("***REDACTED***");
  });
});

describe("redactHeaders", () => {
  it("redacts a headers object", () => {
    const result = redactHeaders({
      "content-type": "application/json",
      authorization: "Key secret",
    });
    expect(result["content-type"]).toBe("application/json");
    expect(result.authorization).toBe("***REDACTED***");
  });
});

describe("log output safety", () => {
  it("logger never serializes authorization header values", () => {
    const entries: LogEntry[] = [];
    const logger = createLogger((entry) => entries.push(entry));

    logger.info("request", {
      headers: { authorization: "Bearer super-secret-token" },
      falKey: "fal-abc123xyzSecret!",
    });

    expect(entries).toHaveLength(1);
    const headers = entries[0].headers as Record<string, string>;
    expect(headers.authorization).toBe("***REDACTED***");
    expect(headers.authorization).not.toContain("super-secret-token");

    // FAL keys are fully redacted rather than partially fingerprinted.
    expect(entries[0].falKey).toBe("***REDACTED***");
  });

  it("logger with no extra fields still works", () => {
    const entries: LogEntry[] = [];
    const logger = createLogger((entry) => entries.push(entry));
    logger.error("bare error");
    expect(entries).toHaveLength(1);
    expect(entries[0].msg).toBe("bare error");
    expect(entries[0].level).toBe("error");
  });
});
