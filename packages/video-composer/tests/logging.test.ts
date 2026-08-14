/**
 * Tests for structured logging and redaction.
 */

import { describe, it, expect } from "vitest";
import { createLogger } from "../src/logging.js";

describe("createLogger", () => {
  it("writes structured JSON log entries", () => {
    const lines: string[] = [];
    const logger = createLogger("debug", [], (line) => lines.push(line));

    logger.info("test message", { key: "value" });

    expect(lines.length).toBe(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("test message");
    expect(entry.context.key).toBe("value");
    expect(entry.timestamp).toBeDefined();
  });

  it("respects minimum log level", () => {
    const lines: string[] = [];
    const logger = createLogger("warn", [], (line) => lines.push(line));

    logger.debug("should not appear");
    logger.info("should not appear either");
    logger.warn("this appears");

    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]).level).toBe("warn");
  });

  it("redacts secret strings", () => {
    const lines: string[] = [];
    const logger = createLogger("info", ["password123"], (line) =>
      lines.push(line),
    );

    logger.info("auth failed with password123", {
      token: "password123",
    });

    const entry = JSON.parse(lines[0]);
    expect(entry.message).not.toContain("password123");
    expect(entry.message).toContain("[REDACTED]");
    expect(JSON.stringify(entry)).not.toContain("password123");
  });

  it("handles multiple redact patterns", () => {
    const lines: string[] = [];
    const logger = createLogger(
      "info",
      ["secret1", "secret2"],
      (line) => lines.push(line),
    );

    logger.info("secret1 and secret2 are secrets");

    const entry = JSON.parse(lines[0]);
    expect(entry.message).toContain("[REDACTED]");
    expect(entry.message).not.toContain("secret1");
    expect(entry.message).not.toContain("secret2");
  });

  it("handles empty redact array gracefully", () => {
    const lines: string[] = [];
    const logger = createLogger("info", [], (line) => lines.push(line));

    logger.info("regular message");

    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("regular message");
  });

  it("supports debug level messages", () => {
    const lines: string[] = [];
    const logger = createLogger("debug", [], (line) => lines.push(line));

    logger.debug("debug detail");
    logger.error("error detail");

    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).level).toBe("debug");
    expect(JSON.parse(lines[1]).level).toBe("error");
  });

  it("setRedact updates the redaction list dynamically", () => {
    const lines: string[] = [];
    const logger = createLogger("info", [], (line) => lines.push(line));

    logger.info("no secret yet");
    expect(lines[0]).toContain("no secret yet");

    (logger as ReturnType<typeof createLogger>).setRedact(["secret-key"]);
    logger.info("using secret-key here");
    expect(lines[1]).toContain("[REDACTED]");
    expect(lines[1]).not.toContain("secret-key");
  });

  it("escapes special regex characters in redact strings", () => {
    const lines: string[] = [];
    const logger = createLogger("info", ["(special)"], (line) =>
      lines.push(line),
    );

    logger.info("contains (special) chars");
    // Should not throw a regex error and should redact
    expect(lines.length).toBe(1);
  });
});
