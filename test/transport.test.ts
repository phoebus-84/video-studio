import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FetchTransport } from "../src/transport.js";
import { MockServer } from "./fixtures/mock-server.js";
import { FalHttpError, FalNetworkError, FalCancelledError } from "../src/errors.js";

describe("FetchTransport", () => {
  const transport = new FetchTransport();
  let server: MockServer;

  beforeAll(async () => {
    server = new MockServer();
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("returns a successful response", async () => {
    server.reset();
    server.expect("POST", "/test/ok", 200, { result: "success" });

    const resp = await transport.request({
      method: "POST",
      url: `${server.url}/test/ok`,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "hello" }),
    });

    expect(resp.status).toBe(200);
    expect(JSON.parse(resp.body)).toEqual({ result: "success" });
  });

  it("throws FalHttpError on non-2xx response", async () => {
    server.reset();
    server.expect("GET", "/test/not-found", 404, { error: "not found" });

    await expect(
      transport.request({
        method: "GET",
        url: `${server.url}/test/not-found`,
        headers: {},
      }),
    ).rejects.toThrow(FalHttpError);
  });

  it("marks 429 as retryable", async () => {
    server.reset();
    server.expect("POST", "/test/ratelimit", 429, { error: "too many requests" });

    try {
      await transport.request({
        method: "POST",
        url: `${server.url}/test/ratelimit`,
        headers: {},
      });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(FalHttpError);
      expect((err as FalHttpError).retryable).toBe(true);
      expect((err as FalHttpError).status).toBe(429);
    }
  });

  it("marks 502/503/504 as retryable", async () => {
    server.reset();
    server.expect("GET", "/test/bad-gateway", 502, {});

    try {
      await transport.request({
        method: "GET",
        url: `${server.url}/test/bad-gateway`,
        headers: {},
      });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(FalHttpError);
      expect((err as FalHttpError).retryable).toBe(true);
    }
  });

  it("marks 400 as non-retryable", async () => {
    server.reset();
    server.expect("POST", "/test/bad-request", 400, { error: "invalid" });

    try {
      await transport.request({
        method: "POST",
        url: `${server.url}/test/bad-request`,
        headers: {},
      });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(FalHttpError);
      expect((err as FalHttpError).retryable).toBe(false);
    }
  });

  it("throws FalNetworkError when connection refused", async () => {
    // Use a port that nothing is listening on
    await expect(
      transport.request({
        method: "GET",
        url: "http://127.0.0.1:1/nothing",
        headers: {},
      }),
    ).rejects.toThrow(FalNetworkError);
  });

  it("throws FalCancelledError when signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();

    await expect(
      transport.request(
        {
          method: "GET",
          url: `${server.url}/test/ok`,
          headers: {},
        },
        ac.signal,
      ),
    ).rejects.toThrow(FalCancelledError);
  });

  it("passes through response headers", async () => {
    server.reset();
    server.expect("GET", "/test/headers", 200, { ok: true }, {
      headers: { "x-request-id": "abc-123" },
    });

    const resp = await transport.request({
      method: "GET",
      url: `${server.url}/test/headers`,
      headers: {},
    });

    expect(resp.headers["x-request-id"]).toBe("abc-123");
  });
});
