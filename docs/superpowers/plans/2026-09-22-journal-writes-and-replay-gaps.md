# Journal Writes and Replay Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a lost journal event survivable and visible instead of fatal and silent, and stop a malformed event from looking like a full disk.

**Architecture:** Four independent changes in dependency order. Replay learns to record a missing `stage-started` rather than throw — without widening the transition table, which stays pinned equal to the engine's. `appendJournalEvent` splits its two faults: a malformed event throws, an unwritable journal still returns `null`. The execution service checks the one append it does not check today. `status()` surfaces the gap so an operator sees it.

**Tech Stack:** `@studio/contracts` is ESM `.mjs` with hand-written `.d.mts` siblings, tested with `node --test`. `@studio/runtime` is TypeScript tested with vitest.

**Spec:** `docs/superpowers/specs/2026-09-22-journal-writes-and-replay-gaps-design.md`

## Global Constraints

- **The transition tables must stay byte-identical.** `studio/runtime/test/unit/engine/transition-table-agreement.test.ts` must pass **unchanged**. Do not edit it, and do not add members to `VALID_TRANSITIONS` in either `studio/contracts/src/execution-state.mjs` or `studio/runtime/src/engine/types.ts`. The whole point of Task 1 is that the tolerance is NOT bought by widening the table.
- **`@studio/contracts` has no build step and no TypeScript.** Source is `.mjs`; every exported symbol has a hand-written declaration in the matching `.d.mts`. A change to one without the other is incomplete.
- **Test commands, exactly.** contracts: `npm test -w studio/contracts` (node --test). runtime: `npm test -w studio/runtime` — this has a `pretest` that runs the build. **Never** verify runtime work with a bare `npx vitest`: `test/integration/cli.test.ts` spawns `dist/`, so a bare vitest run passes against stale compiled output and will hide a real break.
- **`@studio/runtime` has no `typecheck` script.** Use `npx tsc --noEmit -p studio/runtime/tsconfig.json` from the repo root.
- **No bare angle brackets in prose in any `docs/` markdown.** VitePress compiles every docs file as a Vue SFC, so a bare `<word>` outside a code fence or backticks fails the docs build. Wrap in backticks.
- **The never-throw promise still covers the write.** After Task 2, a journal that cannot be written still returns `null`. Only a malformed event throws.
- `library/` is gitignored production data. No task in this plan touches it.

---

### Task 1: Replay records a missing `stage-started` instead of throwing

**Files:**
- Modify: `studio/contracts/src/execution-state.mjs` (add a helper near `closeIfExpired` at :97; call it in the terminal-event switch at :183)
- Modify: `studio/contracts/src/execution-state.d.mts:5-16` (`StageAttempt`)
- Test: `studio/contracts/test/execution-state.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `StageAttempt.startRecorded?: boolean` — present and `false` only on an attempt whose `stage-started` never landed; **absent entirely** otherwise. Task 4 reads this field.

**Context for the implementer:** `deriveExecutionState(events, stageIds, now)` folds a journal into a `Map` of stage id to instance. A `stage-leased` event pushes a new attempt and moves the stage to `pending`; `stage-started` moves it to `running`; a terminal event (`stage-completed`, `stage-failed`, `attempt-recorded`) closes it. All status changes go through the module-private `transition(instance, to, because)` at :72, which throws when `VALID_TRANSITIONS[from]` does not list `to`.

`VALID_TRANSITIONS` has `pending: ["running"]` and `running: ["completed", "failed"]`. There is no `pending -> completed`. So when a `stage-started` is missing from the log, the terminal event throws — and since the journal is append-only, it throws on **every future replay**, permanently. That is the bug.

The fix is to detect that exact situation and pass through `running` first, recording that the start was never seen. `pending -> running` is already legal, so the synthesized step uses the same `transition` call the healthy path uses. **Do not add `pending: [... "completed"]` to the table.**

- [ ] **Step 1: Write the failing tests**

Add to `studio/contracts/test/execution-state.test.mjs`, inside the existing `describe("deriveExecutionState", ...)` block. The helpers `evt`, `lease`, `ref` and `NOW` already exist at the top of that file — do not redefine them.

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w studio/contracts`

