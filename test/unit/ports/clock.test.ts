import { describe, it, expect } from "vitest";
import { SystemClock } from "../../../src/ports/clock.js";
import { FakeClock } from "../../fixtures/index.js";

describe("Clock port", () => {
  describe("SystemClock", () => {
    it("now() returns a Date close to current time", () => {
      const clock = new SystemClock();
      const before = Date.now();
      const d = clock.now();
      const after = Date.now();
      expect(d.getTime()).toBeGreaterThanOrEqual(before);
      expect(d.getTime()).toBeLessThanOrEqual(after);
    });

    it("nowMs() returns a number", () => {
      const clock = new SystemClock();
      expect(typeof clock.nowMs()).toBe("number");
      expect(clock.nowMs()).toBeGreaterThan(1_700_000_000_000);
    });

    it("sleep() resolves", async () => {
      const clock = new SystemClock();
      const start = clock.nowMs();
      await clock.sleep(50);
      expect(clock.nowMs() - start).toBeGreaterThanOrEqual(45);
    });
  });

  describe("FakeClock", () => {
    it("starts at the given time", () => {
      const clock = new FakeClock(
        new Date("2025-01-01T00:00:00Z").getTime(),
      );
      expect(clock.now().toISOString()).toBe("2025-01-01T00:00:00.000Z");
    });

    it("defaults to 2024-01-01", () => {
      const clock = new FakeClock();
      expect(clock.now().toISOString()).toBe("2024-01-01T00:00:00.000Z");
    });

    it("advance() moves time forward", () => {
      const clock = new FakeClock();
      clock.advance(3600_000); // 1 hour
      expect(clock.now().toISOString()).toBe("2024-01-01T01:00:00.000Z");
    });

    it("set() sets absolute time", () => {
      const clock = new FakeClock();
      clock.set(new Date("2025-06-15T12:00:00Z").getTime());
      expect(clock.now().toISOString()).toBe("2025-06-15T12:00:00.000Z");
    });

    it("sleep() advances time without real wait", async () => {
      const clock = new FakeClock();
      const before = clock.nowMs();
      const startReal = Date.now();
      await clock.sleep(5000);
      const realElapsed = Date.now() - startReal;
      expect(clock.nowMs() - before).toBe(5000);
      expect(realElapsed).toBeLessThan(50); // deterministic
    });
  });
});
