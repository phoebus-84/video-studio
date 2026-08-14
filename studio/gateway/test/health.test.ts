import { describe, it, expect } from "vitest";
import {
  collectHealth,
  gatewayHealth,
  unknownHealth,
} from "../src/health/index.js";
import type { ComponentHealth, HealthReport } from "../src/health/index.js";

describe("Health", () => {
  describe("gatewayHealth", () => {
    it("always returns ready", () => {
      const h = gatewayHealth();
      expect(h.status).toBe("ready");
      expect(h.lastChecked).toBeTruthy();
    });
  });

  describe("unknownHealth", () => {
    it("returns unknown status with detail", () => {
      const h = unknownHealth("Not yet wired");
      expect(h.status).toBe("unknown");
      expect(h.detail).toBe("Not yet wired");
    });

    it("has a default detail", () => {
      const h = unknownHealth();
      expect(h.detail).toContain("not yet configured");
    });
  });

  describe("collectHealth", () => {
    it("reports healthy when all components are ready", async () => {
      const ready: ComponentHealth = {
        status: "ready",
        lastChecked: new Date().toISOString(),
      };
      const report = await collectHealth({
        gateway: () => ready,
        runtime: () => ready,
        pi: () => ready,
        adapter: () => ready,
      });
      expect(report.overall).toBe("healthy");
      expect(report.gateway.status).toBe("ready");
      expect(report.runtime.status).toBe("ready");
      expect(report.pi.status).toBe("ready");
      expect(report.adapter.status).toBe("ready");
    });

    it("reports healthy when a component is degraded", async () => {
      const ready: ComponentHealth = {
        status: "ready",
        lastChecked: new Date().toISOString(),
      };
      const degraded: ComponentHealth = {
        status: "degraded",
        detail: "High latency",
        lastChecked: new Date().toISOString(),
      };
      const report = await collectHealth({
        gateway: () => ready,
        runtime: () => degraded,
        pi: () => ready,
        adapter: () => ready,
      });
      expect(report.overall).toBe("healthy");
    });

    it("reports unhealthy when any component is down", async () => {
      const ready: ComponentHealth = {
        status: "ready",
        lastChecked: new Date().toISOString(),
      };
      const down: ComponentHealth = {
        status: "down",
        detail: "Connection refused",
        lastChecked: new Date().toISOString(),
      };
      const report = await collectHealth({
        gateway: () => ready,
        runtime: () => ready,
        pi: () => down,
        adapter: () => ready,
      });
      expect(report.overall).toBe("unhealthy");
      expect(report.pi.status).toBe("down");
    });

    it("handles thrown errors from checkers as down", async () => {
      const ready: ComponentHealth = {
        status: "ready",
        lastChecked: new Date().toISOString(),
      };
      const report = await collectHealth({
        gateway: () => ready,
        runtime: () => {
          throw new Error("Connection timeout");
        },
        pi: () => ready,
        adapter: () => ready,
      });
      expect(report.overall).toBe("unhealthy");
      expect(report.runtime.status).toBe("down");
      expect(report.runtime.detail).toBe("Connection timeout");
    });

    it("separates gateway, runtime, Pi, and adapter readiness", async () => {
      const report = await collectHealth({
        gateway: () => ({
          status: "ready",
          detail: "HTTP server accepting connections",
          lastChecked: new Date().toISOString(),
        }),
        runtime: () => ({
          status: "degraded",
          detail: "Slow response",
          lastChecked: new Date().toISOString(),
        }),
        pi: () => ({
          status: "unknown",
          detail: "Pi process not started",
          lastChecked: new Date().toISOString(),
        }),
        adapter: () => ({
          status: "down",
          detail: "Extension bridge disconnected",
          lastChecked: new Date().toISOString(),
        }),
      });

      expect(report.gateway.status).toBe("ready");
      expect(report.runtime.status).toBe("degraded");
      expect(report.pi.status).toBe("unknown");
      expect(report.adapter.status).toBe("down");
      // All four are independently reported
      expect(report.gateway.detail).toContain("accepting connections");
      expect(report.runtime.detail).toContain("Slow response");
      expect(report.pi.detail).toContain("not started");
      expect(report.adapter.detail).toContain("disconnected");
    });

    it("includes ISO-8601 timestamp", () => {
      // Use a fixed checker to verify
      const report = collectHealth({
        gateway: () => ({ status: "ready", lastChecked: "2024-01-01T00:00:00.000Z" }),
        runtime: () => ({ status: "ready", lastChecked: "2024-01-01T00:00:00.000Z" }),
        pi: () => ({ status: "ready", lastChecked: "2024-01-01T00:00:00.000Z" }),
        adapter: () => ({ status: "ready", lastChecked: "2024-01-01T00:00:00.000Z" }),
      });
      return report.then((r) => {
        expect(r.timestamp).toBeTruthy();
        // Valid ISO-8601
        expect(Date.parse(r.timestamp)).not.toBeNaN();
      });
    });
  });
});
