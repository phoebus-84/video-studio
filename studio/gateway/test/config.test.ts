import { describe, it, expect } from "vitest";
import { loadConfig, ConfigError } from "../src/config/index.js";
import { resolveBindAddress } from "../src/config/schema.js";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const TMP = resolve(".test-tmp");

function tmpFile(name: string): string {
  return resolve(TMP, name);
}

describe("Config", () => {
  afterEach(() => {
    // Clean up temp files
    if (existsSync(TMP)) {
      try { unlinkSync(tmpFile("valid.json")); } catch {}
      try { unlinkSync(tmpFile("invalid.json")); } catch {}
      try { unlinkSync(tmpFile("nonloopback.json")); } catch {}
      try { unlinkSync(tmpFile("nonloopback-notls.json")); } catch {}
      try { unlinkSync(tmpFile("empty.json")); } catch {}
    }
  });

  describe("loadConfig – defaults", () => {
    it("returns defaults when no file is provided", () => {
      const cfg = loadConfig();
      expect(cfg.host).toBe("127.0.0.1");
      expect(cfg.allowNonLoopback).toBe(false);
      expect(cfg.token.file).toBe(".gateway-token");
      expect(cfg.logging.level).toBe("info");
      expect(cfg.libraryRoots).toEqual(["."]);
    });
  });

  describe("loadConfig – file", () => {
    it("merges file config with defaults", () => {
      writeFileSync(
        tmpFile("valid.json"),
        JSON.stringify({ port: 9090, logging: { level: "debug" } }),
      );
      const cfg = loadConfig(tmpFile("valid.json"));
      expect(cfg.port).toBe(9090);
      expect(cfg.logging.level).toBe("debug");
      // Still has defaults for unspecified fields
      expect(cfg.host).toBe("127.0.0.1");
    });

    it("throws on invalid JSON", () => {
      writeFileSync(tmpFile("invalid.json"), "not json {{{");
      expect(() => loadConfig(tmpFile("invalid.json"))).toThrow(ConfigError);
    });

    it("throws on invalid fields", () => {
      writeFileSync(
        tmpFile("invalid.json"),
        JSON.stringify({ port: "abc" }),
      );
      expect(() => loadConfig(tmpFile("invalid.json"))).toThrow(ConfigError);
    });
  });

  describe("bind security", () => {
    it("allows loopback by default", () => {
      const resolved = resolveBindAddress("127.0.0.1", false);
      expect(resolved.error).toBeUndefined();
      expect(resolved.host).toBe("127.0.0.1");
    });

    it("allows ::1", () => {
      const resolved = resolveBindAddress("::1", false);
      expect(resolved.error).toBeUndefined();
      expect(resolved.host).toBe("::1");
    });

    it("allows localhost", () => {
      const resolved = resolveBindAddress("localhost", false);
      expect(resolved.error).toBeUndefined();
      expect(resolved.host).toBe("localhost");
    });

    it("rejects 0.0.0.0 without explicit secure config", () => {
      const resolved = resolveBindAddress("0.0.0.0", false);
      expect(resolved.error).toBeDefined();
      expect(resolved.error).toMatch(/non-loopback/i);
    });

    it("rejects 192.168.1.1 without explicit secure config", () => {
      const resolved = resolveBindAddress("192.168.1.1", false);
      expect(resolved.error).toBeDefined();
      expect(resolved.error).toMatch(/non-loopback/i);
    });

    it("rejects :: without explicit secure config", () => {
      const resolved = resolveBindAddress("::", false);
      expect(resolved.error).toBeDefined();
      expect(resolved.error).toMatch(/non-loopback/i);
    });

    it("rejects non-loopback with flag set but no TLS", () => {
      const resolved = resolveBindAddress("0.0.0.0", true);
      expect(resolved.error).toBeDefined();
      expect(resolved.error).toMatch(/TLS/i);
    });

    it("accepts non-loopback with flag and TLS", () => {
      const resolved = resolveBindAddress("0.0.0.0", true, {
        cert: "/path/to/cert.pem",
        key: "/path/to/key.pem",
      });
      expect(resolved.error).toBeUndefined();
      expect(resolved.host).toBe("0.0.0.0");
    });

    it("throws ConfigError when loadConfig gets non-loopback without flag", () => {
      writeFileSync(
        tmpFile("nonloopback.json"),
        JSON.stringify({ host: "0.0.0.0" }),
      );
      expect(() => loadConfig(tmpFile("nonloopback.json"))).toThrow(ConfigError);
    });

    it("throws ConfigError when loadConfig gets non-loopback with flag but no TLS", () => {
      writeFileSync(
        tmpFile("nonloopback-notls.json"),
        JSON.stringify({ host: "0.0.0.0", allowNonLoopback: true }),
      );
      expect(() => loadConfig(tmpFile("nonloopback-notls.json"))).toThrow(
        ConfigError,
      );
    });
  });
});
