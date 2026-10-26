import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchJSON = vi.fn();

// The store reaches the gateway through this module and nothing else, so one
// mock covers `load` and every action.
vi.mock("$lib/gateway.svelte.ts", () => ({
  getGatewayClient: () => ({ fetchJSON }),
}));

const { actionsFor, canClaimForAgent, production } = await import("$lib/production-store.svelte.ts");

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

  it("offers run for a stale stage", () => {
    // A completed stage an upstream decision has outrun (avg-qr4.3, task 9)
    // still only needs re-running — the same action as any other stage whose
    // output is no longer current.
    expect(actionsFor("stale")).toEqual(["run"]);
  });

  it("offers approve and reject for a stage awaiting review", () => {
    expect(actionsFor("awaiting_review")).toEqual(["approve", "reject"]);
  });

  it("offers no journal action for an episode whose stages follow its files (avg-qwc)", () => {
    // A series episode is made with Pi's tools and its sheet is approved in the
    // Storyboard: run, approve and reject go through the journal, which refuses them.
    for (const state of ["runnable", "completed", "failed", "stale", "awaiting_review"]) {
      expect(actionsFor(state, "files")).toEqual([]);
    }
    expect(actionsFor("runnable", "journal")).toEqual(["run"]);
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

describe("operator handoff", () => {
  const stage = { stageId: "script", state: "blocked" as const, dependsOn: [], produces: [],
    stateReason: '"script" declares autopilot: false and may not run unattended' };
  it("offers only authenticated journal claims for runnable or attendance-blocked stages", () => {
    expect(canClaimForAgent(stage, "journal", true)).toBe(true);
    expect(canClaimForAgent(stage, "journal", false)).toBe(false);
    expect(canClaimForAgent(stage, "files", true)).toBe(false);
    expect(canClaimForAgent({...stage, stateReason: "dependency not completed"}, "journal", true)).toBe(false);
    for (const state of ["pending", "running", "awaiting_review", "completed", "stale", "failed"] as const)
      expect(canClaimForAgent({...stage, state}, "journal", true)).toBe(false);
    expect(canClaimForAgent({...stage, state: "runnable"}, "journal", true)).toBe(true);
  });
  it("posts a claim without forging a principal and displays the exact lease", async () => {
    production.ref = REF;
    fetchJSON.mockResolvedValueOnce({ok: true, outcome: {stageId: "script", status: "claimed",
      leaseId: "lease-123", expiresAt: "2026-10-23T23:00:00Z"}})
      .mockResolvedValueOnce(statusOf("running"));
    await production.claimStage("script");
    expect(fetchJSON.mock.calls[0]![0]).toBe("/api/channels/childrens/series/fairy-tales/episodes/ep-01/stages/script/claim");
    expect(JSON.parse(fetchJSON.mock.calls[0]![1].body)).toEqual({});
    expect(production.lastMessage).toContain("lease-123");
    expect(production.lastMessage).toContain("2026-10-23T23:00:00Z");
    expect(production.lastMessage).toContain("no work has run yet");
    expect(production.error).toBeNull();
  });
  it("does not turn a refused claim into a handoff", async () => {
    production.ref = REF;
    fetchJSON.mockResolvedValueOnce({ok: true, outcome: {status: "blocked", reason: "sign in as operator"}})
      .mockResolvedValueOnce(statusOf("blocked"));
    await production.claimStage("script");
    expect(production.error).toBe("sign in as operator");
    expect(production.lastMessage).toBeNull();
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

  it("keeps the refusal when the reload fails too, rather than replacing it", async () => {
    // `??=` dropped the refusal whenever `load` set an error of its own, so a
    // refused run behind a broken status read looked like a status problem
    // and nothing else.
    fetchJSON
      .mockResolvedValueOnce({
        ok: true,
        outcome: { stageId: "script", status: "blocked", reason: "budget guard refused", outputs: [], durationMs: 1 },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "JOURNAL_UNREADABLE", message: "line 4 is not JSON" },
      });

    await production.runStage("script");
    expect(production.error).toContain("budget guard refused");
    expect(production.error).toContain("line 4 is not JSON");
  });

  it("treats a claim as the stage advancing, not as a refusal", async () => {
    // Nothing in the studio calls /claim yet. When something does, a
    // successful claim must not arrive as an error.
    fetchJSON
      .mockResolvedValueOnce({
        ok: true,
        outcome: { stageId: "script", status: "claimed", outputs: [], durationMs: 1 },
      })
      .mockResolvedValueOnce(statusOf("running"));

    await production.runStage("script");
    expect(production.error).toBeNull();
    expect(production.lastMessage).toContain("script is claimed — no work has run yet");
    expect(production.lastMessage).toContain("missing (do not complete)");
  });

  it("surfaces a failed resolve, which arrives as a throw and leaves needsSnapshot set", async () => {
    // /snapshot reports failure by throwing GatewayError, so it comes back
    // non-2xx and fetchJSON throws: `load` never runs and `needsSnapshot`
    // stays true, which keeps ProductionPanel in the branch that offers the
    // button. That branch has to render `error`, or a failed resolve looks
    // like the click did nothing.
    fetchJSON.mockResolvedValueOnce({
      ok: false,
      error: { code: "PIPELINE_UNRESOLVED", message: "never resolved" },
    });
    await production.load(REF);
    expect(production.needsSnapshot).toBe(true);

    fetchJSON.mockRejectedValueOnce(new Error("Pipeline \"x\" could not be resolved: ENOENT"));
    await production.resolveSnapshot();
    expect(production.needsSnapshot).toBe(true);
    expect(production.error).toBe('Pipeline "x" could not be resolved: ENOENT');
    expect(production.lastMessage).toBeNull();
  });

  it("reports what the snapshot route said, which carries no outcome", async () => {
    fetchJSON
      .mockResolvedValueOnce({ ok: true, snapshot: {}, message: "Snapshot created" })
      .mockResolvedValueOnce(statusOf("runnable"));
    await production.resolveSnapshot();
    expect(production.error).toBeNull();
    expect(production.lastMessage).toBe("Snapshot created");
  });

  it("rejectStage posts the note to the reject route", async () => {
    fetchJSON
      .mockResolvedValueOnce({
        ok: true,
        outcome: { stageId: "script", status: "rejected", outputs: [], durationMs: 1 },
      })
      .mockResolvedValueOnce(statusOf("failed"));

    await production.rejectStage("script", "the voiceover mispronounces the character's name");

    expect(fetchJSON).toHaveBeenCalledWith(
      expect.stringContaining("/stages/script/reject"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ note: "the voiceover mispronounces the character's name" }),
      }),
    );
    // A recorded rejection is a decision the gate reached deliberately, not a
    // stage that failed to run — it belongs on `lastMessage`, not `error`.
    expect(production.error).toBeNull();
  });

  it("shows why an approval was only requested, for a browser on the agent token", async () => {
    // The operator key makes this browser the operator; without it an
    // /approve call still succeeds at the HTTP layer but the service answers
    // `requested` rather than `approved`. That reason is the only thing
    // telling the person nothing actually happened.
    fetchJSON
      .mockResolvedValueOnce({
        ok: true,
        outcome: {
          stageId: "script",
          status: "requested",
          reason: '"script" declares human review; approval requested — an operator must approve it',
          outputs: [],
          durationMs: 1,
        },
      })
      .mockResolvedValueOnce(statusOf("awaiting_review"));

    await production.approveStage("script");

    expect(production.lastMessage).toBe(
      '"script" declares human review; approval requested — an operator must approve it',
    );
  });
});
