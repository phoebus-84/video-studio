# The CLI and the agent speak the execution service

**Issue:** `avg-grf` — CLI and agent speak the execution service, not their own dialects
**Parent:** `avg-qr4.2` (slice D of five)
**Depends on:** `avg-tt7` (slice B — merged; the execution service), `avg-2n7` (slice C — merged; the gateway on the service)
**Source:** `docs/harness-review.md`, P0 "Runtime invariants exist in modules but are bypassed by active paths"
**Date:** 2026-09-20
**Status:** approved design, not yet implemented

## The problem the issue names, and the one underneath it

`vpr run` is advisory: it picks the first stage with a missing output file,
prints an instruction for the Pi agent, and persists nothing. `cmdStatus`
infers completion the same way and reports a budget of zero. `cmdRerun`
returns an empty plan unconditionally. The agent's tools describe themselves
as executing and waiting, which no code behind them does.

That is the issue as filed. Underneath it is something larger, which this
slice has to confront because it cannot wire the CLI to the service without
answering it.

**Six of the ten stages in the default pipeline have no performer anywhere in
the system.** `studio/gateway/src/runtime/executor.ts` supplies four handlers
— `illustrations`, `captions`, `timing`, `qa`. The pipeline's first four
stages are `brief`, `script`, `art-direction` and `terminal-recordings`, and
none of them has one. So `/execute` on a fresh episode selects `brief`, finds
no dispatcher that handles it, and returns `blocked`. The pipeline cannot
start.

This is not a regression from `avg-2n7`: `runAutopilot` had the same four
handlers and the same hole, concealed because it selected by file existence
and an episode whose files were already on disk appeared to be progressing.
Removing that concealment is what made the hole visible.

The stages with no handler are not an oversight either. `brief`, `script` and
`art-direction` are the Pi agent's work — a model writing prose, over many
turns, against skills. They were never going to be a function the service
calls and awaits. The system's architecture always had an out-of-process
performer in it; what it lacked was any way for that performer to participate
in the record.

## Design

### 1. Claim and complete

The service gains two methods beside `run`:

```ts
claim(ref, pipeline, opts?: { stage?: string }): Promise<Result<StageOutcome, ExecutionError>>

complete(
  ref, pipeline, stageId,
  result: { leaseId?: string; failed?: boolean; error?: string },
): Promise<Result<StageOutcome, ExecutionError>>
```

`claim` performs everything `run` performs up to and including acquiring the
lease and writing `stage-leased` and `stage-started`, then stops. It returns a
new `OutcomeStatus` member, `claimed`, carrying the `leaseId` and
`attemptNumber` the performer will need.

`complete` validates the outputs the manifest declares — present, non-empty —
and writes `stage-completed`, or writes `stage-failed` when the performer
reports failure. Either way it releases the lease.

Between the two calls, something outside the process does the work: Pi writing
a brief, a person recording a terminal session, an operator running ffmpeg by
hand. The service does not know or care which. It knows the stage was claimed,
by whom, and until when.

**This is not a new dialect.** `claim` and `complete` write exactly the events
`run` writes, in the same order, with the same payloads, because of section 2.

### 2. One code path that writes execution events

`run()` is refactored to be `claim()`, then dispatch, then `complete()`. Not a
parallel implementation that happens to agree — literally those calls, with
the dispatcher invocation between them.

This matters more than it looks. The thing this epic keeps finding is two
implementations of one meaning drifting apart: three meanings of "run", two
journals, two dependency-satisfaction rules, an engine transition table and a
replay table that disagreed. A synchronous dispatcher path and an
out-of-process performer path, each writing its own `stage-leased`, would be
the next instance — and the one hardest to notice, because both would be
correct in isolation and only a journal written by both would show the seam.

The refactor lands on `avg-2n7`'s week-old tests. That is the point of having
them.

### 3. Completing a claim you no longer hold

`complete` requires the claim to be live. Called without an explicit
`leaseId`, it resolves the stage's single open attempt from replay and refuses
if that attempt's lease has expired. Called with one, the id must match.

