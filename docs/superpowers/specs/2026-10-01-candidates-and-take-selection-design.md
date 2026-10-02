# Candidates and atomic take selection

**Issue:** `avg-qr4.6` — candidates and atomic take selection (the rest of `avg-33r`)
**Related:** ADR-0021 (generated media is immutable), ADR-0027; the
[authenticated approval design](2026-09-24-authenticated-revision-bound-approval-design.md),
which absorbed `avg-33r`'s staleness third and left this one; the
[harness review](../../harness-review.md), P0 "Runtime invariants…" and P1
"Human direction must be durable production data".
**Date:** 2026-10-01

## Problem

The execution service records an attempt as `stage-completed` with the paths it
wrote, and the stage's outputs are whatever its **last** completion wrote. A
performer writes those paths in place: `artifacts/script.md`,
`output/output.mp4`. So:

1. **A rerun destroys the take it replaces.** ADR-0021 says every generated
   result is an immutable attempt and selection is a small pointer. Nothing
   implements either half. `attempts/` is named in the layout contract,
   created by workspace init, and has never been written to.
2. **There is no selection, only recency.** "Which take counts" is answered by
   "whichever ran last". Going back to an earlier take means running the stage
   again and hoping.
3. **Nothing protects a person's choice.** An operator who settles on a take
   has no way to say so; the next automatic rerun replaces it. The harness
   review's acceptance: "a person can change the camera in Blender and resume
   without the agent overwriting it"; "stale worker results cannot replace
   newer selected takes"; "two sessions cannot select conflicting outputs".

## Design

### Candidates

When `complete()` accepts an attempt's outputs, the service now also:

- expands each output into the files it names (a directory output becomes every
  file under it) and hashes them;
- copies those files to `attempts/<stageId>/<attemptNumber>/<path>` — a
  reflink where the filesystem supports one, a copy otherwise — and makes the
  copies read-only. The copy lands in a temporary directory that is renamed
  into place, so a candidate is either whole or absent;
- records the hashes on the `stage-completed` event as `digests`.

A completion with `digests` is a **candidate**. The bytes are kept: a later
attempt cannot destroy them, and the hashes say whether anyone has.

A completion that cannot be preserved is a failed attempt. Recording a
candidate whose bytes are not kept would be the same claim without the
evidence.

Completions written before this change carry no `digests`. They remain what
they were — the stage's take, with no preserved copy — and cannot be selected
again, because there is nothing to restore.

### Selection is a journal record

A stage's **selected take** is decided by the journal, like every other piece
of execution state:

- `stage-completed` selects its own candidate unless it says `selected: false`;
- `take-selected` selects an earlier candidate explicitly.

A `take-selected` record has the shape of a review record, `decision:
"selected"`, with the attempt and its hashes in `binding`. That is deliberate:
an operator's selection is signed with the operator key by the same
`signReceipt` that signs an approval (`SIGNED_FIELDS` already covers `stageId`,
`decision`, `origin`, `binding`, `at` and `episode`), and a selection retyped
as `approval-granted` reads as tampered, because the type no longer implies the
decision.

`deriveTakes(events, stageIds, { key, episode })` replays the candidates and the
current selection of each stage. It is a separate function rather than a branch
of `deriveExecutionState`: which take is selected never changes whether a stage
ran, and keeping execution replay unchanged keeps every existing journal
meaning what it meant.

### Selecting is atomic

`ExecutionService.select(ref, pipeline, stageId, { attemptNumber, expected,
principal })`:

1. takes the stage's lock — the same `stage:<id>` lock a running attempt holds
   for its lease and `review()` takes — so a selection cannot interleave with
   an attempt or a decision on the same stage;
2. re-reads the journal **under the lock**;
3. refuses when `expected` is given and the selected take is no longer the one
   the caller saw. This is the compare-and-swap that keeps two sessions from
   selecting conflicting takes: the second is told what changed rather than
   silently winning;
4. refuses an agent replacing a take the operator selected;
5. verifies that every preserved file still hashes as recorded, before touching
   anything;
