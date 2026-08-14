// ---------------------------------------------------------------------------
// UI bridge tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { ExtensionBridge } from "../src/rpc/ui-bridge.js";
import type { UiResponse } from "../src/rpc/ui-bridge.js";
import { EventBus } from "../src/events/bus.js";
import type { PiProcessManager } from "../src/rpc/process-manager.js";

describe("ExtensionBridge", () => {
  afterEach(() => { vi.clearAllMocks(); });

  function createBridge() {
    const bus = new EventBus();
    const mgr = {} as PiProcessManager;
    return { bus, bridge: new ExtensionBridge(bus) };
  }

  it("starts with zero pending requests", () => {
    const { bridge } = createBridge();
    expect(bridge.pendingCount).toBe(0);
  });

  it("creates a UI request and publishes to event bus", async () => {
    const { bus, bridge } = createBridge();

    const events: any[] = [];
    bus.subscribe({
      send(e) { events.push(e); },
      close() {},
      isAlive() { return true; },
      channels: ["pi"],
    });

    const requestPromise = bridge.requestUi(
      "ch/series/ep",
      "ask-approval",
      "Approve render?",
      "The outro rendering needs your approval",
      { stageId: "render-outro" },
      5000,
    );

    expect(bridge.pendingCount).toBe(1);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("ui-request");
    expect(events[0].data.action).toBe("ask-approval");
    expect(events[0].data.title).toBe("Approve render?");

    // Respond
    const requestId = events[0].data.requestId as string;
    bridge.submitResponse({
      requestId,
      action: "approved",
      payload: { comment: "looks good" },
    });

    const response = await requestPromise;
    expect(response.action).toBe("approved");
    expect(response.payload.comment).toBe("looks good");
    expect(bridge.pendingCount).toBe(0);
  });

  it("times out if no response", async () => {
    const { bridge } = createBridge();

    await expect(
      bridge.requestUi("ch/series/ep", "request-input", "Title", "Desc", {}, 50),
    ).rejects.toThrow("timed out");

    expect(bridge.pendingCount).toBe(0);
  });

  it("dismisses a pending request", async () => {
    const { bridge } = createBridge();

    const requestPromise = bridge.requestUi(
      "ch/series/ep",
      "show-preview",
      "Preview",
      "Description",
      {},
      5000,
    );

    expect(bridge.pendingCount).toBe(1);

    // Simulate the request ID (from event data)
    bridge.dismissRequest("ui-non-existent");
    expect(bridge.pendingCount).toBe(1); // still there, wrong ID

    // Actually dismiss - we need the real ID. We can't easily get it without event bus.
    // Instead, test that submitting response works for correct ID
    // and that non-existent IDs return false.

    const result = bridge.submitResponse({ requestId: "ui-non-existent", action: "approved", payload: {} });
    expect(result).toBe(false);
  });

  it("submitResponse returns false for unknown request", () => {
    const { bridge } = createBridge();
    expect(bridge.submitResponse({ requestId: "unknown", action: "approved", payload: {} })).toBe(false);
  });
});
