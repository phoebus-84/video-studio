import { describe, it, expect } from "vitest";
import { redactObject, redactHeaders, SENSITIVE_KEY_PATTERNS, REDACTED } from "../src/logging/index.js";

describe("Logging – Redaction", () => {
  describe("redactObject", () => {
    it("redacts fields matching sensitive patterns", () => {
      const input = {
        message: "hello",
        token: "secret-token-123",
        apiKey: "sk-abc123",
        nested: {
          authorization: "Bearer xyz",
          safe: "keep-me",
        },
      };
      const result = redactObject(input) as Record<string, unknown>;
      expect(result.token).toBe(REDACTED);
      expect(result.apiKey).toBe(REDACTED);
      expect(result.message).toBe("hello");
      expect(result.nested).toEqual({
        authorization: REDACTED,
        safe: "keep-me",
      });
    });

    it("redacts deeply nested secrets", () => {
      const input = {
        config: {
          providers: {
            openai: {
              apiKey: "sk-secret",
              secret: "prov-secret",
            },
          },
        },
      };
      const result = redactObject(input) as Record<string, unknown>;
      const config = result.config as Record<string, unknown>;
      const providers = config.providers as Record<string, unknown>;
      const openai = providers.openai as Record<string, unknown>;
      expect(openai.apiKey).toBe(REDACTED);
      expect(openai.secret).toBe(REDACTED);
    });

    it("returns primitives unchanged", () => {
      expect(redactObject(null)).toBeNull();
      expect(redactObject(undefined)).toBeUndefined();
      expect(redactObject(42)).toBe(42);
      expect(redactObject("hello")).toBe("hello");
      expect(redactObject(true)).toBe(true);
    });

    it("redacts arrays of objects", () => {
      const input = {
        items: [
          { name: "item1", token: "tok1" },
          { name: "item2", password: "pw2" },
        ],
      };
      const result = redactObject(input) as Record<string, unknown>;
      const items = result.items as Array<Record<string, unknown>>;
      expect(items[0]!.token).toBe(REDACTED);
      expect(items[0]!.name).toBe("item1");
      expect(items[1]!.password).toBe(REDACTED);
      expect(items[1]!.name).toBe("item2");
    });

    it("does not mutate the original object", () => {
      const input = { token: "secret", safe: "keep" };
      const result = redactObject(input) as Record<string, unknown>;
      expect(input.token).toBe("secret");
      expect(result.token).toBe(REDACTED);
    });

    it("has a depth limit to prevent infinite recursion", () => {
      const deep: Record<string, unknown> = { level: 0 };
      let current = deep;
      for (let i = 0; i < 20; i++) {
        current.nested = { token: `secret-${i}`, level: i + 1 };
        current = current.nested as Record<string, unknown>;
      }
      // Should not throw
      expect(() => redactObject(deep)).not.toThrow();
    });
  });

  describe("redactHeaders", () => {
    it("redacts Authorization header", () => {
      const headers = {
        authorization: "Bearer secret-token",
        "content-type": "application/json",
        "x-custom": "keep-me",
      };
      const result = redactHeaders(headers);
      expect(result.authorization).toBe(REDACTED);
      expect(result["content-type"]).toBe("application/json");
      expect(result["x-custom"]).toBe("keep-me");
    });

    it("redacts Cookie and Set-Cookie", () => {
      const headers = {
        cookie: "session=abc",
        "set-cookie": ["session=abc; HttpOnly"],
      };
      const result = redactHeaders(headers);
      expect(result.cookie).toBe(REDACTED);
      expect(result["set-cookie"]).toBe(REDACTED);
    });

    it("redacts x-api-key", () => {
      const headers = { "x-api-key": "my-api-key" };
      const result = redactHeaders(headers);
      expect(result["x-api-key"]).toBe(REDACTED);
    });

    it("is case-insensitive for Authorization", () => {
      const headers = { AUTHORIZATION: "Bearer xyz" };
      const result = redactHeaders(headers);
      expect(result.AUTHORIZATION).toBe(REDACTED);
    });
  });

  describe("SENSITIVE_KEY_PATTERNS", () => {
    it("covers common secret field names", () => {
      const testNames = [
        "token",
        "accessToken",
        "refresh_token",
        "secret",
        "clientSecret",
        "password",
        "authorization",
        "apiKey",
        "api_key",
        "access_key",
      ];
      for (const name of testNames) {
        expect(
          SENSITIVE_KEY_PATTERNS.some((p) => p.test(name)),
          `Pattern should match "${name}"`,
        ).toBe(true);
      }
    });

    it("does not flag benign fields", () => {
      const benign = ["name", "email", "message", "timestamp", "id", "url"];
      for (const name of benign) {
        expect(
          SENSITIVE_KEY_PATTERNS.some((p) => p.test(name)),
          `Pattern should NOT match "${name}"`,
        ).toBe(false);
      }
    });
  });
});
