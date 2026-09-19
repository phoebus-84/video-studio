# One execution service

**Issue:** `avg-tt7` — One execution service: single run/status/rerun over the existing engine
**Parent:** `avg-qr4.2` (slice B of five)
**Depends on:** `avg-pm8` (slice A — merged; durable execution state and the filesystem `Lock`)
**Source:** `docs/harness-review.md`, P0 "Runtime invariants exist in modules but are bypassed by active paths"
**Date:** 2026-09-19
**Status:** approved design, not yet implemented

## The problem

Three active code paths each implement a different meaning of "run", and none
of them touches the engine built for the job.

`studio/runtime/src/cli.ts` `cmdRun` persists nothing. It resolves the pipeline,
picks the first stage with a missing output file, and prints an instruction
string for the Pi agent. "Run" means "tell me what to do next".

`studio/gateway/src/runtime/executor.ts` `runAutopilot` actually executes
handlers and writes artifacts. "Run" means "do it".

`studio/agent/src/pipeline-tools.ts` describes its tools as executing and
waiting, which the runtime does not do.

Meanwhile `studio/runtime/src/engine/` contains `StageExecutor` and
`StageStateMachine` with leases, attempts and validated transitions — and has
zero production call sites outside its own module. The same is true of
`checkGate`/`checkGates`, `BudgetLedger`'s reserve/consume/release functions,
`propagateStaleness` and `ArtifactStore`. A tested engine exists and nothing
calls it.

Slice A (`avg-pm8`) supplied what the engine was missing: execution state
recoverable by replaying the journal, and a filesystem `Lock` so leases can be
arbitrated rather than merely recorded. This slice is the service that uses
them.

## A third journal, and why the service ignores it

`studio/runtime/src/journal/` is a second, parallel journal implementation —
its own `Journal` writer, reader and projections, with a dotted event
vocabulary (`stage.started`, `stage.completed`) distinct from the hyphenated
one `@studio/contracts/src/journal.mjs` uses. `journal-event.schema.json`'s
`EventType` enum contains both, describing the dotted set as "kept for older
records"; it is not legacy, it is an unwired parallel implementation. It has no
production callers at all: the only references are a type import in
`engine/executor.ts` and the engine's own state-machine tests, which construct
a real `Journal` and `JournalReader` to assert what the machine writes. So it
is exercised, but only by tests of a module nothing calls.

This matters because `StageExecutor` takes that `Journal` as a constructor
argument. Wiring `StageExecutor` up as-is would send the service's writes to a
journal `deriveExecutionState` does not read — producing exactly the
unrecoverable state slice A exists to prevent.

**The service writes through `@studio/contracts/src/journal.mjs`** — the log
that conforms to its schema, is validated at write time, and is the one replay
actually reads. It therefore drives `StageStateMachine` and `FileLock` but not
`StageExecutor`, whose only distinct contribution is that journal dependency
and an `initStages` that duplicates what replay already does.

The runtime journal keeps two things the contracts journal lacks: sequence
numbers and a SHA-256 hash chain for corruption detection. That is a real
capability and slice A's spec already flagged that a load-bearing log deserves
better than a plain append. It is a follow-up, not a detour here.

## Design

### 1. A library, and who calls it

`studio/runtime/src/execution/` — a library instantiated per process, holding
no state between calls.

- **CLI (`vpr`)** imports it directly; same package.
- **Gateway** imports it directly; it already depends on `@studio/runtime`.
- **Agent** cannot import it — `@studio/runtime` is not one of its
  dependencies — and should not. It is a Pi extension in a separate process
  that already speaks to the gateway over RPC, so it reaches the service
  through the gateway.

That last point is how the acceptance criterion should be read. "CLI, browser
and agent use the same execution transitions" is satisfied by the agent being a
client of the gateway that hosts the service. It does not mean three processes
importing the same module — two processes executing stages is what the lock
exists to arbitrate, and a third would be a mistake rather than a goal.

Two independent instances coordinate through exactly two things on disk: the
journal, and the lockfile. Nothing else is shared.

### 2. One operation, one stage

