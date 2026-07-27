import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveToken, generateToken, TokenError } from "../src/auth/token.js";
import { writeFileSync, unlinkSync, existsSync, chmodSync, mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const TMP_DIR = resolve(".test-tmp");
const TOKEN_FILE = resolve(TMP_DIR, "test.token");

describe("Auth – Token", () => {
  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true });
  });

  afterEach(() => {
    try { unlinkSync(TOKEN_FILE); } catch {}
  });

  describe("generateToken", () => {
    it("produces a base64url string of correct length", () => {
      const token = generateToken();
      // 32 random bytes → 43 base64url chars (no padding)
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThanOrEqual(42);
      expect(token.length).toBeLessThanOrEqual(44);
      // Base64url alphabet only
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("produces unique tokens on each call", () => {
      const t1 = generateToken();
      const t2 = generateToken();
      const t3 = generateToken();
      expect(t1).not.toBe(t2);
      expect(t2).not.toBe(t3);
      expect(t1).not.toBe(t3);
    });
  });

  describe("resolveToken", () => {
    it("returns preShared token when provided, does not create file", () => {
      const token = resolveToken({
        file: TOKEN_FILE,
        preShared: "my-pre-shared-token",
      });
      expect(token).toBe("my-pre-shared-token");
      expect(existsSync(TOKEN_FILE)).toBe(false);
    });

    it("generates a new token when file does not exist", () => {
      const token = resolveToken({ file: TOKEN_FILE });
      expect(token).toBeTruthy();
      expect(existsSync(TOKEN_FILE)).toBe(true);
    });

    it("reads existing token from file", () => {
      writeFileSync(TOKEN_FILE, "existing-token", { mode: 0o600 });
      const token = resolveToken({ file: TOKEN_FILE });
      expect(token).toBe("existing-token");
    });

    it("throws TokenError when file is empty", () => {
      writeFileSync(TOKEN_FILE, "", { mode: 0o600 });
      expect(() => resolveToken({ file: TOKEN_FILE })).toThrow(TokenError);
    });

    it("generated token is stored with 0o600 permissions", () => {
      const token = resolveToken({ file: TOKEN_FILE });
      const stat = statSync(TOKEN_FILE);
      // 0o600 perms – stat.mode includes file type bits
      const perms = stat.mode & 0o777;
      expect(perms).toBe(0o600);
    });
  });
});