This is the whole reason the lease exists. `avg-pm8`'s design named the
failure precisely: by the time a lapsed holder notices, another process may
already have leased, started and completed the stage, and a terminal event
naming the stale lease landing after that makes replay throw — permanently,
because the journal is append-only. A `complete` that did not check liveness
would be a supported, documented way to brick an episode.

An abandoned claim needs no command of its own. The lease expires, replay
derives a `timeout` attempt from its own `expiresAt`, and the stage becomes
runnable again. `vpr complete --failed` covers the case where the performer
knows it went wrong and wants to say so now.

### 4. Output validation is not file-existence inference

`complete` decides whether a stage produced what it promised by looking at
whether the declared files are present and non-empty. That resembles the
inference this epic exists to remove, closely enough to say why it is not.

The bad inference uses file existence to decide **whether a stage ran**. That
is unfalsifiable: a file left over from an earlier attempt, a partial write, a
file copied in by hand, all read as success. Here the `stage-leased` and
`stage-started` events are the evidence that the stage ran, and the performer's
`complete` call is its own assertion that it finished. The files are checked
only against what the manifest said they would be. That is validation of a
claim, not a substitute for one — and it is what the service already does
after a dispatcher returns.

### 5. The CLI

**`vpr run <ep> [--stage id] [--pipeline name] [--dry-run]`** claims. It
selects, checks every gate, takes the lease, journals, and prints what the
performer must do next — the stage's capabilities and where its outputs go, as
today, plus the lease id and when it expires.

`--dry-run` looks without claiming: the service's dry run, reporting the stage
that would be selected and every gate that would refuse it. This is where the
old advisory behaviour goes, and it is strictly more informative than what it
replaces, because the old version consulted no gate at all.

Keeping `run` as the claiming verb rather than adding `vpr claim` is
deliberate: `run --dry-run` already means "show me without doing it" across
every other command, so the footgun of accidentally taking a lease is covered
by a flag users already know.

The CLI claims any stage, including the four the gateway can perform
automatically. It cannot do otherwise — the handlers live in
`@studio/gateway`, which depends on `@studio/runtime` and not the reverse — and
pretending otherwise would be a lie about where work happens. A claim on
`illustrations` from a terminal means a person is doing it by hand, which is a
real thing someone may need to do.

**`vpr complete <ep> <stage> [--lease id] [--failed] [--error msg]`** is new.

**`vpr status <ep>`** reports the service's replay: per stage its status,
attempt count, lease state and holder, and whether it is genuinely runnable.
No file-existence inference. The zero-consumption budget object goes: a budget
this command cannot compute is better absent than reported as zero, which is a
number a caller can act on.

**`vpr rerun <ep> [--mode m] [--stages a,b]`** calls `planRerun` and then
`rerun`. Three modes are derivable from the journal alone and are supported:
`retry-current`, `rerun-selected`, `full-rebuild`.

`rerun-affected-downstream` **refuses by name**, pointing at `avg-33r`, which
owns staleness propagation. Building a minimal staleness computation here to
make the fourth mode work would put a second interpretation of "affected" into
the tree ahead of the issue that designs it — and an empty plan returned
silently, which is what happens today, is the failure mode this whole epic is
about.

The boundary is not arbitrary, and it is checkable: `planRerun` reads its
`report` argument in exactly one branch, the `rerun-affected-downstream` case
at `studio/runtime/src/rerun/planner.ts:51`. The three supported modes derive
their rerun set from the `Map<string, StageInstance>` that
`deriveExecutionState` already produces. So `report` becomes an optional
parameter, and the one mode that needs it raises when it is absent — the type
expressing which mode depends on staleness, rather than the CLI fabricating an
empty report to satisfy a signature.

`--mode rerun-affected`, which the CLI accepts today and which matches no
member of `RerunMode`, stops being accepted. It has never done anything.

### 6. Status must agree with run

`StageStatusReport.dependenciesMet` is computed by the exported
`dependenciesMet()` in `service.ts`, which tests only for `completed`. The
dependency check inside `run()` additionally consults the `ReviewGate`. So
status already reports a stage as having its dependencies met when `run` will
block it — a disagreement introduced by `avg-2n7` and shipped.

