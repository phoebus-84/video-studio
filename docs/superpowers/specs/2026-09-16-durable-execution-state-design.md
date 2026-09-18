# Durable execution state

**Issue:** `avg-pm8` — Durable execution state: persist stage instances, attempts, and leases
**Parent:** `avg-qr4.2` (slice A of five)
**Blocked by:** `avg-i1x` — the journal writer must conform to its schema first
**Source:** `docs/harness-review.md`, P0 "Runtime invariants exist in modules but are bypassed by active paths"
**Date:** 2026-09-16
**Status:** approved design, not yet implemented

## The problem

`avg-qr4.2` asks for one execution service and says restart recovery must be
deterministic. That reads like a wiring job. It is not, because there is no
execution state to recover.

`StageInstance` — the engine's model of a stage, its status, and its attempts —
lives in an in-memory `Map` inside `StageExecutor` and is never written
anywhere. Worse, two modules already consume that map as an input:
`studio/runtime/src/rerun/recovery.ts` and `studio/runtime/src/rerun/planner.ts`
both take `Map<string, StageInstance>` and reason about prior attempts. They
consume state that nothing in the project produces.

The `attempts/` directory is named in the layout contract
(`studio/contracts/src/layout.mjs`) and created by workspace init. Nothing has
ever written to it. Real episodes under `library/` have no `attempts/`
directory at all.

So a process that dies mid-stage leaves nothing behind. The next process infers
what happened from which output files exist — which is exactly the inference
`avg-qr4.1` spent a branch removing from the review path, still in place on the
execution path.

## What already exists

The engine is built and tested, and has no production callers. Verified by
searching for call sites outside each module's own directory:

| primitive | production call sites elsewhere |
|---|---|
| `StageExecutor` | 0 |
| `StageStateMachine` | 0 |
| `checkGate` / `checkGates` | 0 |
| `BudgetLedger` | 0 |
| `propagateStaleness` | 0 |
| `ArtifactStore` | 0 |

More usefully, the journal's event vocabulary already names exactly the
transitions this slice needs to record. `JOURNAL_EVENTS` in
`studio/contracts/src/journal.mjs` contains `stage-leased`, `stage-started`,
`stage-completed`, `stage-failed` and `attempt-recorded`. The vocabulary was
designed for this and then never wired: `stage-leased` has never once been
written.

`studio/runtime/src/ports/lock.ts` defines a `Lock` interface —
`acquire(resource, ttlMs)`, `release(lease)`, `renew(lease, ttlMs)` — returning
a `Lease` of `{ resource, token, expiresAt }`. It has no production
implementation. The only one that exists is a test fixture.

## Design

### 0. Prerequisite: the journal must be trustworthy first (`avg-i1x`)

`journal.mjs` names `journal-event.schema.json` as its contract and has never
conformed to it. It writes `eventId` (a UUID) where the schema requires `id`
matching `^evt_[0-9A-HJKMNP-TV-Z]{26}$`, `episode` for `episodeRef`, `detail`
for `data`, `stageId` at the top level instead of inside the payload, and omits
the `apiVersion`/`kind` envelope — which, with `additionalProperties: false`,
makes every real event invalid. Nothing catches it because **journal events are
never validated at runtime**; only the four hand-written fixtures are checked,
and those were authored against the schema.

`avg-qr4.1` built gate-review records on the writer's actual shape rather than
blocking on this. That was defensible when the journal carried review records
alongside a narrative. It is not defensible here. This slice makes the journal
the sole authority for whether a stage ran, how many times, and who held it. An
event that fails to write, or writes malformed and is skipped on read, is lost
execution state rather than a missing note.

So `avg-i1x` lands first, and the part that matters is not the field renaming —
it is **validation at append and at read**, so writer and schema cannot silently
diverge again. The blast radius is 9 source files and 5 test files.

This design assumes the post-`avg-i1x` shape: payloads live in `data`.

### 1. Execution event payloads

