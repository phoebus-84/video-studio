import { describe, it, expect } from "vitest";
import {
  FalAdapterError,
  FalUnavailableError,
  FalHttpError,
  FalNetworkError,
  FalCancelledError,
  FalTimeoutError,
  FalContractError,
  FalDownloadError,
} from "../src/errors.js";

describe("FalAdapterError", () => {
  it("has machine-readable JSON envelope", () => {
    const err = new FalAdapterError("something went wrong", "TEST_CODE", true, {
      detail: 42,
    });
    const json = err.toJSON();
    expect(json).toEqual({
      name: "FalAdapterError",
      code: "TEST_CODE",
      message: "something went wrong",
      retryable: true,
      details: { detail: 42 },
    });
  });

  it("defaults retryable to false", () => {
    const err = new FalAdapterError("msg", "CODE");
    expect(err.retryable).toBe(false);
  });
});

describe("FalUnavailableError", () => {
  it("is not retryable", () => {
    const err = new FalUnavailableError("missing key");
    expect(err.retryable).toBe(false);
    expect(err.reason).toBe("missing key");
  });

  it("contains reason in details", () => {
    const err = new FalUnavailableError("config not found");
    expect(err.toJSON().details).toEqual({ reason: "config not found" });
  });
});

describe("FalHttpError", () => {
  it("captures status and truncated body", () => {
    const err = new FalHttpError(429, "rate limited", true);
    expect(err.status).toBe(429);
    expect(err.responseBody).toBe("rate limited");
    expect(err.retryable).toBe(true);
  });

  it("truncates long response bodies", () => {
    const body = "x".repeat(1000);
    const err = new FalHttpError(500, body);
    expect(err.message.length).toBeLessThan(body.length + 50);
    expect(err.responseBody).toBe(body); // full body still accessible
  });
});

describe("FalNetworkError", () => {
  it("is retryable", () => {
    const err = new FalNetworkError("ECONNREFUSED");
    expect(err.retryable).toBe(true);
    expect(err.cause).toBe("ECONNREFUSED");
  });
});

describe("FalCancelledError", () => {
  it("is not retryable", () => {
    const err = new FalCancelledError();
    expect(err.retryable).toBe(false);
  });
});

describe("FalTimeoutError", () => {
  it("is retryable and captures timeoutMs", () => {
    const err = new FalTimeoutError(5000, "poll");
    expect(err.retryable).toBe(true);
    expect(err.timeoutMs).toBe(5000);
  });
});

describe("FalContractError", () => {
  it("captures field and type mismatch", () => {
    const err = new FalContractError("request_id", "string", "number");
    expect(err.retryable).toBe(false);
    expect(err.toJSON().details).toEqual({
      field: "request_id",
      expected: "string",
      received: "number",
    });
  });
});

describe("FalDownloadError", () => {
  it("is retryable by default", () => {
    const err = new FalDownloadError("http://example.com/file", "connection reset");
    expect(err.retryable).toBe(true);
  });

  it("can be non-retryable for hash mismatches", () => {
    const err = new FalDownloadError("http://example.com/file", "hash mismatch", false);
    expect(err.retryable).toBe(false);
  });
});
