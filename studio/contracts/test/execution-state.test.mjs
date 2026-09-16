import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { deriveExecutionState, leaseState } from "../src/execution-state.mjs";

const ref = { channel: "c", series: "s", episode: "e" };
let seq = 0;
/** A journal event in the shape buildJournalEvent produces. */
const evt = (type, data, actor = "runtime") => ({
  apiVersion: "studio.video/v1alpha1",
  kind: "JournalEvent",
  id: `evt_${String(seq++).padStart(26, "0")}`,
  episodeRef: ref,
  at: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
  actor,
  type,
  data,
});

const lease = (stageId, leaseId, attemptNumber, expiresAt = "2999-01-01T00:00:00Z") =>
  evt("stage-leased", { stageId, leaseId, attemptNumber, ttlMs: 300000, expiresAt, holder: "test/1" });

const NOW = new Date("2026-09-16T12:00:00Z");

describe("deriveExecutionState", () => {
  it("reports a declared stage the journal never mentions as pending", () => {
    const state = deriveExecutionState([], ["illustrations", "captions"], NOW);
    assert.equal(state.get("illustrations").status, "pending");
    assert.equal(state.get("captions").attempts.length, 0);
  });

  it("follows one attempt from lease to completion", () => {
    const events = [
      lease("illustrations", "L1", 1),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
      evt("stage-completed", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1,
        outputs: ["artifacts/frames/s1.png"] }),
    ];

    const inst = deriveExecutionState(events, ["illustrations"], NOW).get("illustrations");

    assert.equal(inst.status, "completed");
    assert.equal(inst.attempts.length, 1);
    assert.equal(inst.attempts[0].outcome, "success");
    assert.deepEqual(inst.outputArtifacts, ["artifacts/frames/s1.png"]);
  });

  it("leaves a stage running when its attempt was never closed", () => {
    // The crash case: the process died between starting and finishing.
    const events = [
      lease("illustrations", "L1", 1),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
    ];
    const inst = deriveExecutionState(events, ["illustrations"], NOW).get("illustrations");
    assert.equal(inst.status, "running");
    assert.equal(inst.attempts[0].endedAt, undefined);
  });

  it("attributes interleaved attempts by leaseId, not by order", () => {
    const events = [
      lease("illustrations", "L1", 1),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
      evt("stage-failed", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1,
        error: "boom", retryable: true }),
      lease("illustrations", "L2", 2),
      evt("stage-started", { stageId: "illustrations", leaseId: "L2", attemptNumber: 2 }),
      evt("stage-completed", { stageId: "illustrations", leaseId: "L2", attemptNumber: 2,
        outputs: ["artifacts/frames/s1.png"] }),
    ];

    const inst = deriveExecutionState(events, ["illustrations"], NOW).get("illustrations");

    assert.equal(inst.attempts.length, 2);
    assert.equal(inst.attempts[0].outcome, "failure");
    assert.equal(inst.attempts[0].error, "boom");
    assert.equal(inst.attempts[1].outcome, "success");
    assert.equal(inst.status, "completed");
  });

  it("is deterministic — the same events replay to the same state", () => {
    const events = [
      lease("illustrations", "L1", 1),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
      evt("stage-failed", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1, error: "x" }),
    ];
    const a = deriveExecutionState(events, ["illustrations"], NOW);
    const b = deriveExecutionState(events, ["illustrations"], NOW);
    assert.deepEqual([...a.entries()], [...b.entries()]);
  });

  it("fails closed on an event for a stage the pipeline does not declare", () => {
    // The pipeline changed under a running episode. Guessing is how the old
    // code got into trouble.
    const events = [lease("ghost-stage", "L1", 1)];
    assert.throws(() => deriveExecutionState(events, ["illustrations"], NOW), /ghost-stage/);
  });

  it("fails closed when an event closes an attempt that was never opened", () => {
    const events = [
      evt("stage-completed", { stageId: "illustrations", leaseId: "L9", attemptNumber: 1, outputs: [] }),
    ];
    assert.throws(() => deriveExecutionState(events, ["illustrations"], NOW), /L9/);
  });

  it("fails closed on a transition the state machine forbids", () => {
    // completed is terminal; a second lease on a completed stage is not a retry
    // the machine allows from that state.
    const events = [
      lease("illustrations", "L1", 1),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
      evt("stage-completed", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1, outputs: ["a"] }),
      lease("illustrations", "L2", 2),
    ];
    assert.throws(() => deriveExecutionState(events, ["illustrations"], NOW), /completed/);
  });

  it("ignores journal events that are not execution events", () => {
    const events = [
      evt("approval-requested", { stageId: "illustrations", decision: "requested" }, "gateway"),
      evt("comment-added", { stageId: "illustrations", body: "looks good" }, "human"),
    ];
    const inst = deriveExecutionState(events, ["illustrations"], NOW).get("illustrations");
    assert.equal(inst.status, "pending");
  });

  it("fails closed on a duplicate stage-leased for the same leaseId", () => {
    // Two leases with the same id and no intervening close would otherwise
    // push a second attempt record that stage-started/stage-completed can
    // never resolve to (Array.find only ever reaches the first one) — a
    // plausible-but-wrong history rather than a thrown error.
    const events = [
      lease("illustrations", "L1", 1),
      lease("illustrations", "L1", 1),
    ];
    assert.throws(() => deriveExecutionState(events, ["illustrations"], NOW), /L1/);
  });

  it("transitions to completed when attempt-recorded reports success", () => {
    const events = [
      lease("illustrations", "L1", 1),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
      evt("attempt-recorded", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1,
        outcome: "success", outputs: ["artifacts/frames/s1.png"] }),
    ];
    const inst = deriveExecutionState(events, ["illustrations"], NOW).get("illustrations");
    assert.equal(inst.status, "completed");
    assert.equal(inst.attempts[0].outcome, "success");
  });

  it("transitions to failed when attempt-recorded reports failure", () => {
    const events = [
      lease("illustrations", "L1", 1),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
      evt("attempt-recorded", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1,
        outcome: "failure" }),
    ];
    const inst = deriveExecutionState(events, ["illustrations"], NOW).get("illustrations");
    assert.equal(inst.status, "failed");
    assert.equal(inst.attempts[0].outcome, "failure");
  });
});