```
run(ref, pipeline, { stage?, dryRun? }) -> StageOutcome
```

The pipeline is a required argument, not something the service infers from
the episode: replay needs the stage ids the pipeline declares before it can
say anything about state, and guessing them would be the file-existence
inference this module exists to remove, wearing a different hat.

One call claims one stage and returns what happened. Callers that want a whole
episode loop; callers that want a single step do not. The CLI's "what next",
the gateway's autopilot loop and the agent's step-then-wait become the same
call used differently, which is precisely the disagreement this issue names.

In order:

1. Resolve the pipeline. Derive current state by replaying the journal
   (`deriveExecutionState`).
2. Select the stage: the one named, or the first whose dependencies are
   satisfied and which is not already accepted.
3. Check the gates — dependencies, budget, approval. Any refusal returns
   without dispatching.
4. Acquire the lease. Losing the race returns `blocked`, not an error: someone
   else is running that stage, which is the system working.
5. Write `stage-leased`, then `stage-started`.
6. Dispatch to the injected `StageDispatcher`.
7. Validate the outputs the manifest declares — present, and non-empty.
8. Write `stage-completed` or `stage-failed`. Release the lease.

`status(ref, pipeline)` replays the journal and reports instances, lease states and what
is runnable. **No file-existence inference anywhere** — that is the specific
defect `cmdStatus` has today.

`rerun(ref, pipeline, stageIds)` needs no new machinery. Slice A's fix wave made
`completed -> pending` a legal transition in replay, so a fresh lease on a
completed stage *is* a rerun. `rerun` is `planRerun` — which already exists and
already accepts the map `deriveExecutionState` produces — choosing the ids,
followed by ordinary `run` calls naming each one.

### 3. The state machine's table must gain slice A's divergence

`StageStateMachine.transition(instance, to)` validates against
`VALID_TRANSITIONS` in `studio/runtime/src/engine/types.ts`, where
`completed: []`, and acquires a lease through its `Lock` when transitioning to
`running` — resource id `stage:<stageId>`, TTL from `EngineConfig`. That is
exactly the shape `FileLock` implements, so the service can drive it directly.

But the engine's table and replay's table now disagree. Slice A deliberately
allowed `completed -> pending` in replay, because the engine's map governs a
single in-memory run while the journal is cumulative across runs and re-running
a completed stage is a first-class operation. The service would then be able to
record a rerun that replays correctly but that the in-memory machine refuses.

**The engine's table gains the same divergence, with the same comment.** Two
copies of one meaning is already the situation; two copies of *different*
meanings is the bug. This is a small change to `engine/types.ts` and it belongs
here, because this slice is the first code to hold both.

### 4. Two ports the caller injects

```ts
interface StageDispatcher {
  dispatch(stage: ResolvedStage, ctx: DispatchContext): Promise<string[]>;
}

interface BudgetGuard {
  maySpend(stage: ResolvedStage, estimate: number): Promise<Result<Reservation, BudgetError>>;
}
```

`dispatch` returns the paths it wrote. The gateway injects its four surviving
handlers, the agent's path injects the Pi route, tests inject fakes.

Keeping dispatch behind a port is what lets this slice ship without absorbing
`avg-qr4.4`, the declarative adapter registry. The service is the thing that
leases, gates, validates and records; what happens inside a stage is not its
business.

**Absence is refusal.** No dispatcher means the stage does not run; no budget
guard means it does not spend. That is how "missing budget reservations fail
closed" is met literally, without this slice building a budget subsystem on top
of `reserveBudget`/`consumeReserve`/`releaseReserve`, which exist today as real
functions with no store and no callers.

### 5. Failing closed, enumerated

Each is a distinct `StageOutcome`, not a thrown exception, and each outcome
carries the reason. The journal records only what actually happened: no
`blocked` path writes anything, and none should — a blocked stage never
started, and "I considered this and declined" in a log that is now
load-bearing for state is noise rather than evidence.

