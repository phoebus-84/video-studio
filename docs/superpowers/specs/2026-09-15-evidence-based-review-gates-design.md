# Evidence-based review gates

**Issue:** `avg-qr4.1` — Make review gates evidence-based and fail closed
**Source:** `docs/harness-review.md`, P0 "Reviews can be fabricated by the implementation"
**Date:** 2026-09-15
**Status:** approved design, not yet implemented

## The problem

`studio/gateway/src/runtime/executor.ts` contains two stage handlers that invent
their own results.

`handleSafetyReview` writes findings about a wolf eating characters, a
moderate scariness rating and a parental-guidance note. `handleContinuityCheck`
writes `scenes: 8` and four passing checks — character consistency, colour
palette, lighting continuity, background elements. Neither function opens a
single file belonging to the episode it is reporting on. Both are literals.
Every episode that runs either stage receives the same text, so an episode with
no wolf in it gets the wolf report.

The dispatcher then marks any handler that returned without throwing as
`completed`, including a handler that returned no outputs at all. A report file
exists on disk afterwards, and nothing downstream can tell that nobody looked at
anything.

Three separate failures are tangled here, and the fix has to address all three:

1. **Fabricated content.** The findings are hard-coded.
2. **Ignored gates.** `studio/pipelines/pipelines/fairy-tale-adaptation.yaml`
   declares `safety-review` with `gates: { autopilot: false, review: human }`.
   The executor runs it in autopilot regardless. Nothing in `studio/` or
   `packages/` reads `gates.autopilot` — the field is parsed by
   `studio/runtime/src/pipeline/fs-loader.ts` into a typed property that no code
   consumes.
3. **Completion by absence of error.** A handler that produces nothing is
   reported as having completed.

The same class of bug was already fixed once in this file. `handleQa` used to
look for `artifacts/render/final.mp4`, a path nothing writes, never find it,
fall into a fallback and emit a `warn` verdict with an empty check list — "a
report about nothing, indistinguishable from one about a video that had
problems," as the comment there now says. That fix is the precedent this design
follows; the two review handlers are the same bug, unfixed.

## What already exists

The pieces needed to do this properly are present and unused.

- `studio/runtime/src/policy/gates.ts` has `checkGate`, `checkGates`,
  `PolicyError` and a `hard` flag on `PolicyGate`.
- `studio/contracts/src/journal.mjs` is an append-only event log with
  `approval-requested`, `approval-granted` and `attempt-recorded` already in
  `JOURNAL_EVENTS`. The executor imports this module but only writes
  stage-started, stage-completed and stage-failed.
- `studio/gateway/src/contracts/types.ts` already defines `StageStatus` with
  `awaiting_approval`, and `EpisodeStatus` with `awaiting_review` and `blocked`.
- `studio/web/src/lib/episode-types.ts` already renders those states, with
  labels "Approval" and "Blocked" in `STAGE_LABELS`.

So the vocabulary for an honest answer exists at every layer. Only the executor
is impoverished: its local `StageResult.status` is `completed | failed |
skipped`, which offers no way to say "ran, but not accepted."

`grep` for `review_required` across the repo returns nothing. Rather than
introduce a fourth spelling, this design reuses `blocked` and
`awaiting_approval`, which the UI already understands.

## Design

### 1. A gate-review contract in `@studio/contracts`

Two new files, placed in contracts rather than the gateway because `avg-qr4.2`
will replace the gateway executor and this must outlive it.

`schemas/v1alpha1/gate-review.schema.json` defines the `detail` payload carried
by the journal's existing `approval-requested` and `approval-granted` events:

```
stageId   string
decision  "requested" | "approved"
actor     pi | gateway | runtime | human | system   (reuses JOURNAL_ACTORS)
at        ISO-8601
inputs    [{ path, sha256 }]    paths relative to the episode directory
outputs   [{ path, sha256 }]
checks    [{ id, name, status, expected, actual, evidence }]
note      string, optional
```

`checks` may be empty on a `requested` record — asking for a review of
`illustrations` involves no checks to report. It carries the checks actually
performed on an `approved` one; QA, for instance, contributes the checks from
its ffprobe suite.

