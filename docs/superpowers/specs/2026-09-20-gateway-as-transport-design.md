# The gateway becomes transport

**Issue:** `avg-2n7` — Gateway becomes transport: stop producing artifacts, call the execution service
**Parent:** `avg-qr4.2` (slice C of five)
**Depends on:** `avg-tt7` (slice B — merged; the execution service)
**Source:** ADR-0027; `docs/harness-review.md`, P0 "Runtime invariants exist in modules but are bypassed by active paths"
**Date:** 2026-09-20
**Status:** approved design, not yet implemented

## The problem

ADR-0027 and the harness review both require the gateway to be transport.
`studio/gateway/src/runtime/executor.ts` still owns a hard-coded stage-name
registry, decides what runs and in what order, manages leases and gates, and
writes artifacts. `avg-qr4.1` removed the two handlers that fabricated their
results and made the dispatcher honour the gates the manifests declare, but the
orchestration stayed.

Slice B built the execution service that should own all of that. This slice
moves the gateway onto it. `runAutopilot` has exactly one consumer —
`studio/gateway/src/routes/production.ts:131` — so the blast radius is small.

## What a naive swap would silently break

Replacing the loop with a call to the service would drop **two** behaviours
`avg-qr4.1` shipped, not the one the issue names.

**1. The dependency review gate.** `blockingDependency`
(`executor.ts:395`) refuses a stage whose dependency has a gate-review state of
`requested` or `invalidated`. The execution service has no review gate at all —
deliberately, because `avg-qr4.3` is rewriting what an approval is and
inventing a third interpretation first is the mistake this epic exists to close.

**2. The acceptance gate.** Under `avg-qr4.1` a stage declaring `review: human`
ends `awaiting_approval` and never `completed`. The service has no such rule. I
ran the real pipeline through it: `script`, `terminal-recordings` and
`illustrations` all come back `completed` despite every one of them declaring
`review: human`.

The second is the dangerous one. `completed` is exactly what `dependenciesMet`
reads, so downstream stages would run on artifacts nobody accepted — the precise
failure `avg-qr4.1` existed to fix, reintroduced by the slice meant to
consolidate its work.

## Design

### 1. Completion and acceptance are different facts

The fix is to stop conflating them. **Completion is what happened; acceptance is
whether it counts.** The journal already records the first. `deriveGateState`
already answers the second.

So a `review: human` stage still writes `stage-completed` — that is true, it ran
and produced outputs — and its lease releases cleanly, which keeps replay's
model intact and avoids inventing a "done but unaccepted" status the journal has
no vocabulary for. What changes is the **dependency test**: a dependency is
satisfied when it completed *and* its review, if one is required, is not
outstanding.

That is `blockingDependency` generalised rather than replaced, and it is why the
port below needs only one question instead of two.

### 2. A third port: `ReviewGate`

```ts
interface ReviewGate {
  /** Outstanding means requested-but-not-granted, or invalidated. */
  isOutstanding(stageId: string, episodeDir: string): Promise<{ outstanding: boolean; reason?: string }>;
}
```

Injected alongside `StageDispatcher` and `BudgetGuard`. The gateway supplies one
backed by `deriveGateState` — the logic it already has, moved rather than
rewritten.

The service uses it in two places:

- **Dependency test.** A dependency that completed but whose review is
  outstanding does not satisfy its dependents. The outcome is `blocked`, with
  the reason naming the dependency and why.
- **Reporting.** When a stage the service just ran declares `review: human`, the
  outcome is `awaiting_review` rather than `completed`. The journal still says
  `stage-completed`; the outcome tells the caller the work is not accepted yet.
  This is a NEW word in the report, not one an existing consumer already
  understands. An earlier draft of this section justified it with "the web UI
  already renders an `awaiting_approval` state" — that claim is wrong twice
  over. `studio/web/src/contracts/gateway.ts` spells the stage status
  `awaiting_approval`, not `awaiting_review`, so the strings do not match; and
  nothing currently reads the `/execute` report at all, so no consumer is
  validating either spelling. Nothing breaks today, but the compatibility was
  asserted rather than verified, and reconciling the two vocabularies is
  outstanding work, not a settled fact.

  In the same vein: the gateway's old `StageResult` had a third status,
  `skipped`, which `runAutopilot` emitted for a stage it declined to run.
  `OutcomeStatus` has no such member and the service never emits one — a stage
  that does not run is `blocked`, with a reason. `skipped` survives only in
  `studio/gateway/src/contracts/types.ts` and the web contract, where it is now
  unreachable from `/execute`.

**An absent gate refuses only where a review is declared.** The service already
reads each stage's `gates` from the manifest. If a stage in the dependency chain
declares `review: human` and no `ReviewGate` was injected, the service cannot
know whether that review happened, so it refuses. If nothing in the chain
declares a review, no gate is needed and it proceeds.

This deliberately differs from the other two ports, where absence is refusal
flatly. The asymmetry is the point: making every caller inject a gate to run an
ungated pipeline turns a safety feature into boilerplate, and boilerplate
invites a permissive stub that defeats it. Refusing exactly where something is
being protected keeps the guarantee without the ceremony. It is a conditional
rule rather than a flat one, so it needs saying plainly in the code and a test
for both halves.

