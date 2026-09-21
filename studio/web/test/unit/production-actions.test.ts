import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchJSON = vi.fn();

// The store reaches the gateway through this module and nothing else, so one
// mock covers `load` and every action.
vi.mock("$lib/gateway.svelte.ts", () => ({
  getGatewayClient: () => ({ fetchJSON }),
}));

const { actionsFor, production } = await import("$lib/production-store.svelte.ts");

const REF = { channel: "childrens", series: "fairy-tales", episode: "ep-01" };

/** The /status body for a pipeline with one stage in the given state. */
function statusOf(state: string, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: {
      pipeline: "narrated-illustrated-video",
      stages: [
        { stageId: "script", state, dependsOn: [], produces: ["script.md"], ...extra },
      ],
    },
  };
}

beforeEach(() => {
  fetchJSON.mockReset();
  production.error = null;
  production.lastMessage = null;
  production.needsSnapshot = false;
  production.busyStage = null;
  production.stages = [];
});

describe("what the studio offers for each state", () => {
  it("offers run only where a run would be accepted", () => {
    expect(actionsFor("runnable")).toEqual(["run"]);
    expect(actionsFor("completed")).toEqual(["run"]);
    expect(actionsFor("failed")).toEqual(["run"]);
  });

  it("offers approve for a stage waiting on acceptance", () => {
    expect(actionsFor("awaiting_review")).toEqual(["approve"]);
  });

  it("offers nothing for a stage that cannot act", () => {
    // A blocked stage's condition is someone else's to clear, and a running
    // one is held by a live lease. Offering a button that the service will
    // refuse is how the Run Stage button came to report success for work
    // that never happened.
    expect(actionsFor("pending")).toEqual([]);
    expect(actionsFor("blocked")).toEqual([]);
    expect(actionsFor("running")).toEqual([]);
  });

  it("offers nothing for a state it does not know", () => {
    expect(actionsFor("awaiting_approval")).toEqual([]);
    expect(actionsFor("skipped")).toEqual([]);
    expect(actionsFor("")).toEqual([]);
  });
});

describe("reading the status the service reports", () => {
  it("keeps the stage id the service sends, so an action can name it", async () => {
    fetchJSON.mockResolvedValueOnce(statusOf("runnable"));
    await production.load(REF);
    // `stageId`, not `id`: while this read `id`, every action posted to
    // /stages/undefined/execute.
    expect(production.stages[0]?.stageId).toBe("script");
    expect(production.stages[0]?.state).toBe("runnable");
  });

  it("turns an unresolved pipeline into the offer to resolve it", async () => {
    // `error` is `{ code, message }`, not a string. The old prose match
    // stringified it to "[object Object]" and could never fire, so a fresh
    // episode showed a raw error instead of the affordance.
    fetchJSON.mockResolvedValueOnce({
      ok: false,
      error: { code: "PIPELINE_UNRESOLVED", message: 'Pipeline "x" resolved to no stages' },
    });
    await production.load(REF);
    expect(production.needsSnapshot).toBe(true);
    expect(production.error).toBeNull();
  });

  it("renders any other error as its sentence, never as an object", async () => {
    fetchJSON.mockResolvedValueOnce({
      ok: false,
      error: { code: "JOURNAL_UNREADABLE", message: "line 4 is not JSON" },
    });
    await production.load(REF);
    expect(production.needsSnapshot).toBe(false);
    expect(production.error).toBe("line 4 is not JSON");
  });
});

describe("what an action reports back", () => {
  it("reports a refusal as an error, not as success", async () => {
    // The route answers `ok: true` — the service reached a verdict — with an
    // outcome saying the stage did not run. Reporting "Done" for that is the
    // defect this epic exists to remove.
    fetchJSON
      .mockResolvedValueOnce({
        ok: true,
        outcome: {
          stageId: "script",
          status: "blocked",
          reason: "no dispatcher handles stage \"script\"",
          outputs: [],
          durationMs: 1,
        },
      })
      .mockResolvedValueOnce(statusOf("blocked"));

    await production.runStage("script");
    expect(production.error).toBe('no dispatcher handles stage "script"');
    expect(production.lastMessage).toBeNull();
  });

  it("reports a failed outcome as an error too", async () => {
    fetchJSON
      .mockResolvedValueOnce({
        ok: true,
        outcome: { stageId: "script", status: "failed", outputs: [], durationMs: 1 },
      })
      .mockResolvedValueOnce(statusOf("failed"));

    await production.runStage("script");
    expect(production.error).toBe("script: failed");
    expect(production.lastMessage).toBeNull();
  });

  it("reports a completed stage with what it wrote", async () => {
    fetchJSON
      .mockResolvedValueOnce({
        ok: true,
        outcome: { stageId: "script", status: "completed", outputs: ["script.md"], durationMs: 9 },
      })
      .mockResolvedValueOnce(statusOf("completed"));

    await production.runStage("script");
    expect(production.error).toBeNull();
    expect(production.lastMessage).toBe("script completed — wrote script.md");
  });

  it("treats awaiting_review as work that happened", async () => {
    fetchJSON
      .mockResolvedValueOnce({
        ok: true,
        outcome: {
          stageId: "script",
          status: "awaiting_review",
          reason: "stage declares a review and has not been accepted",
          outputs: ["script.md"],
          durationMs: 9,
        },
      })
      .mockResolvedValueOnce(statusOf("awaiting_review"));

    await production.runStage("script");
    expect(production.error).toBeNull();
    expect(production.lastMessage).toBe("stage declares a review and has not been accepted");
  });

  it("renders a structured error from a refused call", async () => {
    fetchJSON.mockResolvedValueOnce({
      ok: false,
      error: { code: "STAGE_UNKNOWN", message: 'Pipeline "p" declares no stage "typo"' },
    });
    await production.runStage("typo");
    expect(production.error).toBe('Pipeline "p" declares no stage "typo"');
  });

  it("renders a bare-string error, which /approve still returns", async () => {
    // /approve and /snapshot go through RuntimeClient, whose `error` is a
    // string. #act is shared across both kinds of route.
    fetchJSON.mockResolvedValueOnce({ ok: false, error: "vpr approve exited 1" });
    await production.approveStage("script");
    expect(production.error).toBe("vpr approve exited 1");
  });

  it("reports what the snapshot route said, which carries no outcome", async () => {
    fetchJSON
      .mockResolvedValueOnce({ ok: true, snapshot: {}, message: "Snapshot created" })
      .mockResolvedValueOnce(statusOf("runnable"));
    await production.resolveSnapshot();
    expect(production.error).toBeNull();
    expect(production.lastMessage).toBe("Snapshot created");
  });
});