Expected: the first three fail with `Stage "brief" cannot go from pending to completed` (and `... to failed`). `leaves no marker on a healthy attempt` and `still refuses a terminal event whose lease opened no attempt` should PASS already — they pin behaviour that must not change.

- [ ] **Step 3: Add the helper to `studio/contracts/src/execution-state.mjs`**

Insert immediately after `closeIfExpired` (which ends at :104), before the `deriveExecutionState` doc comment:

```js
/**
 * A terminal event has arrived for an attempt that never recorded its start.
 *
 * The `stage-started` write was lost — the journal is append-only, so it can
 * never be added, and refusing here would throw on every future replay of this
 * episode rather than only this one. That is not failing closed, it is failing
 * dead: `status`, `run`, `claim` and `complete` would all be permanently
 * unavailable for the episode because one write did not land.
 *
 * So the attempt passes through `running` — a transition the table already
 * allows — and carries `startRecorded: false` to say the step was inferred
 * rather than witnessed. The marker is absent on a healthy attempt: it exists
 * to mark the exception, not to annotate the rule.
 *
 * This is the same argument the table comment above makes for
 * `completed -> pending`, applied to the case it did not reach. Note what is
 * NOT done here: `pending -> completed` is not added to VALID_TRANSITIONS. The
 * table still describes what a healthy run may do, and this records that this
 * run was not healthy.
 */
function noteMissingStart(instance, attempt) {
  if (instance.status !== "pending") return;
  attempt.startRecorded = false;
  transition(instance, "running", "the attempt started, unrecorded");
}
```

- [ ] **Step 4: Call it before each terminal case**

In `deriveExecutionState`'s event switch (currently at :183), add one call before the three terminal cases. The `stage-started` case is untouched. Replace the switch's opening with:

```js
    switch (event.type) {
      case "stage-started":
        transition(instance, "running", "the attempt started");
        break;
      case "stage-completed":
        noteMissingStart(instance, attempt);
        transition(instance, "completed", "the attempt completed");
        attempt.endedAt = event.at;
        attempt.outcome = "success";
        instance.outputArtifacts = data.outputs ?? [];
        break;
      case "stage-failed":
        noteMissingStart(instance, attempt);
        transition(instance, "failed", "the attempt failed");
        attempt.endedAt = event.at;
        attempt.outcome = "failure";
        attempt.error = data.error;
        attempt.retryable = data.retryable;
        break;
      case "attempt-recorded":
        noteMissingStart(instance, attempt);
        transition(instance, OUTCOME_STATUS[data.outcome], "the attempt was recorded");
        attempt.endedAt = event.at;
        attempt.outcome = data.outcome;
        if (data.outputs) instance.outputArtifacts = data.outputs;
        break;
    }
```

- [ ] **Step 5: Declare the field in `studio/contracts/src/execution-state.d.mts`**

Replace the `StageAttempt` interface at :5-16 with:

```ts
export interface StageAttempt {
  number: number;
  leaseId: string;
  startedAt: string;
  endedAt?: string;
  outcome?: "success" | "failure" | "timeout";
  error?: string;
  retryable?: boolean;
  ttlMs?: number;
  expiresAt?: string;
  holder?: string;
  /**
   * `false` when this attempt's `stage-started` event never landed and replay
   * inferred the step from the terminal event that followed it. Absent on a
   * healthy attempt — the field marks the exception, not the rule.
   *
   * Says whether one specific event was recorded, and nothing else. It is not
   * a health score for the attempt; `outcome` already says how it ended.
   */
  startRecorded?: boolean;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -w studio/contracts`
Expected: PASS, 121 tests (116 before, 5 added).

- [ ] **Step 7: Verify the transition table was not widened**

Run: `npm test -w studio/runtime 2>&1 | tail -5`
Expected: PASS. `transition-table-agreement.test.ts` must be green **without having been edited**. Confirm with `git status --porcelain` that neither that test nor either `VALID_TRANSITIONS` appears in your changes:

```bash
git diff --name-only | grep -E "transition-table-agreement|engine/types.ts" && echo "CONSTRAINT VIOLATED" || echo "ok"
```

Expected: `ok`.