### 3. What the gateway keeps, and what it loses

**Deleted from `executor.ts`:** `runAutopilot`'s loop, the `HANDLERS` registry,
the gate evaluation, the lease handling, `blockingDependency`, `readJournal`,
`requestReview`, `validateOutputs`, and the stage-selection logic. All of it now
lives in the service.

**Kept, as injected collaborators:**

- A `StageDispatcher` wrapping the four surviving handlers —
  `handleIllustrations`, `handleCaptions`, `handleTiming`, `handleQa`. They keep
  doing the work; they stop deciding when.
- A `ReviewGate` backed by `deriveGateState`.

**`production.ts`** gains the loop: call `run()` until it returns something
other than `completed`, and assemble a report shaped like today's so the web UI
is unaffected. The `dryRun` branch stops shelling out to the runtime CLI and
calls the service's dry run instead.

### 4. The gateway still writes files, and that is not this slice

After this change the gateway no longer owns execution *semantics* — what runs,
when, whether it counted. It still contains handlers that write artifacts, which
ADR-0027's "never produces artifacts" does not literally permit.

That is deliberate. The handlers' real home is `avg-qr4.4`'s capability
adapters, which does not exist yet. Relocating them now would decide where
capability work lives before the issue that designs it, which is the same
premature interpretation that produced the three-way split in the first place.
The gateway stops orchestrating in this slice and stops touching files when
`qr4.4` lands.

### 5. Not in scope: streaming

The issue says the gateway "streams its events". There is no event stream in the
gateway today — no websocket broadcast, no SSE — and the execute route is plain
request/response. Building one is separate work, and naming that is better than
quietly not doing it. The route stays synchronous and returns a report.

## Testing

**The real risk is the 17 tests, not the code.** `gate-enforcement.test.ts`
encodes `avg-qr4.1`'s behaviour against `runAutopilot`. Deleting that function
means re-pointing all seventeen at the new composition. The danger is not that
they fail — it is that they get weakened in translation and quietly stop proving
what they proved.

Every one must survive with its assertion intact:

```
blocks a stage the manifest says may not run unattended
never writes a safety report for an episode it did not read
blocks a gated stage that has no checker behind it
leaves a human-reviewed stage awaiting approval, not completed
never emits an approval of its own
stops the run at the first unaccepted stage
blocks rather than guessing a stage has no gates
does not run the handler of a stage whose gates it could not read
fails a stage that produced nothing
fails a stage whose output is an empty file
counts blocked and awaiting stages so a halt cannot read as a finish
does not report completion when the runtime never resolved a stage
blocks a stage whose dependency is still awaiting review
lets the stage run once that dependency is approved
blocks when the dependency's approval no longer matches what is on disk
keeps a halt at a review gate across the next execute
cannot produce a pass with no render present
```

A reviewer should compare each against its original rather than check that the
file is green. Where a test can no longer be expressed against the new
composition, that is a finding about the design, not a test to drop.

New coverage this slice needs:

- The `ReviewGate` port: outstanding dependency blocks; approved dependency
  proceeds; invalidated dependency blocks.
- Absent gate, both halves: a pipeline declaring a review refuses; a pipeline
  declaring none proceeds.
- A `review: human` stage reports `awaiting_review` while its journal still
  records `stage-completed`.
- The gateway's dispatcher performs the same work the handlers did, asserted on
  the artifacts produced rather than on the dispatcher being called.

## Scope

**In:** the `ReviewGate` port and its two uses; deleting `runAutopilot` and its
supporting machinery; the gateway's dispatcher and review gate; the loop in
`production.ts`; re-pointing the 17 tests.

**Out:** moving the handlers out of the gateway (`avg-qr4.4`); event streaming;
the CLI and agent (`avg-grf`); candidates and atomic selection (`avg-33r`).

**This slice finally gives the execution service a production caller.** The two
before it shipped unused. After this, the gateway's `/execute` runs through the
service, which means any defect in slices A or B stops being theoretical — worth
saying plainly, because it changes how carefully this one should be reviewed.

## Risks

**Re-pointing 17 tests is where this goes wrong.** They encode behaviour bought
with a whole branch. A test that passes after translation but asserts less than
it did is indistinguishable from success at merge time and invisible afterwards.

**The absent-gate rule is conditional**, which makes it easier to get subtly
wrong than a flat rule. Both halves need a test, and the condition needs stating
in the code where someone changing it will read it.

**`awaiting_review` is a new outcome status.** `OutcomeStatus` already gained
`would-run` in the previous slice. I checked for consumers that switch on it
exhaustively and there are none — the type is referenced only by the two export
barrels, and `production.ts` still reads `runAutopilot`'s own `StageResult`
rather than the service's. So the addition is safe today, and `production.ts`
becomes its first real consumer in this very slice, which is the moment to get
its handling of all five members right.

**The `/execute` route's `ok` field** currently means "nothing failed". With the
service reporting `awaiting_review`, a run that halts for acceptance returns
`ok: true` with no completed stages. That matches the decision made in
`avg-qr4.1` and should stay, but the summary must count awaiting and blocked
stages so a caller cannot read a halt as a finish.
