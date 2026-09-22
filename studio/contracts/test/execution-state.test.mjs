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
    // A stage that completed cannot then be reported as failed on the same
    // attempt: two terminal events for one lease is not a gap to infer
    // through, it is a contradiction in the log itself. (Pending -> completed
    // — a lease with no stage-started before its terminal event — used to be
    // this test's scenario, but that gap is now recorded rather than
    // refused; see "records the gap when a stage-started never landed"
    // below, and noteMissingStart's doc comment for why.)
    const events = [
      lease("illustrations", "L1", 1),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
      evt("stage-completed", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1, outputs: ["a"] }),
      evt("stage-failed", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1, error: "x", retryable: true }),
    ];
    assert.throws(() => deriveExecutionState(events, ["illustrations"], NOW), /completed to failed/);
  });

  it("lets a completed stage be leased again — a re-run is a retry, not a violation", () => {
    // The journal is cumulative across every run of an episode and is never
    // truncated, so `completed` cannot be a state a stage can never leave.
    // Re-running a completed stage is a first-class operation (rerun/planner,
    // rerun/recovery), and it reaches the journal as a fresh lease on a stage
    // the log already shows as completed. If that threw, the first re-run
    // would make the episode's whole execution history permanently
    // underivable — the journal is append-only, so there is no undo.
    const events = [
      lease("illustrations", "L1", 1),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
      evt("stage-completed", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1, outputs: ["a"] }),
      lease("illustrations", "L2", 2),
    ];

    assert.doesNotThrow(() => deriveExecutionState(events, ["illustrations"], NOW));

    const inst = deriveExecutionState(events, ["illustrations"], NOW).get("illustrations");
    assert.equal(inst.status, "pending");
    assert.equal(inst.attempts.length, 2);
    assert.equal(inst.attempts[0].outcome, "success");
    assert.equal(inst.attempts[1].outcome, undefined);
    assert.equal(inst.attempts[1].leaseId, "L2");
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

  it("records the gap when a stage-started never landed, rather than throwing", () => {
    // The journal is append-only. A terminal event on an attempt whose start
    // was lost used to throw pending -> completed, and would throw on every
    // future replay too — one lost write made the episode permanently
    // underivable. The gap is evidence; it is not a reason to refuse.
    const events = [
      lease("brief", "L1", 1),
      evt("stage-completed", { stageId: "brief", leaseId: "L1", attemptNumber: 1, outputs: ["artifacts/brief.md"] }),
    ];
    const state = deriveExecutionState(events, ["brief"], NOW);
    const brief = state.get("brief");
    assert.equal(brief.status, "completed");
    assert.equal(brief.attempts[0].startRecorded, false);
    assert.equal(brief.attempts[0].outcome, "success");
    assert.deepEqual(brief.outputArtifacts, ["artifacts/brief.md"]);
  });

  it("records the gap for a failed attempt too", () => {
    const events = [
      lease("brief", "L1", 1),
      evt("stage-failed", { stageId: "brief", leaseId: "L1", attemptNumber: 1, error: "boom", retryable: true }),
    ];
    const state = deriveExecutionState(events, ["brief"], NOW);
    assert.equal(state.get("brief").status, "failed");
    assert.equal(state.get("brief").attempts[0].startRecorded, false);
  });

  it("records the gap for attempt-recorded too", () => {
    const events = [
      lease("brief", "L1", 1),
      evt("attempt-recorded", { stageId: "brief", leaseId: "L1", attemptNumber: 1, outcome: "success", outputs: ["artifacts/brief.md"] }),
    ];
    const state = deriveExecutionState(events, ["brief"], NOW);
    assert.equal(state.get("brief").status, "completed");
    assert.equal(state.get("brief").attempts[0].startRecorded, false);
  });

  it("leaves no marker on a healthy attempt", () => {
    // The marker exists to say something is wrong. Setting it to true on every
    // healthy attempt would make the exceptional case invisible in a sea of
    // routine ones, and would change the shape of every record ever written.
    const events = [
      lease("brief", "L1", 1),
      evt("stage-started", { stageId: "brief", leaseId: "L1", attemptNumber: 1 }),
      evt("stage-completed", { stageId: "brief", leaseId: "L1", attemptNumber: 1, outputs: ["artifacts/brief.md"] }),
    ];
    const attempt = deriveExecutionState(events, ["brief"], NOW).get("brief").attempts[0];
    assert.equal("startRecorded" in attempt, false);
  });

  it("records the gap when an attempt lapses without ever recording its start", () => {
    // The hole the service now creates on purpose: `stage-leased` lands, the
    // `stage-started` write is lost, the claim stops, and NO terminal event
    // ever arrives — the lease simply lapses and `closeIfExpired` times the
    // attempt out. `noteMissingStart` only ever fires on a terminal event, so
    // without marking here the single most common way a gap is produced would
    // be the one gap `vpr status` cannot see.
    const events = [lease("brief", "L1", 1, "2026-09-16T11:00:00Z")];
    const brief = deriveExecutionState(events, ["brief"], NOW).get("brief");
    assert.equal(brief.attempts[0].outcome, "timeout");
    assert.equal(brief.attempts[0].startRecorded, false);
  });

  it("leaves no marker on an attempt that lapsed after recording its start", () => {
    // A holder that started and then died is a plain timeout, not a gap:
    // every event it owed the journal up to that point is in the log.
    const events = [
      lease("brief", "L1", 1, "2026-09-16T11:00:00Z"),
      evt("stage-started", { stageId: "brief", leaseId: "L1", attemptNumber: 1 }),
    ];
    const brief = deriveExecutionState(events, ["brief"], NOW).get("brief");
    assert.equal(brief.attempts[0].outcome, "timeout");
    assert.equal("startRecorded" in brief.attempts[0], false);
  });

  it("leaves no marker on a live attempt that has not recorded its start yet", () => {
    // Mid-flight between `stage-leased` and `stage-started` is the normal
    // state of every claim for as long as those two appends take. Only
    // CLOSING the attempt settles that the start is never going to arrive,
    // which is why the marker belongs on the close and not on the absence.
    const events = [lease("brief", "L1", 1)];
    const brief = deriveExecutionState(events, ["brief"], NOW).get("brief");
    assert.equal(brief.attempts[0].outcome, undefined);
    assert.equal("startRecorded" in brief.attempts[0], false);
  });

  it("refuses a terminal event for an attempt a later lease has superseded", () => {
    // A's `stage-started` is in the log two lines above, and A was already
    // closed as a timeout before B leased. Reading this as "A never recorded
    // its start" would tell the operator something flatly contradicted by the
    // journal, overwrite A's timeout with success, and report the stage
    // `completed` while B's lease is still live. The marker is for a gap
    // inside the attempt that is still open; a terminal event for a closed
    // one is a contradictory log, and a contradictory log fails dead.
    const events = [
      lease("brief", "A", 1, "2026-09-16T11:00:00Z"),
      evt("stage-started", { stageId: "brief", leaseId: "A", attemptNumber: 1 }),
      lease("brief", "B", 2),
      evt("stage-completed", { stageId: "brief", leaseId: "A", attemptNumber: 1, outputs: ["artifacts/brief.md"] }),
    ];
    assert.throws(
      () => deriveExecutionState(events, ["brief"], NOW),
      /cannot go from pending to completed/,
    );
  });

  it("still refuses a terminal event whose lease opened no attempt", () => {
    // The mirror case stays fatal, and the asymmetry is deliberate: a gap
    // INSIDE a known attempt can be recorded against that attempt, but an
    // event belonging to no attempt has no lease id, ttl, holder or startedAt
    // to attach to. Tolerating it would mean inventing an attempt rather than
    // noting a missing event.
    const events = [
      evt("stage-completed", { stageId: "brief", leaseId: "NOPE", attemptNumber: 1, outputs: ["a"] }),
    ];
    assert.throws(() => deriveExecutionState(events, ["brief"], NOW), /never opened/);
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

  it("lets a new lease retry a stage whose previous holder's lease expired mid-run", () => {
    // The realistic crash path: nothing forces a stage-failed or
    // attempt-recorded event for a holder that died, so the next thing the
    // journal sees is a fresh lease for a retry. Expiry must be applied
    // during replay -- not only in an end-of-replay sweep -- or this second
    // stage-leased finds the stage still "running", and running -> pending
    // is a transition the machine forbids: replay would throw, and it would
    // throw on every future replay of this same journal.
    const events = [
      lease("illustrations", "L1", 1, "2026-09-16T11:55:00Z"),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
      lease("illustrations", "L2", 2, "2999-01-01T00:00:00Z"),
    ];

    assert.doesNotThrow(() => deriveExecutionState(events, ["illustrations"], NOW));

    const inst = deriveExecutionState(events, ["illustrations"], NOW).get("illustrations");
    assert.equal(inst.attempts.length, 2);
    assert.equal(inst.attempts[0].outcome, "timeout");
    assert.equal(inst.attempts[1].outcome, undefined);
    assert.equal(inst.status, "pending");
  });

  it("reports no lease once a superseded timeout is followed by a successful retry", () => {
    // leaseState must not keep reporting the dead holder as "expired" once a
    // later attempt has run -- that later attempt is the last word on who
    // holds (or held) the stage.
    const events = [
      lease("illustrations", "L1", 1, "2026-09-16T11:55:00Z"),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
      lease("illustrations", "L2", 2, "2999-01-01T00:00:00Z"),
      evt("stage-started", { stageId: "illustrations", leaseId: "L2", attemptNumber: 2 }),
      evt("stage-completed", { stageId: "illustrations", leaseId: "L2", attemptNumber: 2, outputs: ["a"] }),
    ];
    const inst = deriveExecutionState(events, ["illustrations"], NOW).get("illustrations");
    assert.equal(leaseState(inst, NOW).state, "none");
  });

  it("reports expired for an open attempt whose expiry has passed by the time asked, even under an earlier replay clock", () => {
    // leaseState must check `now` itself, not merely trust whatever the
    // replay concluded at its own (possibly earlier) clock.
    const events = [
      lease("illustrations", "L1", 1, "2026-09-16T12:05:00Z"),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
    ];
    // NOW (12:00:00Z) is before the lease's expiry, so the replay leaves the
    // attempt open and live.
    const inst = deriveExecutionState(events, ["illustrations"], NOW).get("illustrations");
    const later = new Date("2026-09-16T12:10:00Z");
    assert.equal(leaseState(inst, later).state, "expired");
  });
});
