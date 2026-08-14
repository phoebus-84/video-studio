import { describe, it, expect } from "vitest";
import { resolveConfig, requireConfig, redactKey } from "../src/config.js";
import { FalUnavailableError } from "../src/errors.js";

describe("resolveConfig", () => {
  it("returns FalUnavailableError when FAL_KEY is not set", () => {
    const result = resolveConfig({});
    expect(result).toBeInstanceOf(FalUnavailableError);
    expect((result as FalUnavailableError).code).toBe("FAL_UNAVAILABLE");
    expect((result as FalUnavailableError).reason).toContain("FAL_KEY");
  });

  it("returns FalUnavailableError when FAL_KEY is empty string", () => {
    const result = resolveConfig({ FAL_KEY: "   " });
    expect(result).toBeInstanceOf(FalUnavailableError);
  });

  it("resolves config with a valid FAL_KEY", () => {
    const result = resolveConfig({ FAL_KEY: "fal-abc123secret" });
    expect(result).not.toBeInstanceOf(FalUnavailableError);
    if (!(result instanceof FalUnavailableError)) {
      expect(result.falKey).toBe("fal-abc123secret");
      expect(result.baseUrl).toBe("https://queue.fal.run");
      expect(result.defaultTimeoutMs).toBe(300_000);
      expect(result.maxRetries).toBe(3);
    }
  });

  it("respects FAL_BASE_URL override", () => {
    const result = resolveConfig({
      FAL_KEY: "key",
      FAL_BASE_URL: "https://custom.api.fal.run",
    });
    if (!(result instanceof FalUnavailableError)) {
      expect(result.baseUrl).toBe("https://custom.api.fal.run");
    }
  });

  it("respects FAL_DEFAULT_TIMEOUT_MS override", () => {
    const result = resolveConfig({
      FAL_KEY: "key",
      FAL_DEFAULT_TIMEOUT_MS: "60000",
    });
    if (!(result instanceof FalUnavailableError)) {
      expect(result.defaultTimeoutMs).toBe(60_000);
    }
  });

  it("ignores invalid FAL_DEFAULT_TIMEOUT_MS", () => {
    const result = resolveConfig({
      FAL_KEY: "key",
      FAL_DEFAULT_TIMEOUT_MS: "notanumber",
    });
    if (!(result instanceof FalUnavailableError)) {
      expect(result.defaultTimeoutMs).toBe(300_000);
    }
  });

  it("respects FAL_MAX_RETRIES override", () => {
    const result = resolveConfig({
      FAL_KEY: "key",
      FAL_MAX_RETRIES: "5",
    });
    if (!(result instanceof FalUnavailableError)) {
      expect(result.maxRetries).toBe(5);
    }
  });
});

describe("requireConfig", () => {
  it("throws FalUnavailableError when key is missing", () => {
    expect(() => requireConfig({})).toThrow(FalUnavailableError);
  });

  it("returns config when key is present", () => {
    const config = requireConfig({ FAL_KEY: "my-key" });
    expect(config.falKey).toBe("my-key");
  });
});

describe("redactKey", () => {
  it("redacts a normal-length key", () => {
    const redacted = redactKey("fal-abc123xyzSecret!");
    // first 4 + last 4: "fal-" + "ret!"  → "fal-fal-...ret!"
    expect(redacted).toBe("fal-fal-...ret!");
    expect(redacted).not.toContain("abc123xyzSecret");
  });

  it("returns placeholder for very short keys", () => {
    expect(redactKey("sh")).toBe("fal-****");
    expect(redactKey("12345678")).toBe("fal-****");
  });

  it("handles exactly 9 characters", () => {
    const r = redactKey("123456789");
    expect(r).toBe("fal-1234...6789");
  });
});
