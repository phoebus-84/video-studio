// ---------------------------------------------------------------------------
// Pi process manager tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { PiProcessManager } from "../src/rpc/process-manager.js";
import { EventBus } from "../src/events/bus.js";

vi.mock("../src/rpc/client.js", () => ({
  PiRpcClient: vi.fn().mockImplementation((opts: any) => {
    const listeners: Record<string, Function[]> = {};
    let state = "disconnected";
    let connected = false;

    return {
      options: opts,
      connect: vi.fn().mockImplementation(async () => {
        state = "connected";
        connected = true;
        (listeners["state"] ?? []).forEach((fn) => fn("connected"));
      }),
      shutdown: vi.fn().mockImplementation(async () => {
        state = "disconnected";
        connected = false;
        (listeners["state"] ?? []).forEach((fn) => fn("disconnected"));
      }),
      request: vi.fn().mockResolvedValue({ ok: true }),
      notify: vi.fn(),
      on: vi.fn((event: string, fn: Function) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event]!.push(fn);
        return { on: vi.fn() };
      }),
      get currentState() { return state; },
      get processPid() { return connected ? 12345 : null; },
      _emit(event: string, data: any) {
        (listeners[event] ?? []).forEach((fn) => fn(data));
      },
    };
  }),
  RpcTimeoutError: class extends Error {},
  RpcDisconnectedError: class extends Error {},
}));

import { PiRpcClient } from "../src/rpc/client.js";

// ── Tests ───────────────────────────────────────────────────────────────────

describe("PiProcessManager", () => {
  afterEach(() => { vi.clearAllMocks(); });

  function createManager() {
    const bus = new EventBus();
    return { bus, mgr: new PiProcessManager({
      libraryRoot: "/tmp/test-library",
      bus,
      idleTimeoutMs: 500,
      maxProcesses: 2,
      evictionScanMs: 200,
    }) };
  }

  it("starts with zero sessions", () => {
    const { mgr } = createManager();
    expect(mgr.activeSessions).toBe(0);
    expect(mgr.listSessions()).toEqual([]);
  });

  it("spawns a Pi process for a new episode", async () => {
    const { mgr } = createManager();
    const h = await mgr.session("ch1/series1/ep1");
    expect(h.isAlive()).toBe(true);
    expect(mgr.activeSessions).toBe(1);
    expect(h.identity.episodeSlug).toBe("ch1/series1/ep1");
    expect(h.identity.sessionId).toMatch(/^pi-/);
    expect(PiRpcClient).toHaveBeenCalledTimes(1);
  });

  it("reuses existing session", async () => {
    const { mgr } = createManager();
    await mgr.session("ch1/series1/ep1");
    await mgr.session("ch1/series1/ep1");
    expect(PiRpcClient).toHaveBeenCalledTimes(1);
    expect(mgr.activeSessions).toBe(1);
  });

  it("creates distinct sessions for different episodes", async () => {
    const { mgr } = createManager();
    await mgr.session("ch1/series1/ep1");
    await mgr.session("ch1/series1/ep2");
    expect(mgr.activeSessions).toBe(2);
    expect(PiRpcClient).toHaveBeenCalledTimes(2);
  });

  it("shuts down a specific session", async () => {
    const { mgr } = createManager();
    const h = await mgr.session("ch1/series1/ep1");
    expect(mgr.activeSessions).toBe(1);
    await mgr.shutdownSession("ch1/series1/ep1");
    expect(mgr.activeSessions).toBe(0);
    expect(h.isAlive()).toBe(false);
  });

  it("get returns existing session", async () => {
    const { mgr } = createManager();
    await mgr.session("ch1/series1/ep1");
    const h = mgr.get("ch1/series1/ep1");
    expect(h).not.toBeNull();
    expect(h!.identity.episodeSlug).toBe("ch1/series1/ep1");
  });

  it("get returns null for missing", () => {
    const { mgr } = createManager();
    expect(mgr.get("nonexistent")).toBeNull();
  });

  it("respects max process limit", async () => {
    const { mgr } = createManager();
    const h1 = await mgr.session("ch1/series1/ep1");
    const h2 = await mgr.session("ch1/series1/ep2");
    expect(mgr.activeSessions).toBe(2);

    const h3 = await mgr.session("ch1/series1/ep3");
    expect(mgr.activeSessions).toBe(2);
    expect(h1.isAlive()).toBe(false);
    expect(h2.isAlive()).toBe(true);
    expect(h3.isAlive()).toBe(true);
  });

  it("evicts idle sessions", async () => {
    const { mgr } = createManager();
    mgr.start();
    await mgr.session("ch1/series1/ep1");
    expect(mgr.activeSessions).toBe(1);
    await new Promise((r) => setTimeout(r, 800));
    expect(mgr.activeSessions).toBe(0);
    mgr.stop();
  });

  it("listSessions returns active identities", async () => {
    const { mgr } = createManager();
    await mgr.session("ch1/series1/ep1");
    await mgr.session("ch1/series1/ep2");
    const sessions = mgr.listSessions();
    expect(sessions.length).toBe(2);
    expect(sessions.every((s) => s.pid !== null)).toBe(true);
  });
});
