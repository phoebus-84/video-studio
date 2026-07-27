import { describe, it, expect } from "vitest";
import {
  ok,
  err,
  isOk,
  isErr,
  map,
  mapErr,
  andThen,
  unwrapOr,
  unwrap,
} from "../../src/result.js";
import { invalidArgument } from "../../src/errors.js";
import type { Result } from "../../src/result.js";

describe("Result constructors", () => {
  it("ok() creates a success value", () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    expect(r.value).toBe(42);
  });

  it("err() creates an error value", () => {
    const e = invalidArgument("bad");
    const r = err(e);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(e);
  });
});

describe("Result guards", () => {
  it("isOk returns true for ok", () => {
    expect(isOk(ok("x"))).toBe(true);
  });

  it("isOk returns false for err", () => {
    expect(isOk(err(invalidArgument("nope")))).toBe(false);
  });

  it("isErr returns true for err", () => {
    expect(isErr(err(invalidArgument("nope")))).toBe(true);
  });

  it("isErr returns false for ok", () => {
    expect(isErr(ok("x"))).toBe(false);
  });

  it("guards narrow the type", () => {
    const r: Result<number> = ok(10);
    if (isOk(r)) {
      const _x: number = r.value;
      expect(_x).toBe(10);
    } else {
      expect.fail("expected ok");
    }
  });
});

describe("Result combinators", () => {
  describe("map", () => {
    it("transforms ok values", () => {
      const r = map(ok(5), (n) => n * 2);
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        expect(r.value).toBe(10);
      }
    });

    it("passes through errors", () => {
      const e = invalidArgument("fail");
      const r = map(err(e), (n: number) => n * 2);
      expect(isErr(r)).toBe(true);
      if (isErr(r)) {
        expect(r.error).toBe(e);
      }
    });
  });

  describe("mapErr", () => {
    it("transforms error values", () => {
      const r = mapErr(err(new Error("old")), (e) => new Error(`wrapped: ${e.message}`));
      expect(isErr(r)).toBe(true);
      if (isErr(r)) {
        expect(r.error.message).toBe("wrapped: old");
      }
    });

    it("passes through ok values", () => {
      const r = mapErr(ok(42), (e: Error) => new Error(`wrapped: ${e.message}`));
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        expect(r.value).toBe(42);
      }
    });
  });

  describe("andThen", () => {
    it("chains success operations", () => {
      const r = andThen(ok(3), (n) => ok(n + 1));
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        expect(r.value).toBe(4);
      }
    });

    it("short-circuits on first error", () => {
      const e = invalidArgument("boom");
      const r = andThen(err(e), (n: unknown) => ok(n));
      expect(isErr(r)).toBe(true);
      if (isErr(r)) {
        expect(r.error).toBe(e);
      }
    });

    it("short-circuits on second error", () => {
      const e = invalidArgument("boom 2");
      const r = andThen(ok(1), () => err(e));
      expect(isErr(r)).toBe(true);
      if (isErr(r)) {
        expect(r.error).toBe(e);
      }
    });
  });

  describe("unwrapOr", () => {
    it("returns value on ok", () => {
      expect(unwrapOr(ok(7), 0)).toBe(7);
    });

    it("returns default on err", () => {
      expect(unwrapOr(err(invalidArgument("bad")), 0)).toBe(0);
    });
  });

  describe("unwrap", () => {
    it("returns value on ok", () => {
      expect(unwrap(ok("hello"))).toBe("hello");
    });

    it("throws on err", () => {
      expect(() => unwrap(err(invalidArgument("bad")))).toThrow(AggregateError);
    });
  });
});
