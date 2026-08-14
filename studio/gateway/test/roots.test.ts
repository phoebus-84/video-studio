import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalizeRoots, isWithinRoots, assertWithinRoots } from "../src/lib/roots.js";
import { GatewayError } from "../src/errors/index.js";

const TMP = resolve(".test-tmp");
const ROOT_A = resolve(TMP, "lib-a");
const ROOT_B = resolve(TMP, "lib-b");

describe("Library Roots", () => {
  beforeAll(() => {
    mkdirSync(ROOT_A, { recursive: true });
    mkdirSync(ROOT_B, { recursive: true });
    writeFileSync(resolve(ROOT_A, "file.txt"), "content");
    writeFileSync(resolve(ROOT_B, "file.txt"), "content");
  });

  afterAll(() => {
    try { unlinkSync(resolve(ROOT_A, "file.txt")); } catch {}
    try { unlinkSync(resolve(ROOT_B, "file.txt")); } catch {}
    try { rmdirSync(ROOT_A); } catch {}
    try { rmdirSync(ROOT_B); } catch {}
  });

  describe("canonicalizeRoots", () => {
    it("resolves relative paths to absolute real paths", () => {
      const roots = canonicalizeRoots([TMP]);
      expect(roots).toHaveLength(1);
      expect(roots[0]).toBe(resolve(TMP));
    });

    it("throws on non-existent root", () => {
      expect(() => canonicalizeRoots(["/nonexistent/path/xyz"])).toThrow(
        GatewayError,
      );
    });
  });

  describe("isWithinRoots", () => {
    it("returns true for a path inside an allowed root", () => {
      expect(isWithinRoots(resolve(ROOT_A, "file.txt"), [ROOT_A])).toBe(true);
    });

    it("returns true for the root directory itself", () => {
      expect(isWithinRoots(ROOT_A, [ROOT_A])).toBe(true);
    });

    it("returns false for a path outside allowed roots", () => {
      expect(isWithinRoots("/etc/passwd", [ROOT_A, ROOT_B])).toBe(false);
    });

    it("returns false for a sibling directory not in roots", () => {
      // /tmp is outside TMP
      expect(isWithinRoots("/tmp", [ROOT_A])).toBe(false);
    });

    it("returns false for a parent directory", () => {
      expect(isWithinRoots(resolve(TMP, ".."), [ROOT_A])).toBe(false);
    });

    it("returns false for a non-existent path", () => {
      expect(isWithinRoots(resolve(ROOT_A, "nonexistent.txt"), [ROOT_A])).toBe(
        false,
      );
    });

    it("does not falsely match prefix directory names", () => {
      // /workspace-foo should not match /workspace
      const root = resolve(TMP, "workspace");
      const sibling = resolve(TMP, "workspace-foo");
      mkdirSync(root, { recursive: true });
      mkdirSync(sibling, { recursive: true });
      try {
        expect(isWithinRoots(sibling, [root])).toBe(false);
      } finally {
        try { rmdirSync(root); } catch {}
        try { rmdirSync(sibling); } catch {}
      }
    });
  });

  describe("assertWithinRoots", () => {
    it("does not throw for paths inside roots", () => {
      expect(() =>
        assertWithinRoots(resolve(ROOT_A, "file.txt"), [ROOT_A]),
      ).not.toThrow();
    });

    it("throws GatewayError for paths outside roots", () => {
      expect(() => assertWithinRoots("/etc/passwd", [ROOT_A])).toThrow(
        GatewayError,
      );
    });

    it("the thrown error has code BAD_REQUEST", () => {
      try {
        assertWithinRoots("/etc/passwd", [ROOT_A]);
      } catch (err) {
        expect(err).toBeInstanceOf(GatewayError);
        expect((err as GatewayError).code).toBe("BAD_REQUEST");
        expect((err as GatewayError).statusCode).toBe(400);
      }
    });
  });
});
