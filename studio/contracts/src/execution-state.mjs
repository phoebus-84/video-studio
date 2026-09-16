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
        attempt.endedAt = event.at;
        attempt.outcome = data.outcome;
        if (data.outputs) instance.outputArtifacts = data.outputs;
        break;
    }
  }

  return state;
}