| condition | outcome |
|---|---|
| stage not declared by the pipeline | `Err(STAGE_UNKNOWN)` — not an outcome at all: a caller naming a stage that does not exist has made a different kind of mistake from a stage that ran and failed |
| no dispatcher supplied | `blocked` |
| dispatcher returned no outputs | `failed` |
| a declared output missing or zero bytes | `failed` |
| lease lost to another holder | `blocked` |
| lease expired mid-flight | `failed`, and nothing is written — replay derives the timeout from the lease's own `expiresAt` |
| a dependency not accepted | `blocked` |
| budget guard refused, or absent | `blocked` |

The distinction is deliberate: `failed` means this attempt is finished and
retryable, `blocked` means the stage never started and the condition is
someone else's to clear.

A lapsed lease is the one condition under which the service deliberately
records nothing at all. By the time it notices, another holder may already
have leased, started and completed the stage, and a terminal event naming the
stale lease landing after that makes replay throw — permanently, because the
journal is append-only, so every later `status` and `run` on that episode
fails. Replay closes the abandoned attempt as a timeout from the lease's own
`expiresAt`, which is already in the log, so the silence costs no information.

### 6. Dry run

A dry run takes the same path through selection, every gate, the retry cap
and the stage's current state, then stops before acquiring the lease. It
performs no writes and no paid calls, and it can still report that the stage
*would* have been blocked and by what — including by a retry limit it has
already exhausted, or by another process holding it right now.

A dry run that skipped any of those would answer a different question than
the real call — which is the property that makes it worth having.

It reports `would-run`, not `completed`: the stage has not completed, and a
caller looping until nothing advances would never terminate if it were told
otherwise, since a dry run journals nothing and the same stage is selected
again on the next pass.

## Testing

- **One meaning:** the same `run` call drives a stage to completion whether
  invoked once or in a loop; `status` after it reports what `run` returned.
- **Selection:** dependencies respected; an explicitly named stage overrides
  selection; an already-accepted stage is not reselected unless named.
- **Each fail-closed row above**, asserted as its own test, with the journal
  record it leaves where it leaves one.
- **Lease arbitration:** two service instances over one episode directory,
  same stage — exactly one dispatches, the other returns `blocked`.
- **Restart:** a service instance that dies mid-stage (lease written, no
  terminal event) leaves state a fresh instance derives correctly, and the
  stage becomes runnable again once the lease expires.
- **Dry run:** no journal lines written, no dispatcher call, and a gate refusal
  still reported.
- **Rerun:** a completed stage named explicitly runs again and records a second
  attempt.

## Scope

**In:** the execution service, its two ports, `run`/`status`/`rerun`, the
fail-closed outcomes, dry run, and the engine table's divergence.

**Out:** adapters (`avg-qr4.4`); candidates, atomic selection and staleness
propagation (`avg-33r`); rewiring the gateway (`avg-2n7`) and the CLI and agent
(`avg-grf`).

**No existing caller changes in this slice.** Like slice A, it lands unused:
`avg-2n7` and `avg-grf` are what make the acceptance criterion literally true.
This is worth stating plainly rather than letting a reviewer discover it — but
it is the second slice in a row to ship unused, and if C and D do not follow
promptly the project accumulates well-tested machinery nothing runs.

## Risks

**The service duplicates selection logic the CLI already has.** `cmdRun`'s
"first stage with a missing output" is the thing being replaced, so overlap is
expected and temporary — but until `avg-grf` lands, two selection rules exist
and disagree, and a reader could reasonably wire the wrong one.

**The engine table change is smaller than it sounds.** Adding `pending` to
`completed`'s allowed list leaves `completed -> running` still forbidden, which
is what the existing invalid-transition test at
`studio/runtime/test/unit/engine/state-machine.test.ts:148` actually asserts —
so it survives unchanged, as does the `pending -> completed` test above it. I
checked: no test asserts that `completed -> pending` is rejected. The change
should break nothing, and if it does, that is a signal worth reading rather
than a test to adjust.

**`StageExecutor` remains unused after this slice**, and is now unlikely ever
to be used, since the service does its job with the contracts journal instead.
Leaving a second executor in the tree invites someone to wire it up later and
recreate the split this issue exists to close. Deleting it is out of scope
here, but it should be filed.