There is deliberately no `rejected` decision. `JOURNAL_EVENTS` has no
`approval-rejected` type, and encoding a rejection inside an
`approval-granted` event would be a contradiction on disk. Adding the event
type belongs with `avg-qr4.3`, which owns the approval flow; until then a
stage that is not approved simply stays `requested`, which already fails
closed.

`src/gate-review.mjs` provides three functions:

- **`hashArtifacts(episodeDir, paths)`** — sha256 over file bytes. A missing or
  zero-byte file throws. It never substitutes a placeholder hash, because a
  record that hashes an absent file is the same lie in a new format.
- **`buildGateReview({ stageId, decision, actor, inputs, outputs, checks, note })`**
  — shapes and validates the detail payload without writing it, mirroring how
  `buildJournalEvent` separates shaping from appending.
- **`deriveGateState(events, stageId, episodeDir)`** — the current review state
  of a stage.

### 2. Invalidation by re-hashing, not by watching

`deriveGateState` replays the journal, takes the most recent
`approval-granted` for the stage, then **re-reads the named files from disk and
re-hashes them**. Recorded hashes match what is on disk now → `approved`. Any
mismatch, or any named file now missing → `invalidated`.

This is the whole of "changing a reviewed artifact invalidates the review."
There is no watcher, no cache, no staleness daemon and no invalidation bookkeeping
to get wrong. The comparison is a fresh read at the moment of asking, so a
record that was forged, copied from another episode, or simply outrun by a
re-render cannot survive being checked.

Return values: `none` (no review requested), `requested`, `approved`,
`invalidated`.

### 3. Delete the fabricating handlers

`handleSafetyReview` (executor.ts:46–66) and `handleContinuityCheck`
(executor.ts:187–205) are deleted, along with their entries in `HANDLERS`.
Not stubbed and not put behind a flag — deleted. Neither function ever read the
episode, so there is no behaviour worth preserving.

The wolf findings move to a test fixture, where their only job is to assert they
can never again reach a production artifact.

`safety-report.json` and `continuity-report.json` stay declared as stage outputs
in the pipeline manifests. Nothing writes them now. The stages stop with review
required until a real reviewer — human, or the agent path under `avg-qr4.2` —
produces them. That is the intended end state, not a gap left behind.

### 4. Two gates, enforced separately

The pipeline manifests declare two different things, and collapsing them loses
information:

- **`autopilot: false` gates execution.** The stage may not run unattended.
- **`review: human` gates acceptance.** The stage may run, but its output is a
  candidate, not an accepted result.

`StageResult.status` widens to `completed | failed | skipped | blocked |
awaiting_approval`, reusing the two names the UI already renders.

Evaluated per stage, in order:

1. `autopilot: false` → does not run. Status `blocked`, emit
   `approval-requested`, stop the run.
2. No handler registered **and** the stage is gated → `blocked`, not today's
   `skipped`. For an ungated stage `skipped` stays correct; for a gated one,
   "no handler registered" reads as a shrug where a refusal belongs.
3. Handler runs → validate the outputs the manifest *declares*: each must exist
   and be non-empty. An empty return, a missing file or a zero-byte file →
   `failed`. This closes "the dispatcher labels successful handler returns
   completed, even when a handler returns an empty output list."
4. `review: human` → `awaiting_approval`, emitting `approval-requested` with
   input and output hashes. Never `completed`.
5. `review: none` → `completed`, but only after step 3 has validated the outputs.

Gates are read from the pipeline manifest through the existing
`@studio/pipelines` loader. No new parser.

**The run stops at the first stage that ends `blocked` or `awaiting_approval`**,
exactly as it already stops on `failed`. Continuing would mean handing a later
stage an artifact that no one has accepted, which is the same failure this issue
is about, one stage downstream: `continuity-check` consuming illustrations that
were never reviewed is not better than `continuity-check` inventing its verdict.

This is stricter than it needs to be in principle — a stage on an independent
branch of the dependency graph could legitimately keep running. Doing that well
requires the dependency-aware scheduler in `avg-qr4.2`, and guessing at it here
with the current linear "ask the runtime for the next stage" loop would produce
exactly the sort of second state machine the harness review warns against.
Stopping is the fail-closed choice and is trivially correct.

Applied to the six stages that currently have handlers:

| stage | autopilot | review | result under this design |
|---|---|---|---|
| `safety-review` | false | human | `blocked` — handler deleted, execution gated |
| `continuity-check` | true | human | `blocked` — handler deleted, no checker exists |
| `illustrations` | true | human | runs, `awaiting_approval` |
| `captions` | true | none | runs, `completed` if outputs validate |
| `timing` | true | none | runs, `completed` if outputs validate |
| `qa` | true | human | runs real checks, `awaiting_approval` |

### 5. The gateway does not mint approvals

The executor emits `approval-requested` and never `approval-granted`.

Authenticated, revision-bound approval receipts are `avg-qr4.3`. Until that
lands, the only way a stage reaches `approved` is a `approval-granted` event
written by something other than this executor. The gateway can ask for an
approval; it cannot answer its own question.

### 6. Run summary

`POST /api/.../execute` in `studio/gateway/src/routes/production.ts:140`
currently returns `ok: report.stages.filter(s => s.status === "failed").length === 0`.
A run that is entirely blocked awaiting review would return `ok: true`.

`ok` keeps meaning "nothing failed" — a halt at a review gate is not a failure.
But `ExecutionReport.summary` gains counts of `blocked` and `awaiting_approval`
stages, so a caller cannot read a halted run as a finished one.

## Testing

Test-driven: each test written and seen to fail before the code that satisfies
it.

**The acceptance criteria, as tests:**

- An unrelated episode — not the fairy tale — runs autopilot; assert no
  `safety-report.json` is produced and that the string "wolf" appears in no
  produced artifact.
- `HANDLERS` contains no `safety-review` or `continuity-check` key. Fails loudly
  if either is ever reintroduced.
- A stage with `autopilot: false` yields `blocked` and an `approval-requested`
  event in the journal.
- A stage with `review: human` yields `awaiting_approval` and never `completed`.
- A handler returning `[]`, a declared output that is missing, and a declared
  output that is zero bytes each yield `failed`.
- Approve a stage, mutate one byte of a reviewed artifact, assert
  `deriveGateState` returns `invalidated`.
- With `@av/video-composer` failing to import, and with no render present, QA
  cannot produce a pass.

**Files:** `studio/gateway/test/runtime-executor.test.ts` (extended — it is 24
lines today, with one test), a new `studio/gateway/test/gate-enforcement.test.ts`,
and contracts-level tests for `hashArtifacts` and `deriveGateState`.

## Scope

**In:** deleting the two fabricating handlers; the gate-review contract and its
schema; hash-based invalidation; two-gate enforcement in the dispatcher; output
validation; the tests above.

**Out, and deliberately so:**

- Real safety and continuity checkers. A genuine safety review needs a model
  call over the script and a genuine continuity check needs image analysis
  across illustrations. Both need adapter and paid-call decisions that belong
  with the capability path.
- Authenticated approval receipts — `avg-qr4.3`.
- The unified execution service that replaces this executor — `avg-qr4.2`.
- Formalising media-aware artifacts and QA evidence generally — `avg-qr4.8`.

## Files

| file | change |
|---|---|
| `studio/contracts/schemas/v1alpha1/gate-review.schema.json` | new |
| `studio/contracts/src/gate-review.mjs` | new |
| `studio/gateway/src/runtime/executor.ts` | delete two handlers; widen status; gate enforcement; output validation; summary |
| `studio/gateway/test/runtime-executor.test.ts` | extended |
| `studio/gateway/test/gate-enforcement.test.ts` | new |
| `studio/contracts/test/gate-review.test.mjs` | new |

## Risks

**Autopilot halts earlier than it does today.** `safety-review` and
`continuity-check` stop the run instead of writing a fake pass, and
`illustrations` and `qa` end at `awaiting_approval` rather than `completed`. A
demo that appeared to run end-to-end will now visibly stop. That is the point of
the change, but it will look like a regression to anyone expecting the old
output, so it belongs in the commit message and the issue's closing note.

In practice the blast radius is smaller than it appears: `HANDLERS` has entries
for only six stages, and the executor already stops at any stage without a
handler. `script` and `compose` both declare `autopilot: false` and have no
handler, so autopilot already halts there — this change replaces the
uninformative "no handler registered" with an honest "blocked, approval
requested."