6. materializes the take: each file is copied next to its canonical path and
   renamed over it, and files of the displaced take that the incoming one does
   not have are removed;
7. appends `take-selected`, then — for a stage that declares a review — an
   `approval-requested` naming the newly selected bytes, still under the lock
   (the same ordering `complete()` uses, so a request can never bury an
   operator's grant).

After the lock is released, a change of take marks the stage's dependents stale.
Staleness explains why; the review gate's re-hash still decides whether a
dependent's approval stands.

The journal append is the commit point. Materializing before appending means a
crash between the two leaves the files ahead of the record. `takes()` reports
that as **drift**, and selecting the recorded take again restores it.

### An operator's selection is a lock

A take the operator selected (origin `human`, signature verified) is
**locked**. When a later attempt completes, its outputs are kept as a candidate
with `selected: false`, the locked take's files are restored over what the
performer wrote, and no review request is written, because the selected take did
not change. An agent may still produce and select candidates — that is guided
mode working — but it cannot displace the operator's take.

A composition that cannot verify a signature, such as a CLI without the
operator key, treats an operator selection as locked. It fails closed, because
the alternative lets an unattended rerun overwrite exactly the take the lock
exists to protect. A forged lock can only make things stricter. A signature
that does not verify under the key is not a lock.

### What callers see

- `status()` reports each stage's `take`: attempt number, origin, and whether
  it is locked.
- `takes(ref, pipeline)` lists each stage's candidates, its selected take, and
  any drift between the selected take's hashes and the files on disk.
  Hashing happens here and not in `status()`, which is polled.
- A new outcome status, `selected`.
- `review()` binds a decision to the selected take's files, not to whatever the
  latest attempt reported.

Surfaces:

- the CLI: `vpr takes <episode>` and
  `vpr select <episode> <stage> <attempt> [--expect <n|none>]`;
- the gateway: `GET …/episodes/:episode/takes` and
  `POST …/stages/:stage/select`;
- the principal comes from the credential, exactly as for `approve`.

## Tests

- **contracts:**
  - `deriveTakes`: legacy completions, candidates, implicit and explicit
    selection, `selected: false`, lock verification with and without a key and
    for the wrong episode;
  - the builder's refusals;
  - the new schema definitions, against valid and invalid fixtures.
- **runtime:**
  - a completion preserves its candidate read-only and records digests;
  - a directory output expands to its files;
  - a rerun keeps the earlier take;
  - selecting it restores its bytes and removes files only the displaced take
    had;
  - a stale `expected` is refused;
  - an agent cannot displace an operator's take;
  - a completion under a lock is kept as a candidate and the locked bytes are
    restored;
  - a tampered candidate is refused before anything is written;
  - selection while a lease is live is refused;
  - selection marks dependents stale;
  - `takes()` reports drift.
- **CLI and gateway:** each route and command, through to the journal.

## Out of scope, as follow-ups

- **Retention.** Candidates accumulate. Pruning is a policy question:
  unselected, unapproved, older than N. It is ADR-0021's "explicit later
  policy".
- **Per-shot and per-asset takes.** This is stage granularity. The asset
  manifest's `selected` flag, set by `routes/assets.ts`, remains a separate
  pointer for scene assets; unifying the two belongs with the shot contract
  (harness review, step 3).
- **A selection UI.** The web studio shows the take in status but offers no
  comparison or selection yet (harness review, step 4).
- **Pi tools for takes.** Pi can select through the gateway route as an agent;
  dedicated `pva_*` tools come with guided mode.
- **A performer that reports a directory gets its leftovers.** A candidate is
  every file under a reported directory. When an earlier take left more files
  there than this attempt wrote, those files are part of this candidate too:
  nothing can tell them apart. A performer that names the files it wrote, as
  `illustrations-from-assets` does, gets exactly those, and a displaced take's
  extra files are removed.
- **Performers writing into the attempt directory directly.** Performers still
  write canonical paths, and the service copies afterwards. Writing a candidate
  in place would remove the copy, and the window in which an attempt's files
  sit at canonical paths before they are accepted. It needs every performer to
  change.