- [ ] **Step 8: Commit**

```bash
git add studio/contracts/src/execution-state.mjs studio/contracts/src/execution-state.d.mts studio/contracts/test/execution-state.test.mjs
git commit -m "fix(contracts): record a missing stage-started instead of throwing forever"
```

---

### Task 2: A malformed event throws; an unwritable journal still returns null

**Files:**
- Modify: `studio/contracts/src/journal.mjs:172-197` (`appendJournalEvent`)
- Modify: `studio/contracts/src/journal.d.mts:57-61`
- Test: `studio/contracts/test/journal.test.mjs:167-174`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `appendJournalEvent(episodeDir, input): Promise<JournalEvent | null>` — unchanged signature. It now **throws** whatever `buildJournalEvent` throws, and still resolves to `null` when the filesystem refuses the write.

**Context for the implementer:** `appendJournalEvent` currently wraps two separate operations in two `try`/`catch` blocks that both `return null`. The first wraps `buildJournalEvent(input)`, which throws for an unknown event type, an unknown actor, a missing `episode.channel`/`series`/`episode`, a non-object `data`, or a missing required execution field. The second wraps `mkdir` + `appendFile`.

Those are different faults. The first is a code bug: deterministic, identical on retry, fixable only by changing the caller. The second is operational. Returning the same `null` for both means an operator sees `the journal write did not land` for a bug and retries it forever.

The function's doc comment justifies never throwing with "a stage that ran must not be reported as failed because its bookkeeping could not be written". That reasoning is about the write, and it survives. A malformed event is not bookkeeping that could not be written; it is bookkeeping that was never valid.

- [ ] **Step 1: Invert the existing contract test**

In `studio/contracts/test/journal.test.mjs`, replace the test at :167-174 with:

```js
  it("throws when the event is malformed", async () => {
    // Two faults used to return the same null: an event the caller built
    // wrong, and a journal the filesystem would not write. The first is a code
    // bug — deterministic, identical on every retry — and surfacing it as
    // "the write did not land" invites an operator to retry it forever.
    //
    // The never-throw promise below is unchanged, because it was always about
    // the write: a stage that RAN must not be reported failed because its
    // bookkeeping could not be written. A malformed event is not bookkeeping
    // that could not be written; it was never valid.
    await assert.rejects(
      appendJournalEvent(dir, { type: "nonsense", actor: "pi", episode: ref }),
      /Unknown journal event type/,
    );
  });

  it("throws when an execution event is missing the fields replay needs", async () => {
    await assert.rejects(
      appendJournalEvent(dir, { type: "stage-completed", actor: "runtime", episode: ref,
        data: { stageId: "s", leaseId: "L1", attemptNumber: 1 } }),
      /must carry outputs/,
    );
  });
```

Leave the next test, `reports rather than throws when the journal cannot be written`, exactly as it is. It pins the half of the contract that does not change.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npm test -w studio/contracts`
Expected: both new tests FAIL — `appendJournalEvent` resolves to `null` instead of rejecting.

- [ ] **Step 3: Split the two faults in `studio/contracts/src/journal.mjs`**

Replace the doc comment and body at :172-197 with:

```js
/**
 * Append one event to an episode's journal.
 *
 * A single `appendFile` of one line: concurrent writers interleave whole
 * records rather than corrupting each other, which is the property that makes
 * JSONL worth using here.
 *
 * Two different faults, deliberately reported two different ways.
 *
 * A malformed event THROWS. The caller built something invalid — an unknown
 * type or actor, a missing episode field, an execution event without the ids
 * replay needs — and that is a code bug: deterministic, identical on retry,
 * and fixable only by changing the caller. Reporting it as a failed write
 * would dress a bug as a full disk and invite retrying it forever.
 *
 * A failed WRITE returns null. This is the promise that has always been here
 * and still holds: a stage that ran must not be reported as failed because its
 * bookkeeping could not be written. The return value says whether the record
 * landed, and every execution caller checks it.
 */