This slice is where it has to be fixed, because this is where the CLI starts
reporting from that field. The status path consults the same review-aware
check `run` uses. A caller must never be told a stage is ready and then told
it is blocked when they act on it.

### 7. The gateway

`POST .../stages/:stage/execute` becomes `service.run(ref, pipeline, { stage })`
against the same composition `/execute` already builds — the `GatewayDispatcher`,
the `GatewayReviewGate`, the journal. For the four handler stages it performs
the work; for the rest it returns `blocked` naming what is missing, instead of
shelling out to a CLI that prints advice and exits zero.

The web UI's "Run stage" button uses this route. Today that button does
nothing and reports success.

`GET .../status` reports the service's replay, same as `vpr status`.

Two new routes carry claim/complete to the agent:
`POST .../stages/:stage/claim` and `POST .../stages/:stage/complete`.

**`studio/gateway/src/routes/runtime.ts` is deleted**, along with the
`RuntimeClient` methods that become unused. It exposes eight endpoints —
`/runtime/run`, `/status`, `/rerun`, `/approve`, `/init`, `/resolve`,
`/validate`, `/health` — that map one-to-one onto `vpr` subcommands and
are called by nothing in the repository, not even a test. It is a second
execute surface kept alive by nobody, and `avg-tt7`'s spec already named the
risk: a reader could reasonably wire the wrong one.

`RuntimeClient` itself survives. `production.ts` makes six calls into it, and
three are execution and move to the service: `run` (the single-stage route),
`status`, and `rerun` (the rerun-plan route). The other three stay, because
they are not execution: `resolve` behind `/snapshot`, `init` behind `/init`,
and `approve` behind `/stages/:stage/approve` — approval is `avg-qr4.3`'s to
move, and `cmdApprove` already writes a hash-bound record since `avg-2n7`, so
shelling to it is correct today.

### 8. The web's action mapping

`actionsFor` in `studio/web/src/lib/production-store.svelte.ts` maps a stage's
state to the buttons the studio offers. It handles `runnable`,
`awaiting_approval`, `awaiting_review`, `complete`, `completed` — a set
assembled from two vocabularies, of which `vpr status` emits exactly two
members.

`StageStatusReport.status` has four members — `pending`, `running`,
`completed`, `failed` — which is what the journal can say about a stage on its
own. `runnable`, `blocked` and `awaiting_review` are answers about a stage *in
its pipeline*: they need the dependency check, the gates and the review gate.
So the report gains one derived field, `state`, computed by the same code that
answers those questions for `run`, and that field is what the CLI prints and
the studio switches on. The four-member `status` stays beside it as the raw
journal fact.

With that, the vocabulary is fixed and small, and `actionsFor` maps it
exactly:

| state | meaning | actions |
|---|---|---|
| `runnable` | dependencies met, gates pass | run |
| `pending` | dependencies not met | none |
| `running` | claimed, lease live | none |
| `blocked` | a gate refuses | none |
| `failed` | attempt finished badly | run |
| `completed` | done and accepted | run |
| `awaiting_review` | done, review outstanding | approve |

This is a small change and it is in scope because `avg-qr4.2`'s acceptance
criterion names the browser. Reconciling `awaiting_approval` — the spelling in
`studio/web/src/contracts/gateway.ts`, which nothing produces — is part of it:
the string is removed rather than carried as a second name for one state.

### 9. The agent

`pva_claim_stage` and `pva_complete_stage`, over the two new routes. These are
what let Pi participate: claim `brief`, write it, complete it.

With them the default pipeline is performable end to end for the first time —
Pi performs `brief`, `art-direction` and (with `avg-qr4.3`'s attendance
signal) `script`; the gateway's handlers perform `illustrations`, `captions`,
`timing` and `qa`; `terminal-recordings` and `narration` are claimed and
performed by whatever has the capability, pending `avg-qr4.4`'s adapters.

