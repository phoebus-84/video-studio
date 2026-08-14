import { describe, it, expect, beforeEach } from "vitest";
import { ConsoleLogger, NoopLogger } from "../../src/logging.js";
import { SpyLogger } from "../fixtures/index.js";

describe("Logger port", () => {
  describe("NoopLogger", () => {
    it("accepts all calls without error", () => {
      const logger = new NoopLogger();
      // No assertions needed – just prove no throw.
      logger.debug("dbg");
      logger.info("hi");
      logger.warn("oh");
      logger.error("ah");
    });
  });

  describe("ConsoleLogger", () => {
    it("creates with default minLevel", () => {
      const logger = new ConsoleLogger();
      logger.info("test");
    });

    it("respects minLevel filtering", () => {
      const logger = new ConsoleLogger({ minLevel: "warn" });
      logger.info("should not appear");
      logger.debug("also silent");
    });

    it("json mode produces parseable output", () => {
      const logger = new ConsoleLogger({ minLevel: "info", json: true });
      logger.info("json test", { k: "v" });
    });
  });

  describe("SpyLogger", () => {
    let spy: SpyLogger;

    beforeEach(() => {
      spy = new SpyLogger();
    });

    it("records level, message, and meta", () => {
      spy.info("hello", { episode: "ep1" });
      expect(spy.calls).toHaveLength(1);
      expect(spy.calls[0]!.level).toBe("info");
      expect(spy.calls[0]!.message).toBe("hello");
      expect(spy.calls[0]!.meta).toEqual({ episode: "ep1" });
    });

    it("records calls at each level", () => {
      spy.debug("d");
      spy.info("i");
      spy.warn("w");
      spy.error("e");
      expect(spy.calls).toHaveLength(4);
      expect(spy.calls.map((c) => c.level)).toEqual([
        "debug",
        "info",
        "warn",
        "error",
      ]);
    });

    it("ofLevel filters calls by level", () => {
      spy.info("i1");
      spy.warn("w");
      spy.info("i2");
      const infos = spy.ofLevel("info");
      expect(infos.map((c) => c.message)).toEqual(["i1", "i2"]);
    });

    it("clear empties recorded calls", () => {
      spy.info("x");
      spy.clear();
      expect(spy.calls).toHaveLength(0);
    });

    it("log() method works for custom levels", () => {
      spy.log("warn", "custom warn", { code: 1 });
      expect(spy.calls[0]!.level).toBe("warn");
      expect(spy.calls[0]!.meta).toEqual({ code: 1 });
    });
  });
});
