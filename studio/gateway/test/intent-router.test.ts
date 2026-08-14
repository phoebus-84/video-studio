// ---------------------------------------------------------------------------
// Intent router tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { handleIntent } from "../src/rpc/intent-router.js";
import type { PiProcessManager, SessionHandle } from "../src/rpc/process-manager.js";
import { EventBus } from "../src/events/bus.js";

// ── Fake Pi process manager ────────────────────────────────────────────────

function fakeSession(overrides: Partial<SessionHandle> = {}): SessionHandle {
  return {
    identity: {
      sessionId: "test-session",
      episodeSlug: "ch/series/ep",
      pid: 12345,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    },
    request: vi.fn().mockResolvedValue({ ok: true }),
    notify: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => {}),
    shutdown: vi.fn().mockResolvedValue(undefined),
    isAlive: () => true,
    ...overrides,
  };
}

function fakeProcessMgr(session: SessionHandle): PiProcessManager {
  return {
    session: vi.fn().mockResolvedValue(session),
    get: vi.fn(),
    listSessions: vi.fn().mockReturnValue([]),
    shutdownSession: vi.fn(),
    activeSessions: 0,
    start: vi.fn(),
    stop: vi.fn(),
  } as unknown as PiProcessManager;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("handleIntent", () => {
  afterEach(() => { vi.clearAllMocks(); });

  const bus = new EventBus();

  it("routes prompt intent to pipeline execution", async () => {
    const session = fakeSession();
    const mgr = fakeProcessMgr(session);

    const result = await handleIntent(
      { intent: "prompt", episodeSlug: "ch/series/ep", payload: { prompt: "make a video" } },
      mgr,
      bus,
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe("accepted");
    expect(result.action).toBe("pipeline-started");
    expect(session.request).toHaveBeenCalledWith(
      "pva_run_pipeline",
      expect.objectContaining({ prompt: "make a video" }),
    );
  });

  it("routes steer intent", async () => {
    const session = fakeSession();
    const mgr = fakeProcessMgr(session);

    const result = await handleIntent(
      { intent: "steer", episodeSlug: "ch/series/ep", stageId: "write-brief", payload: { guidance: "more detail" } },
      mgr,
      bus,
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("steered");
    expect(session.request).toHaveBeenCalledWith(
      "pva_steer",
      expect.objectContaining({ guidance: "more detail", stageId: "write-brief" }),
    );
  });

  it("routes follow-up intent", async () => {
    const session = fakeSession();
    const mgr = fakeProcessMgr(session);

    const result = await handleIntent(
      { intent: "follow-up", episodeSlug: "ch/series/ep", payload: { response: "yes", threadId: "th-1" } },
      mgr,
      bus,
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("follow-up-sent");
    expect(session.request).toHaveBeenCalledWith(
      "pva_follow_up",
      expect.objectContaining({ response: "yes", threadId: "th-1" }),
    );
  });

  it("routes approve intent", async () => {
    const session = fakeSession();
    const mgr = fakeProcessMgr(session);

    const result = await handleIntent(
      { intent: "approve", episodeSlug: "ch/series/ep", stageId: "render-outro", payload: {} },
      mgr,
      bus,
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("approved");
    expect(session.request).toHaveBeenCalledWith(
      "pva_approve",
      expect.objectContaining({ stageId: "render-outro" }),
    );
  });

  it("routes rerun intent", async () => {
    const session = fakeSession();
    const mgr = fakeProcessMgr(session);

    const result = await handleIntent(
      { intent: "rerun", episodeSlug: "ch/series/ep", payload: { mode: "full-rebuild" } },
      mgr,
      bus,
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("rerun-planned");
    expect(session.request).toHaveBeenCalledWith(
      "pva_plan_rerun",
      expect.objectContaining({ mode: "full-rebuild" }),
    );
  });

  it("routes edit intent as notification (fire-and-forget)", async () => {
    const session = fakeSession();
    const mgr = fakeProcessMgr(session);

    const result = await handleIntent(
      { intent: "edit", episodeSlug: "ch/series/ep", payload: { artifactPath: "scripts/v1.md" } },
      mgr,
      bus,
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("change-notified");
    expect(session.notify).toHaveBeenCalledWith(
      "pva_artifact_changed",
      expect.objectContaining({ artifactPath: "scripts/v1.md" }),
    );
    expect(session.request).not.toHaveBeenCalled();
  });

  it("routes review intent as notification", async () => {
    const session = fakeSession();
    const mgr = fakeProcessMgr(session);

    const result = await handleIntent(
      { intent: "review", episodeSlug: "ch/series/ep", payload: { threadId: "t1", messageId: "m1" } },
      mgr,
      bus,
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("review-notified");
    expect(session.notify).toHaveBeenCalled();
  });

  it("routes cancel intent", async () => {
    const session = fakeSession();
    const mgr = fakeProcessMgr(session);

    const result = await handleIntent(
      { intent: "cancel", episodeSlug: "ch/series/ep", stageId: "write-brief", payload: {} },
      mgr,
      bus,
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("cancelled");
    expect(session.request).toHaveBeenCalledWith(
      "pva_cancel",
      expect.objectContaining({ stageId: "write-brief" }),
    );
  });

  it("rejects unknown intents", async () => {
    const session = fakeSession();
    const mgr = fakeProcessMgr(session);

    const result = await handleIntent(
      { intent: "unknown-type" as any, episodeSlug: "ch/series/ep", payload: {} },
      mgr,
      bus,
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe("rejected");
  });

  it("handles Pi errors gracefully", async () => {
    const session = fakeSession({
      request: vi.fn().mockRejectedValue(new Error("Pi timeout")),
    });
    const mgr = fakeProcessMgr(session);

    const result = await handleIntent(
      { intent: "prompt", episodeSlug: "ch/series/ep", payload: { prompt: "test" } },
      mgr,
      bus,
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe("error");
    expect(result.data.error).toContain("Pi timeout");
  });
});