Existing tool descriptions are corrected to what the code does.
`pva_run_stage` — "Execute a single pipeline stage and wait for completion" —
becomes true for stages with a handler and explicit about returning `blocked`
for stages without one. `pva_check_staleness` says that staleness is not yet
computed rather than presenting an empty result as an answer.
`pva_plan_rerun`'s mode enum is corrected to `RerunMode`'s actual members.

## Testing

**The load-bearing test is an end-to-end pipeline run.** A fresh episode driven
from `brief` to `qa` entirely through the service, alternating claim/complete
for the six performer-less stages with dispatcher runs for the four handler
ones, asserting a single coherent journal at the end: every stage leased once,
started once, completed once, attempt numbers and lease ids consistent, replay
of the finished journal reproducing the final state.

Nothing in this repository has ever run a pipeline to completion. Every slice
so far has tested its own layer against fakes. If this design is right that
test passes; if the claim/complete seam is wrong, that test is where it shows,
and it will show as a journal that does not replay rather than as a subtly
weaker assertion.

Also required:

- **`run` is claim-then-complete:** the events `run` writes are identical to
  the events a `claim` followed by a `complete` writes, asserted on the journal
  rather than on which functions were called.
- **A lapsed claim cannot be completed.** Against a fake clock: claim, expire
  the lease, complete — refused, nothing appended. Then a second claimant takes
  the stage and completes it, and the journal still replays.
- **Two claimants race** on one stage: one gets `claimed`, the other `blocked`.
- **`status` agrees with `run`:** for a dependency that completed with a
  review outstanding, status does not report the dependent as runnable, and
  `run` blocks it — the same answer from both.
- **`rerun` refuses `rerun-affected-downstream`** by name, and accepts the
  three journal-derivable modes.
- **The single-stage route performs** for a handler stage and returns
  `blocked` naming the gap for one without, asserted on artifacts and journal
  rather than on the route returning 200.

## Scope

**In:** `claim`/`complete` on the service and `run` refactored through them;
`cmdRun`, `cmdComplete`, `cmdStatus`, `cmdRerun`; the status/run agreement fix;
the gateway's single-stage, status, claim and complete routes; deleting
`routes/runtime.ts`; `actionsFor` and the web's state vocabulary; the agent's
two new tools and its corrected descriptions.

**Out:** staleness and the fourth rerun mode (`avg-33r`); the attendance signal
that would make `script` and `compose` runnable (`avg-qr4.3`); capability
adapters for `terminal-recordings` and `narration`, and moving the four
handlers out of the gateway (`avg-qr4.4`); backfilling journals for the twenty
existing episodes (`avg-7he`).

**This is the slice that makes `avg-qr4.2`'s acceptance criterion literally
true.** Slices A and B shipped unused; C gave the service one production
caller. After this, the CLI, the browser and the agent produce the same
transitions and the same events, because they call the same two methods.

## Risks

**Refactoring `run` through `claim`/`complete` touches the newest, least
settled code in the repository.** `avg-2n7`'s seventeen re-pointed
gate-enforcement tests and the `/execute` end-to-end test are the net. A
failure there during this refactor is information about the seam, not a test
to adjust.

**`claimed` is a new `OutcomeStatus` member**, the third added in three slices
(`would-run`, `awaiting_review`, now `claimed`). `production.ts`'s loop is the
only exhaustive consumer; it must treat `claimed` as a halt, or a caller
looping until nothing advances would spin forever on a stage it claimed and
never completes.

**Claim/complete makes it possible to hold a stage and walk away.** The lease
TTL bounds it, but the default TTL was chosen for a synchronous dispatcher
that finishes in seconds, not for a Pi agent that may think for minutes. The
TTL for claims needs to be long enough for real agent work and short enough
that an abandoned claim clears within a working session; it should be
configurable and its default stated rather than inherited by accident.

**Deleting eight endpoints is irreversible from a consumer's point of view.**
They have no consumers in this repository, but nothing prevents an external
script from calling them. This is a pre-1.0 internal tool and the endpoints
are a duplicate of a surface that still exists, so the risk is judged
acceptable — recorded here so the judgment is visible rather than implied.