export async function appendJournalEvent(episodeDir, input) {
  // Not wrapped: see above. A malformed event is the caller's bug to fix.
  const event = buildJournalEvent(input);
  try {
    const target = path.join(episodeDir, JOURNAL_RELATIVE_PATH);
    await mkdir(path.dirname(target), { recursive: true });
    await appendFile(target, `${JSON.stringify(event)}\n`, "utf-8");
    return event;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Update the declaration in `studio/contracts/src/journal.d.mts`**

Replace :57-61 with:

```ts
/**
 * Returns the event that was written, or null when the filesystem refused it.
 *
 * Throws when `input` is malformed — that is a caller bug, not a failed write.
 */
export declare function appendJournalEvent(
  episodeDir: string,
  input: JournalEventInput,
): Promise<JournalEvent | null>;
```

- [ ] **Step 5: Run the contracts tests**

Run: `npm test -w studio/contracts`
Expected: PASS, 122 tests (121 after Task 1, one net addition: one test replaced, one added).

- [ ] **Step 6: Run every other package, because this changes a shared contract**

```bash
npm test -w studio/runtime 2>&1 | tail -4
npm test -w studio/gateway 2>&1 | tail -4
npm test -w studio/agent 2>&1 | tail -4
```

Expected: all PASS. If any test fails because it deliberately wrote a malformed event and expected `null`, that test is now asserting the old contract — report it in your report rather than weakening the change; the controller will rule.

- [ ] **Step 7: Commit**

```bash
git add studio/contracts/src/journal.mjs studio/contracts/src/journal.d.mts studio/contracts/test/journal.test.mjs
git commit -m "fix(contracts): throw on a malformed event, keep null for a failed write"
```

---

### Task 3: The service checks its fourth append

**Files:**
- Modify: `studio/runtime/src/execution/service.ts:586-601` (the `stage-leased` rollback comment, and the unchecked `stage-started` append)
- Test: `studio/runtime/test/unit/execution/run.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: no new exported symbol. `claim` may now return `blocked` with a reason matching `/journal write/` when the `stage-started` write is dropped.

**Context for the implementer:** `claimInternal` writes `stage-leased`, checks it, then writes `stage-started` and does **not** check it. It is the only execution append in the service that is unchecked. After Task 1 a dropped `stage-started` is survivable, but it is still a lost write, and proceeding to dispatch after one is knowingly running work whose record already has a hole.

The rollback is safe here for the same reason it is safe for `stage-leased`: nothing has been dispatched yet. `stage-completed` and `stage-failed` cannot roll back, which is why they leave the lease to lapse instead.

The comment above the `stage-leased` check currently reads "a dropped `stage-started` or `stage-completed` self-heals (the lease expires, the stage becomes retryable)". That is backwards and must be corrected: a dropped `stage-completed` does self-heal, and a dropped `stage-started` is the one that leaves a hole.

`run.test.ts` already mocks `@studio/contracts/src/journal.mjs` through a `vi.hoisted` object (`journalMockState`) with `dropStageLeased` and `dropTerminal` flags, and resets them in `afterEach`. Add a third flag.

- [ ] **Step 1: Add the mock flag**

In `studio/runtime/test/unit/execution/run.test.ts`, extend `journalMockState` and the mock factory:

```ts
const journalMockState = vi.hoisted(() => ({
  dropStageLeased: false,
  dropStageStarted: false,
  /** A terminal event type to drop, or null. */
  dropTerminal: null as null | "stage-completed" | "stage-failed",
}));

vi.mock("@studio/contracts/src/journal.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@studio/contracts/src/journal.mjs")>();
  return {
    ...actual,
    appendJournalEvent: async (episodeDir: string, input: any) => {
      if (input.type === "stage-leased" && journalMockState.dropStageLeased) {
        return null;
      }
      if (input.type === "stage-started" && journalMockState.dropStageStarted) {
        return null;
      }
      if (input.type === journalMockState.dropTerminal) {
        return null;
      }
      return actual.appendJournalEvent(episodeDir, input);
    },
  };
});
```

And in the existing `afterEach`, add the reset:

```ts
afterEach(() => {
  journalMockState.dropStageLeased = false;
  journalMockState.dropStageStarted = false;
  journalMockState.dropTerminal = null;
});
```

- [ ] **Step 2: Write the failing test**

Add it immediately after the existing `dropStageLeased` test (which ends around :493), inside the same `describe`:

```ts
  it("stops rather than dispatching when the stage-started write is dropped", async () => {
    // The only execution append the service did not check. A dropped
    // stage-started is survivable since replay records the gap, but it is
    // still a lost write, and dispatching after one means knowingly doing work
    // whose record already has a hole. Nothing has run yet at this point, so
    // the lease can be released completely — the same reason the stage-leased
    // rollback is safe, and the reason the terminal appends cannot do it.
    const { root, dir } = await episode();
    const dispatcher = writingDispatcher(dir);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher, budget: permissiveBudget, holder: "test/1",
    });

    journalMockState.dropStageStarted = true;
    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    journalMockState.dropStageStarted = false;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/journal write/);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();

    // The lease was released, so a later run leases and dispatches normally.
    const second = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.status).toBe("completed");

    // The dropped attempt left its lease event and nothing after it — no
    // stage-started, and no terminal event claiming an attempt that never ran.
    const types = (await journal(dir)).map((e: any) => e.type);
    expect(types).toEqual(["stage-leased", "stage-leased", "stage-started", "stage-completed"]);
  });
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -w studio/runtime 2>&1 | tail -20`
Expected: FAIL — `status` is `claimed`, not `blocked`, and the dispatcher WAS called.

- [ ] **Step 4: Check the append and correct the comment**

In `studio/runtime/src/execution/service.ts`, replace the block from the `if (!leased) {` comment through the `stage-started` append (currently :587-602) with:

```ts
    if (!leased) {
      // Nothing else has been recorded yet — release the lease we just took
      // and stop before dispatching. The two terminal appends below cannot do
      // this: by the time they run the work has happened, so they leave the
      // lease to lapse instead, and the journal and the lockfile keep saying
      // the same thing.
      await sm.releaseAll();
      return blocked(`"${stageId}" could not be leased: the journal write for its lease did not land`);
    }
    const started = await appendJournalEvent(episodeDir, {
      type: "stage-started", actor: "runtime", episode: ref,
      data: { stageId, leaseId, attemptNumber },
    });
    if (!started) {
      // Same rollback, same reason: nothing has been dispatched yet.
      //
      // Replay survives this gap — it records `startRecorded: false` on the
      // attempt rather than throwing — but surviving it is not a licence to
      // create it. A lost write here means writes are failing on this machine,
      // and running the stage anyway produces work whose record is already
      // incomplete.
      await sm.releaseAll();
      return blocked(`"${stageId}" could not be started: the journal write for its start did not land`);
    }
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -w studio/runtime 2>&1 | tail -5`
Expected: PASS, 508 tests (507 before, one added).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p studio/runtime/tsconfig.json`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add studio/runtime/src/execution/service.ts studio/runtime/test/unit/execution/run.test.ts
git commit -m "fix(runtime): check the stage-started write, and fix the comment that had it backwards"
```

---

### Task 4: `status` surfaces the gap

**Files:**
- Modify: `studio/runtime/src/execution/types.ts:212-240` (`StageStatusReport`)
- Modify: `studio/runtime/src/execution/service.ts:220-236` (the `reports.push` call)
- Test: `studio/runtime/test/unit/execution/status.test.ts` (add to the existing `describe("ExecutionService.status", ...)` block)

**Interfaces:**
- Consumes: `StageAttempt.startRecorded?: boolean` from Task 1.
- Produces: `StageStatusReport.gaps?: string[]` — absent when there is nothing to report.

**Context for the implementer:** `status()` builds one `StageStatusReport` per stage from the replayed instance. It already has a precedent for an optional explanatory field: `stateReason?: string`, spread conditionally as `...(stateReason ? { stateReason } : {})` so it is absent rather than `null` when empty. Follow that pattern exactly.

Recording a gap only where replay can see it is not recording it. An operator reading `vpr status` should be able to tell a stage that completed cleanly from one whose history has a hole, because the second means a write was lost on that machine and something else may have been lost with it.

`studio/runtime/test/unit/execution/status.test.ts` already has everything this
test needs, defined at the top of the file — do not redefine any of them:

- `REF` — `{ channel: "childrens", series: "fairy-tales", episode: "ep" }`
- `episode()` — returns `{ root, dir }` for a fresh temp episode with `journal/`
  and `artifacts/` created, registered for cleanup in `afterEach`
- `journalLine(dir, type, data)` — appends one raw event line in the shape the
  writer produces
- `service(root)` — `new ExecutionService({ libraryRoot: root, builtinPipelines: PIPELINES })`

The existing tests in that file use the `narrated-illustrated-video` pipeline,
whose first two stages are `brief` and `script`. Use the same pipeline.

- [ ] **Step 1: Write the failing test**

Add inside the existing `describe("ExecutionService.status", ...)` block:

```ts
  it("reports an attempt whose start was never recorded", async () => {
    // The gap is evidence that a write was lost on this machine. Leaving it
    // visible only to replay would be recording it nowhere a human looks.
    const { root, dir } = await episode();
    // stage-leased then straight to stage-completed: the stage-started write
    // was lost. Before Task 1 this journal made the episode permanently
    // underivable; now it derives, and the hole has to be visible.
    await journalLine(dir, "stage-leased", {
      stageId: "brief", leaseId: "L1", attemptNumber: 1,
      ttlMs: 300000, expiresAt: "2999-01-01T00:00:00Z", holder: "runtime/pid-7",
    });
    await journalLine(dir, "stage-completed", {
      stageId: "brief", leaseId: "L1", attemptNumber: 1, outputs: ["artifacts/brief.md"],
    });

    const result = await service(root).status(REF, "narrated-illustrated-video");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const brief = result.value.stages.find((s) => s.stageId === "brief")!;
    expect(brief.status).toBe("completed");
    expect(brief.gaps).toEqual(["attempt 1 has no recorded start"]);

    // Absent, not empty, on a stage with nothing to report.
    const script = result.value.stages.find((s) => s.stageId === "script")!;
    expect("gaps" in script).toBe(false);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w studio/runtime 2>&1 | tail -20`
Expected: FAIL — `brief.gaps` is `undefined`.

- [ ] **Step 3: Declare the field**

In `studio/runtime/src/execution/types.ts`, add to `StageStatusReport` immediately after the `produces` field:

```ts
  /**
   * What this stage's history is missing, when it is missing something.
   *
   * One sentence per gap, in the same spirit as `stateReason`: text a caller
   * can show verbatim. Today the only gap is an attempt whose `stage-started`
   * event never landed, which replay records rather than throwing on.
   *
   * Absent when there is nothing to say. A gap means a journal write was lost
   * on the machine that ran this stage — the stage's own result may be fine,
   * but something else may have been lost at the same time.
   */
  gaps?: string[];
```

- [ ] **Step 4: Populate it**

In `studio/runtime/src/execution/service.ts`, immediately before the `reports.push({` call:

```ts
      const gaps = instance.attempts
        .filter((a) => a.startRecorded === false)
        .map((a) => `attempt ${a.number} has no recorded start`);
```

and add to the object literal, after the `produces` line and beside the existing conditional spread:

```ts
        ...(gaps.length > 0 ? { gaps } : {}),
        ...(stateReason ? { stateReason } : {}),
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -w studio/runtime 2>&1 | tail -5`
Expected: PASS, 509 tests.

- [ ] **Step 6: Typecheck and run every package**

```bash
npx tsc --noEmit -p studio/runtime/tsconfig.json
npm test -w studio/contracts 2>&1 | tail -3
npm test -w studio/gateway 2>&1 | tail -4
npm run typecheck -w studio/gateway
npm test -w studio/agent 2>&1 | tail -4
cd studio/web && bun x vitest run 2>&1 | tail -4 && bun run check:types && cd ../..
```

Expected: all PASS, all typechecks clean. `studio/web` uses **bun**, not npm. The gateway suite has a known flake (`avg-82z`): `test/integration.test.ts` occasionally reports a file-level hook timeout while all its tests pass — re-run once before treating it as a break.

- [ ] **Step 7: Commit**

```bash
git add studio/runtime/src/execution/types.ts studio/runtime/src/execution/service.ts studio/runtime/test/unit/execution/status.test.ts
git commit -m "feat(runtime): report a stage whose history has a hole"
```