describe("lease liveness", () => {
  it("reports no lease for a stage that never took one", () => {
    const state = deriveExecutionState([], ["illustrations"], NOW);
    assert.equal(leaseState(state.get("illustrations"), NOW).state, "none");
  });

  it("reports a live lease while the attempt is open and unexpired", () => {
    const events = [
      lease("illustrations", "L1", 1, "2026-09-16T12:05:00Z"),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
    ];
    const inst = deriveExecutionState(events, ["illustrations"], NOW).get("illustrations");

    const live = leaseState(inst, NOW);
    assert.equal(live.state, "live");
    assert.equal(live.holder, "test/1");
  });

  it("reports the lease expired once the clock passes its expiry", () => {
    const events = [
      lease("illustrations", "L1", 1, "2026-09-16T11:55:00Z"),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
    ];
    const inst = deriveExecutionState(events, ["illustrations"], NOW).get("illustrations");
    assert.equal(leaseState(inst, NOW).state, "expired");
  });

  it("reports no live lease once the attempt closed, however recent", () => {
    const events = [
      lease("illustrations", "L1", 1, "2999-01-01T00:00:00Z"),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
      evt("stage-completed", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1, outputs: ["a"] }),
    ];
    const inst = deriveExecutionState(events, ["illustrations"], NOW).get("illustrations");
    assert.equal(leaseState(inst, NOW).state, "none");
  });

  it("marks an expired open attempt as timed out and the stage as retryable", () => {
    // The crash case with an expired lease: the holder is gone and is not
    // coming back, so the attempt is a timeout and the stage may be retried.
    const events = [
      lease("illustrations", "L1", 1, "2026-09-16T11:55:00Z"),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
    ];
    const inst = deriveExecutionState(events, ["illustrations"], NOW).get("illustrations");

    assert.equal(inst.attempts[0].outcome, "timeout");
    assert.equal(inst.status, "failed");
  });

  it("leaves an unexpired open attempt running, not timed out", () => {
    const events = [
      lease("illustrations", "L1", 1, "2999-01-01T00:00:00Z"),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
    ];
    const inst = deriveExecutionState(events, ["illustrations"], NOW).get("illustrations");
    assert.equal(inst.attempts[0].outcome, undefined);
    assert.equal(inst.status, "running");
  });
});
