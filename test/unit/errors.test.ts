import { describe, it, expect } from "vitest";
import {
  RuntimeError,
  ErrorCode,
  internalError,
  invalidArgument,
  notFound,
  permissionDenied,
  alreadyExists,
  timeoutError,
  cancelledError,
  leaseConflict,
  leaseExpired,
} from "../../src/errors.js";

describe("RuntimeError", () => {
  it("exposes code, message, and name", () => {
    const e = new RuntimeError(ErrorCode.INTERNAL, "something broke");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(RuntimeError);
    expect(e.name).toBe("RuntimeError");
    expect(e.code).toBe(ErrorCode.INTERNAL);
    expect(e.message).toBe("something broke");
  });

  it("carries optional cause", () => {
    const cause = new Error("root");
    const e = new RuntimeError(ErrorCode.INTERNAL, "wrap", { cause });
    expect(e.cause).toBe(cause);
  });

  it("carries optional details bag", () => {
    const details = { stageId: "s1", retry: 3 };
    const e = new RuntimeError(ErrorCode.LEASE_CONFLICT, "locked", {
      details,
    });
    expect(e.details).toEqual(details);
  });

  it("toJSON produces a plain object", () => {
    const e = new RuntimeError(ErrorCode.TIMEOUT, "timed out", {
      details: { ms: 5000 },
    });
    const json = e.toJSON();
    expect(json).toEqual({
      name: "RuntimeError",
      code: ErrorCode.TIMEOUT,
      message: "timed out",
      details: { ms: 5000 },
    });
  });
});

describe("Error factory functions", () => {
  it("internalError", () => {
    const cause = new Error("underlying");
    const e = internalError("oops", cause);
    expect(e.code).toBe(ErrorCode.INTERNAL);
    expect(e.message).toBe("oops");
    expect(e.cause).toBe(cause);
  });

  it("invalidArgument", () => {
    const e = invalidArgument("name required", { field: "name" });
    expect(e.code).toBe(ErrorCode.INVALID_ARGUMENT);
    expect(e.details).toEqual({ field: "name" });
  });

  it("notFound", () => {
    const e = notFound("workspace not initialised", { path: "/ws" });
    expect(e.code).toBe(ErrorCode.NOT_FOUND);
  });

  it("permissionDenied", () => {
    const e = permissionDenied("cannot write", { path: "/read-only" });
    expect(e.code).toBe(ErrorCode.PERMISSION_DENIED);
  });

  it("alreadyExists", () => {
    const e = alreadyExists("episode exists", { id: "ep-1" });
    expect(e.code).toBe(ErrorCode.ALREADY_EXISTS);
  });

  it("timeoutError", () => {
    const e = timeoutError("lease expired", { resource: "s1" });
    expect(e.code).toBe(ErrorCode.TIMEOUT);
  });

  it("cancelledError", () => {
    const e = cancelledError("user cancelled");
    expect(e.code).toBe(ErrorCode.CANCELLED);
  });

  it("leaseConflict", () => {
    const e = leaseConflict("already held", { resource: "stage-1" });
    expect(e.code).toBe(ErrorCode.LEASE_CONFLICT);
  });

  it("leaseExpired", () => {
    const e = leaseExpired("ttl exceeded", { resource: "stage-1" });
    expect(e.code).toBe(ErrorCode.LEASE_EXPIRED);
  });
});
