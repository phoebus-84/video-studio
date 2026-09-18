// ---------------------------------------------------------------------------
// Execution state, derived
// ---------------------------------------------------------------------------
// Which stages ran, how many times, and how each attempt ended — computed by
// replaying the journal, not read from a second copy that could disagree with
// it. The same principle deriveGateState works on: the answer is computed from
// the record at the moment of asking, so there is nowhere for a stale truth to
// live.
//
// StageInstance mirrors the shape studio/runtime/src/engine/types.ts defines,
// so the engine's own executor and the rerun planner can consume it. The types
// are duplicated rather than imported because the dependency runs the other
// way: runtime depends on contracts, never the reverse.
//
// Validation boundary: this module trusts `event.data` field-by-field. The
// write path (buildJournalEvent in journal.mjs) checks that the event's `type`
// is known, that `actor` is present, that `data` is an object, and — for the
// five execution events — that every field execution-event.schema.json marks
// required is actually present. That last check is what lets the replay below
// assume a terminal event names the lease it closes.
//
// Presence is all it checks, because that module is imported at runtime by
// packages that carry no ajv. So a wrong-TYPED field (an `attemptNumber` that
// is a string, say) still passes through here silently; the guarantee that
// `data` matches its declared payload shape in full comes only from a caller
// that validates against the JSON Schema before appending, not from this
// replay.
// ---------------------------------------------------------------------------

/** Journal event types this module interprets. Everything else is ignored. */
const EXECUTION_EVENTS = Object.freeze([
  "stage-leased", "stage-started", "stage-completed", "stage-failed", "attempt-recorded",
]);

/**
 * The transitions replay accepts. Deliberately NOT identical to
 * VALID_TRANSITIONS in studio/runtime/src/engine/types.ts, and the difference
 * is the point — do not "restore fidelity" to the engine's table.
 *
 * The engine's map governs one in-memory run: within a single execution a
 * stage that has completed is finished, and nothing may move it again. This
 * map governs a cumulative, append-only log that spans every run an episode
 * ever had and is never truncated. So `completed` cannot be terminal here:
 * re-running a completed stage is a first-class operation (see
 * studio/runtime/src/rerun/planner.ts and rerun/recovery.ts), and the journal
 * records that re-run as a fresh `stage-leased` on a stage the log already
 * shows as completed.
 *
 * Under the engine's table that lease is an illegal transition, so replay
 * throws — and because the journal can never be rewritten, it throws on every
 * future replay too: one re-run would make that episode's execution state
 * permanently underivable. `completed -> pending` is therefore allowed here.
 * It is a legitimate retry, not a violation.
 */
const VALID_TRANSITIONS = Object.freeze({
  pending: ["running"],
  running: ["completed", "failed"],
  completed: ["pending"],
  failed: ["pending"],
});

/** Maps an attempt-recorded outcome to the status it settles the stage into. */
const OUTCOME_STATUS = Object.freeze({
  success: "completed",
  failure: "failed",
  timeout: "failed",
});

function transition(instance, to, because) {
  const from = instance.status;
  if (from === to) return;
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new Error(
      `Stage "${instance.stageId}" cannot go from ${from} to ${to} (${because}): ` +
      `the state machine does not allow it, and coercing it would invent history`,
    );
  }
  instance.status = to;
}

/**
 * If `instance` has an open attempt whose lease has expired at or before
 * `now`, close it: the holder is gone and is not coming back. Expiry is not
 * a status of its own — the attempt becomes a timeout, and the stage lands
 * on whatever OUTCOME_STATUS.timeout maps to (failed), which is the state
 * the machine already allows a retry from.
 *
 * Called from two places: inline during replay, right before an event for
 * this stage is processed (so a retry lease arriving after a crash finds the
 * stage already failed, not stuck running), and once more after the loop, to
 * close an attempt left open at the end of the journal with no later event
 * to trigger the inline check.
 */
function closeIfExpired(instance, now) {
  const open = instance.attempts.find((a) => a.outcome === undefined);
  if (!open || !open.expiresAt) return;
  if (new Date(open.expiresAt).getTime() > now.getTime()) return;
  open.outcome = "timeout";
  open.endedAt = open.expiresAt;
  if (instance.status === "running") transition(instance, OUTCOME_STATUS.timeout, "the lease expired");
}

/**
 * Replay a journal into per-stage execution state.
 *
 * `stageIds` are the stages the resolved pipeline declares. `now` is the clock
 * — passed in rather than read, so a replay is reproducible.
 *
 * Fails closed rather than skipping: an event naming an undeclared stage, or
 * closing an attempt that was never opened, means the journal and the pipeline
 * disagree about reality, and guessing which is right is how file-existence
 * inference got into the codebase in the first place.
 */