A schema in `@studio/contracts` for what the five execution events carry, the
same shape of work as `gate-review.schema.json`:

```
stage-leased      stageId, leaseId, attemptNumber, ttlMs, expiresAt, holder
stage-started     stageId, leaseId, attemptNumber
stage-completed   stageId, leaseId, attemptNumber, outputs[]
stage-failed      stageId, leaseId, attemptNumber, error, retryable
attempt-recorded  stageId, leaseId, attemptNumber, outcome, outputs[]
```

Every event carries `leaseId` and `attemptNumber`. That is the detail that makes
replay unambiguous: a stage that has been attempted three times produces three
interleaved runs of events, and without both identifiers a reader cannot tell
which `stage-failed` closes which `stage-started`. `attemptNumber` alone is not
enough — a retry after a crash may reuse a number if the crash happened before
the attempt was recorded, and `leaseId` disambiguates.

`holder` names who took the lease (actor plus a process identifier), so an
expired lease can be reported as "held by X until T" rather than as an anonymous
block.

**One collision to settle: the gateway already writes `attempt-recorded`.**
`avg-qr4.1` left a write at `studio/gateway/src/runtime/executor.ts:601` with
the payload `{ durationMs, outputs }` — no `leaseId`, no `attemptNumber`,
because the gateway takes no leases. Under this schema plus `avg-i1x`'s
validation, that write becomes invalid, and an episode halted at a review gate
would start failing to record.

The resolution is to drop that write rather than weaken the schema for it. It is
already redundant: the `approval-requested` emitted beside it by `requestReview`
records the same outputs, with hashes, and is the event the review path actually
reads. The only thing lost is `durationMs`, which nothing consumes. Making
`leaseId` and `attemptNumber` optional to accommodate one redundant caller would
give away exactly the property that makes replay unambiguous.

That deletion belongs to `avg-i1x`, since that is the change which turns the
write into a hard failure — not to this slice, and not left for slice C to trip
over.

### 2. Replay: `deriveExecutionState`

```
deriveExecutionState(events, pipeline, now) -> Map<stageId, StageInstance>
```

A pure function of the event list, the resolved pipeline, and a clock. It reads
nothing else. It mirrors `deriveGateState`, which `avg-qr4.1` shipped on the
same principle: the answer is computed from the record at the moment of asking,
so there is nowhere for a second, disagreeing copy of the truth to live.

Rules:

- A stage the pipeline declares and the journal never mentions is `pending`.
- Events are applied in journal order. Each `stage-leased` opens an attempt;
  `stage-completed` / `stage-failed` / `attempt-recorded` close the attempt
  identified by its `leaseId`.
- An event naming a stage the pipeline does not declare **fails closed** — it
  raises rather than being skipped. A journal describing a stage this pipeline
  has never heard of means the pipeline changed under a running episode, and
  guessing is how the old code got into trouble.
- An event closing an attempt that was never opened fails closed, for the same
  reason.
- A transition the state machine forbids (`VALID_TRANSITIONS` in
  `engine/types.ts`) fails closed rather than being coerced.

Determinism is the point: the same events and the same `now` produce the same
map, every time, because the map is not stored anywhere to drift.

**A vocabulary seam, deliberately not resolved here.** The engine's
`StageStatus` is `pending | running | completed | failed`. The gateway's is
wider — it gained `blocked` and `awaiting_approval` in `avg-qr4.1`. This slice
produces the engine's four and does not widen them. Reconciling the two
vocabularies belongs to the execution service (`avg-tt7`), which is the first
thing that has to speak both.

### 3. A real `Lock`

An append-only log can record that a lease was granted. It cannot arbitrate a
race: two processes would both append `stage-leased` and both believe they hold
the stage. The gateway, the CLI and the agent genuinely run concurrently on one
machine, so this is not hypothetical.

A filesystem implementation of the existing `ports/Lock` interface:

- `acquire(resource, ttlMs)` creates a lockfile with `O_EXCL`, holding an opaque
  token and an expiry. `O_EXCL` is the arbitration — the filesystem decides who
  won, not the caller.
- A lockfile whose expiry has passed is reclaimable: acquire replaces it and
  returns a new lease.
- `release(lease)` is token-checked and idempotent, so a process whose lease
  already expired cannot release the lease that replaced it.
- `renew(lease, ttlMs)` extends the expiry only if the token still matches.

The journal records *that* a lease was granted. The lockfile decides *who won*.
Those are different jobs, and conflating them is the bug this exists to prevent.

The lock is per-machine. That matches how this project runs; a distributed lock
is not in scope and nothing here should pretend otherwise.

### 4. Lease liveness and expiry

A lease is live when a `stage-leased` event exists, no terminal event has closed
that attempt, and `now < expiresAt`.

When a lease expires, the attempt's `outcome` becomes `timeout` and the stage
lands on `failed` — the state the existing machine already allows `running` to
reach, and from which `VALID_TRANSITIONS` permits a retry back to `pending`.
This slice introduces no new status to express expiry; a timed-out attempt is a
failed attempt with a reason.

A stage whose lease is live and held by someone else is not runnable. That is
one of `avg-qr4.2`'s named fail-closed conditions, and it is expressible here
because liveness is derived rather than assumed.

## Testing

- **Replay determinism:** the same event list replayed repeatedly yields an
  identical map.
- **Restart recovery:** a realistic journal with several stages and multiple
  attempts, including one crash — a `stage-leased` and `stage-started` with no
  terminal event — reconstructs the expected state.
- **Attempt disambiguation:** two interleaved attempts on one stage are
  attributed correctly by `leaseId`.
- **Fail closed:** an event for an undeclared stage, an event closing an
  unopened attempt, and a forbidden transition each raise rather than being
  skipped.
- **Expiry:** against a fake `Clock`, a lease past its expiry yields a
  `timeout` attempt and a retryable stage.
- **Lock:** concurrent `acquire` on one resource — exactly one wins; an expired
  lockfile is reclaimable; `release` with a stale token does not release the
  current holder; `release` is idempotent; `renew` fails on a stale token.

## Scope

**In:** the execution-event payload schema, `deriveExecutionState`, the
filesystem `Lock`, and lease liveness.

**Out:** the execution service itself (`avg-tt7`); budget reservation;
candidates and atomic selection (`avg-33r`); rewiring the gateway, CLI and agent
(`avg-2n7`, `avg-grf`).

**This slice ships a library with no production caller.** That is unusual enough
to state plainly rather than let a reviewer discover it. Its consumer is
`avg-tt7`, which cannot be built until the state it drives exists. The
alternative — designing the persistence format inside the service that uses it —
was considered and rejected, because it would put a second execution
implementation into the tree before the first one had anywhere to store its
state.

## Risks

**Replay cost grows with journal length, and nothing has measured it.** A long
episode's journal is read and folded on every query. The obvious remedy is a
checkpoint or a materialized snapshot, and the obvious danger is a cache that
disagrees with the log — the exact failure this project keeps rediscovering. So:
ship the simple thing, measure it on a real episode, and add a checkpoint only
if the measurement demands one. This is a deliberate deferral, not an oversight.

**The journal becomes load-bearing.** After this slice, losing or corrupting
`journal/events.jsonl` means losing execution state, not just history. That
raises the stakes on `avg-i1x`'s runtime validation, and it is worth a follow-up
to decide whether the journal needs a durability guarantee stronger than
`appendFile` — fsync, or a write-ahead discipline. Out of scope here, but it
should be filed rather than assumed away.

**`parseJournal` currently skips malformed lines.** That is right for a
narrative — one bad record must not hide the rest — and wrong for a log that
state is derived from, where a skipped line is a silently forgotten attempt.
`avg-i1x`'s validation work should decide the policy; this design assumes a
malformed line in an execution event is surfaced, not swallowed.
