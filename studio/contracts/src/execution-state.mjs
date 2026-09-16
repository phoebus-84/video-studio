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
// write path (Task 1's journal appender) checks that the event's `type` is
// known, that `actor` is present, and that `data` is an object — it does not
// validate `data`'s internal shape against execution-event.schema.json. So a
// wrong-typed field (an `attemptNumber` that is a string, say) passes through
// here silently; the real guarantee that `data` matches its declared payload
// shape comes only from whichever caller validates against the JSON Schema
// before appending to the journal, not from this replay.
// ---------------------------------------------------------------------------

/** Journal event types this module interprets. Everything else is ignored. */
const EXECUTION_EVENTS = Object.freeze([
  "stage-leased", "stage-started", "stage-completed", "stage-failed", "attempt-recorded",
]);

/** Mirrors VALID_TRANSITIONS in studio/runtime/src/engine/types.ts. */
const VALID_TRANSITIONS = Object.freeze({
  pending: ["running"],
  running: ["completed", "failed"],
  completed: [],
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

  // An open attempt whose lease has expired did not finish — its holder is gone
  // and is not coming back. Expiry is not a status of its own: the attempt is a
  // timeout, and the stage lands on the status OUTCOME_STATUS.timeout maps to,
  // which is the state the machine already allows a retry from.
  for (const instance of state.values()) {
    const open = instance.attempts.find((a) => a.outcome === undefined);
    if (!open || !open.expiresAt) continue;
    if (new Date(open.expiresAt).getTime() > now.getTime()) continue;
    open.outcome = "timeout";
    open.endedAt = open.expiresAt;
    if (instance.status === "running") transition(instance, OUTCOME_STATUS.timeout, "the lease expired");
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
  if (!open || !open.expiresAt) {
    // An attempt timed out by the replay above is closed, not live — a stage
    // whose holder vanished must be retryable, not blocked forever.
    const expired = [...instance.attempts].reverse().find((a) => a.outcome === "timeout");
    if (expired) {
      return { state: "expired", holder: expired.holder, expiresAt: expired.expiresAt };
    }
    return { state: "none" };
  }
  return { state: "live", holder: open.holder, expiresAt: open.expiresAt };
}