export function deriveExecutionState(events, stageIds, now = new Date()) {
  const state = new Map();
  for (const stageId of stageIds) {
    state.set(stageId, {
      stageId,
      status: "pending",
      attempts: [],
      outputArtifacts: [],
      createdAt: null,
    });
  }

  for (const event of events) {
    if (!EXECUTION_EVENTS.includes(event.type)) continue;

    const data = event.data ?? {};
    const { stageId, leaseId } = data;
    const instance = state.get(stageId);
    if (!instance) {
      throw new Error(
        `Journal names stage "${stageId}", which this pipeline does not declare. ` +
        `The pipeline changed under a running episode.`,
      );
    }
    if (instance.createdAt === null) instance.createdAt = event.at;

    if (event.type === "stage-leased") {
      // A retry lease for a crashed holder is the realistic path — nothing
      // forces a stage-failed or attempt-recorded event for a holder that
      // just died. Close any expired open attempt from an EARLIER lease on
      // this stage before granting the new one, so the stage is already
      // `failed` (not stuck `running`) by the time this lease moves it to
      // `pending`. This must run only here, not before every event: an
      // event that continues the CURRENTLY open attempt (stage-started,
      // stage-completed, ...) is itself the authoritative account of what
      // happened to that attempt, and must not be preempted by a timeout
      // guess just because `now` has drifted past its expiry.
      closeIfExpired(instance, now);

      if (instance.attempts.some((a) => a.leaseId === leaseId)) {
        throw new Error(
          `Journal leases attempt "${leaseId}" on stage "${stageId}" twice. ` +
          `A duplicate lease id describes something impossible, and inventing a ` +
          `second attempt for it would be a guess.`,
        );
      }
      transition(instance, "pending", "a new lease");
      instance.attempts.push({
        number: data.attemptNumber,
        leaseId,
        startedAt: event.at,
        ttlMs: data.ttlMs,
        expiresAt: data.expiresAt,
        holder: data.holder,
      });
      continue;
    }

    const attempt = instance.attempts.find((a) => a.leaseId === leaseId);
    if (!attempt) {
      throw new Error(
        `Journal closes attempt "${leaseId}" on stage "${stageId}", which was never opened. ` +
        `A terminal event without its lease cannot be placed in the history.`,
      );
    }

    switch (event.type) {
      case "stage-started":
        transition(instance, "running", "the attempt started");
        break;
      case "stage-completed":
        transition(instance, "completed", "the attempt completed");
        attempt.endedAt = event.at;
        attempt.outcome = "success";
        instance.outputArtifacts = data.outputs ?? [];
        break;
      case "stage-failed":
        transition(instance, "failed", "the attempt failed");
        attempt.endedAt = event.at;
        attempt.outcome = "failure";
        attempt.error = data.error;
        attempt.retryable = data.retryable;
        break;
      case "attempt-recorded":
        transition(instance, OUTCOME_STATUS[data.outcome], "the attempt was recorded");
        attempt.endedAt = event.at;
        attempt.outcome = data.outcome;
        if (data.outputs) instance.outputArtifacts = data.outputs;
        break;
    }
  }

  // A journal whose last event leaves an attempt open still needs that
  // attempt timed out if its lease has expired by `now` — no later event
  // will arrive to trigger the inline check above.
  for (const instance of state.values()) {
    closeIfExpired(instance, now);
  }

  return state;
}

/**
 * The lease on a stage, now.
 *
 * A lease is live when an attempt is open and its expiry has not passed. The
 * journal records that a lease was granted; it cannot arbitrate who won a race,
 * which is what the Lock port is for. This answers only "is someone holding
 * this, and until when".
 */
export function leaseState(instance, now = new Date()) {
  const open = instance.attempts.find((a) => a.outcome === undefined);
  if (open && open.expiresAt) {
    // Trust `now` here too, not just whatever the replay already concluded:
    // a caller can ask leaseState with a later clock than the one the replay
    // used, and an attempt open-but-past-expiry at THAT moment is expired
    // regardless of what deriveExecutionState decided at its own `now`.
    if (new Date(open.expiresAt).getTime() > now.getTime()) {
      return { state: "live", holder: open.holder, expiresAt: open.expiresAt };
    }
    return { state: "expired", holder: open.holder, expiresAt: open.expiresAt };
  }

  // An attempt timed out by the replay is closed, not live — a stage whose
  // holder vanished must be retryable, not blocked forever. But report that
  // only while the timeout is still the last word: once a later attempt has
  // run (retried and succeeded, failed, or is itself open), the dead
  // holder's lease is no longer what the caller should be told about.
  const last = instance.attempts[instance.attempts.length - 1];
  if (last && last.outcome === "timeout") {
    return { state: "expired", holder: last.holder, expiresAt: last.expiresAt };
  }
  return { state: "none" };
}
