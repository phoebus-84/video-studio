# CLI and Agent on the Execution Service — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the execution service a claim/complete protocol so an out-of-process performer can participate in the journal, then move the CLI, the gateway's remaining execute paths, the studio and the Pi agent onto it — so that for the first time the default pipeline can be run start to finish.

**Architecture:** The service gains `claim()` and `complete()`. `run()` is refactored to be `claim() → dispatch → complete()` so exactly one piece of code writes execution events. The CLI's `run` becomes a claim, a new `complete` closes it, and `status`/`rerun` report from replay instead of from which files exist. The gateway's single-stage and status routes move onto the service, two new routes carry claim/complete to the agent, and `routes/runtime.ts` — eight endpoints with no callers — is deleted.

**Tech Stack:** TypeScript (ESM, NodeNext), vitest for `studio/runtime`, `studio/gateway`, `studio/web`; `node --test` for `studio/contracts`; Fastify in the gateway; Svelte 5 runes in the studio; typebox in the Pi agent.

**Spec:** `docs/superpowers/specs/2026-09-20-cli-and-agent-on-the-execution-service-design.md`

## Global Constraints

- **The journal is written through `@studio/contracts/src/journal.mjs` only.** `studio/runtime/src/journal/` is a separate, unwired implementation with a different event vocabulary. Never import it in execution code.
- **No file-existence inference.** State comes from replaying the journal. Do not call `artifactExists` from any execution path. The one permitted filesystem check is `validateOutputs`, which stats paths a performer explicitly named.
- **A lapsed lease writes nothing.** Once a claim's `expiresAt` has passed, that attempt must not append any journal line. Replay derives the timeout from `expiresAt`, which is already recorded. An event landing after another holder's terminal event makes replay throw permanently, because the journal is append-only.
- **Absence is refusal.** No budget guard means the stage does not run. No review record where a review is declared means the dependent does not run.
- **`studio/runtime` has no `typecheck` npm script.** Typecheck it with `npx tsc --noEmit -p studio/runtime/tsconfig.json`. `studio/gateway` and `studio/web` do have one: `npm run typecheck -w @studio/gateway`.
- **Run test suites per package, not from the root.** The root `npm test` flakes under concurrency (`avg-82z`, predates this work). Use `npm test -w @studio/runtime` etc.
- **A bare `npx vitest` does not rebuild, and some tests spawn the compiled CLI.** `studio/runtime/test/integration/cli.test.ts` and the end-to-end suite run `dist/src/cli.js`, so they test whatever was last built. `npm test -w @studio/runtime` rebuilds first (`pretest`); `npx vitest run --root studio/runtime` does not, and will pass against stale code — demonstrated: a defect reintroduced into `src/cli.ts` left all three status tests green. Prefix any targeted `vitest` run of those suites with `npm run build -w @studio/runtime &&`, and take only `npm test -w @studio/runtime` as the real verdict. `studio/gateway` has no `pretest` at all, and its routes shell out to the runtime's `dist`, so the same caution applies there.
- **Commit after each numbered step that says to.** Frequent commits; the ledger and `git log` are the recovery map.

## File Structure

**`studio/runtime` — the service and the CLI**

| File | Responsibility |
|---|---|
| `src/execution/types.ts` | Adds `claimed` to `OutcomeStatus`, `expiresAt` to `StageOutcome`, the `CompleteInput` type, and `state`/`blockedReason` to `StageStatusReport`. |
| `src/execution/service.ts` | `claim()`, `complete()`, `run()` as their composition, and `status()` reporting a review-aware derived state. |
| `src/engine/state-machine.ts` | Gains `adopt(stageId, lease)` so a process can release a lease it did not acquire. |
| `src/rerun/planner.ts` | `report` becomes optional; the one mode that reads it raises when it is absent. |
| `src/cli.ts` | `cmdRun` claims, `cmdComplete` is new, `cmdStatus` and `cmdRerun` report from the service. |

**`studio/gateway` — transport**

| File | Responsibility |
|---|---|
| `src/runtime/service.ts` (new) | `makeExecutionService()` — the one composition all four execute routes share. |
| `src/routes/production.ts` | Single-stage, status, claim and complete routes onto the service. |
| `src/routes/runtime.ts` | **Deleted.** |
| `src/runtime/client.ts` | Loses `run`, `status`, `rerun`; keeps `init`, `resolve`, `approve`, `validate`, `health`. |

**`studio/web` and `studio/agent`**

| File | Responsibility |
|---|---|
| `src/lib/production-store.svelte.ts` | `actionsFor` maps the service's seven states exactly. |
| `src/contracts/gateway.ts` | Drops `awaiting_approval` and `skipped`, which nothing produces. |
| `studio/agent/src/pipeline-tools.ts` | `pva_claim_stage`, `pva_complete_stage`, and honest descriptions on the rest. |

---

### Task 1: `claim()` on the service, and `run()` built on it

**Files:**
- Modify: `studio/runtime/src/execution/types.ts`
- Modify: `studio/runtime/src/execution/service.ts`
- Test: `studio/runtime/test/unit/execution/claim-complete.test.ts` (create)

**Interfaces:**
- Consumes: `deriveExecutionState`, `leaseState` from `@studio/contracts/src/execution-state.mjs`; `StageStateMachine`, `FileLock`; the existing private helpers `resolve`, `readJournal`, `toEngineInstance`, `validateOutputs`, `leaseLapsed`, `recordFailure`.
- Produces:
  - `OutcomeStatus` gains the member `"claimed"`.
  - `StageOutcome` gains `expiresAt?: string`.
  - `ExecutionService.claim(ref: EpisodeRef, pipeline: string, opts?: { stage?: string; dryRun?: boolean }): Promise<Result<StageOutcome, ExecutionError>>`
  - Private `ExecutionService.claimInternal(ref, pipeline, opts, precheck?): Promise<Result<ClaimInternal, ExecutionError>>` where `interface ClaimInternal { outcome: StageOutcome; stage?: ResolvedStage; ctx?: DispatchContext; episodeDir: string }` and `precheck?: (stage: ResolvedStage) => string | null` returns a blocking reason or null.

**Context for the implementer:** `run()` in `service.ts` is one ~370-line method that selects a stage, checks four kinds of gate, takes a lease, writes two journal events, dispatches, validates, writes a terminal event and releases the lease. This task splits the first half out, unchanged in behaviour, and has `run()` call it. Task 2 splits the second half. Do not change any gating logic, any comment explaining why a check is ordered where it is, or any refusal message.

- [ ] **Step 1: Add the two type members**

In `studio/runtime/src/execution/types.ts`, add to `OutcomeStatus`, after the `awaiting_review` member:

```ts
  /**
   * The stage is leased and started, and something out of process is
   * performing it. Only `claim` returns this; `run` performs the work itself
   * and never leaves a stage in this state on return.
   *
   * A caller looping until nothing advances must treat this as a halt.
   */
  | "claimed";
```

And to `StageOutcome`, after `leaseId`:

```ts
  /**
   * When this claim lapses, ISO-8601. Set on `claimed`, so a performer knows
   * its deadline and `complete` can refuse a claim that has passed it.
   */
  expiresAt?: string;
```

- [ ] **Step 2: Write the failing tests**

Create `studio/runtime/test/unit/execution/claim-complete.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ExecutionService } from "../../../src/execution/service.js";
import type { BudgetGuard } from "../../../src/execution/types.js";
import { parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { ok } from "../../../src/result.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINES = resolve(__dirname, "../../../../pipelines/pipelines");
const REF = { channel: "childrens", series: "fairy-tales", episode: "ep" };

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function episode() {
  const root = await mkdtemp(join(tmpdir(), "exec-claim-"));
  roots.push(root);
  const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
  await mkdir(join(dir, "journal"), { recursive: true });
  await mkdir(join(dir, "artifacts"), { recursive: true });
  return { root, dir };
}

async function journal(dir: string) {
  return parseJournal(await readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8"));
}

const permissiveBudget: BudgetGuard = {
  maySpend: async () => ok({ reserveId: "r1", estimatedCost: 0 }),
};

function service(root: string, extra: Record<string, unknown> = {}) {
  return new ExecutionService({
    libraryRoot: root,
    builtinPipelines: PIPELINES,
    budget: permissiveBudget,
    ...extra,
  });
}

describe("claiming a stage for an out-of-process performer", () => {
  it("leases and starts the stage without any dispatcher configured", async () => {
    const { root, dir } = await episode();
    const svc = service(root);

    const outcome = await svc.claim(REF, "narrated-illustrated-video");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.status).toBe("claimed");
    expect(outcome.value.stageId).toBe("brief");
    expect(outcome.value.leaseId).toBeTruthy();
    expect(outcome.value.expiresAt).toBeTruthy();

    const events = await journal(dir);
    expect(events.map((e) => e.type)).toEqual(["stage-leased", "stage-started"]);
  });

  it("refuses a second claim while the first is live", async () => {
    const { root } = await episode();
    const svc = service(root);

    const first = await svc.claim(REF, "narrated-illustrated-video");
    const second = await svc.claim(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(first.ok && first.value.status).toBe("claimed");
    expect(second.ok && second.value.status).toBe("blocked");
  });

  it("applies every gate a run applies, so a claim cannot skip one", async () => {
    // `script` declares autopilot: false. A claim must refuse it for the same
    // reason a run does: the service has no way to know a person is present.
    const { root, dir } = await episode();
    const svc = service(root);

    const outcome = await svc.claim(REF, "narrated-illustrated-video", { stage: "script" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.status).toBe("blocked");
    expect(outcome.value.reason).toMatch(/autopilot/);
    await expect(readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8")).rejects.toThrow();
  });

  it("does not lease under dryRun", async () => {
    const { root, dir } = await episode();
    const svc = service(root);

    const outcome = await svc.claim(REF, "narrated-illustrated-video", { dryRun: true });

    expect(outcome.ok && outcome.value.status).toBe("would-run");
    await expect(readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8")).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx vitest run studio/runtime/test/unit/execution/claim-complete.test.ts --root studio/runtime
```

Expected: FAIL — `svc.claim is not a function`.

- [ ] **Step 4: Extract `claimInternal` from `run`**

In `service.ts`, rename the existing `run` method to `claimInternal` and change its shape. Keep every gate, every comment and every message exactly as they are. The changes are:

Signature and opening:

```ts
  /**
   * Select a stage, check every gate, take the lease, and record that the
   * stage has started — then stop.
   *
   * `run` and `claim` are the same code up to this point, and deliberately so:
   * a synchronous dispatcher and an out-of-process performer that each wrote
   * their own `stage-leased` would be the next instance of the split this
   * epic exists to close, and the hardest to notice, because both would be
   * correct in isolation.
   *
   * `precheck` runs after selection and gating and before anything is leased.
   * `run` uses it to refuse a stage its dispatcher does not handle, so that
   * no stage is ever leased by a caller that cannot perform it. A bare
   * `claim` passes none: a claim is a promise to perform from somewhere else,
   * and requiring a dispatcher for one would defeat the point.
   */
  private async claimInternal(
    ref: EpisodeRef,
    pipeline: string,
    opts: { stage?: string; dryRun?: boolean } = {},
    precheck?: (stage: ResolvedStage) => string | null,
  ): Promise<Result<ClaimInternal, ExecutionError>> {
```

Every `return ok({ stageId: null, status: "idle", ... })` and every `blocked(...)` becomes a wrapped result. Change the `blocked` helper to:

```ts
    const blocked = (reason: string): Result<ClaimInternal, ExecutionError> =>
      ok({
        outcome: { stageId, status: "blocked", reason, outputs: [], durationMs: Date.now() - startedAt, dryRun: opts.dryRun },
        episodeDir,
      });
```

and the idle return to:

```ts
    if (!stage) {
      return ok({
        outcome: { stageId: null, status: "idle", outputs: [], durationMs: Date.now() - startedAt },
        episodeDir,
      });
    }
```

Insert the precheck immediately after the existing budget check (`if (!permitted.ok) return blocked(...)`) and before the `// ── The state the stage is actually in` comment block:

```ts
    // Whatever the caller needs true before a lease is taken. Placed here so
    // it sees a stage that has passed every gate, and so a refusal costs
    // nothing: nothing has been leased or written yet.
    const refusal = precheck?.(stage);
    if (refusal) return blocked(refusal);
```

Delete the two dispatcher checks from their current position (`if (!this.options.dispatcher)` and `if (this.options.dispatcher.canDispatch?.(stage) === false)`); they move into `run` in Step 6. Leave the budget checks where they are.

Change the dry-run return to:

```ts
    if (opts.dryRun) {
      return ok({
        outcome: {
          stageId, status: "would-run", reason: "dry run — would have dispatched",
          outputs: [], durationMs: Date.now() - startedAt, dryRun: true,
        },
        episodeDir, stage, ctx,
      });
    }
```

End the method immediately after the `stage-started` append, returning the claim:

```ts
    await appendJournalEvent(episodeDir, {
      type: "stage-started", actor: "runtime", episode: ref,
      data: { stageId, leaseId, attemptNumber },
    });

    return ok({
      outcome: {
        stageId, status: "claimed", outputs: [],
        attemptNumber, leaseId, expiresAt,
        durationMs: Date.now() - startedAt,
      },
      episodeDir, stage,
      ctx: { ...ctx, attemptNumber },
    });
  }
```

Everything after that point in the old method — `lapsed`, dispatch, validate, the terminal writes — is cut and kept aside for Task 2. Paste it into a scratch file; Task 2 needs it.

Add the interface above the class:

```ts
/** What `claimInternal` hands back: the outcome, plus what a caller needs to perform the stage. */
interface ClaimInternal {
  outcome: StageOutcome;
  /** The selected stage. Absent when nothing was selected. */
  stage?: ResolvedStage;
  /** Ready for dispatch, with `attemptNumber` set. Absent when nothing was selected. */
  ctx?: DispatchContext;
  episodeDir: string;
}
```

- [ ] **Step 5: Add the public `claim`**

```ts
  /**
   * Take a stage for a performer that is not this process.
   *
   * The stage is leased and recorded as started; the work happens elsewhere;
   * `complete` closes it. The lease bounds how long the claim is honoured —
   * an abandoned claim needs no command of its own, because replay derives
   * the timeout from the lease's own `expiresAt`.
   */
  async claim(
    ref: EpisodeRef,
    pipeline: string,
    opts: { stage?: string; dryRun?: boolean } = {},
  ): Promise<Result<StageOutcome, ExecutionError>> {
    const claimed = await this.claimInternal(ref, pipeline, opts);
    return claimed.ok ? ok(claimed.value.outcome) : claimed;
  }
```

- [ ] **Step 6: Re-add `run`, calling `claimInternal` with the dispatcher precheck**

Paste the second half back, with the new opening. The dispatcher checks are now the precheck:

```ts
  /**
   * Perform one stage here and now.
   *
   * Exactly `claim`, then the configured dispatcher, then `complete` — not a
   * parallel implementation that happens to agree with them.
   */
  async run(
    ref: EpisodeRef,
    pipeline: string,
    opts: { stage?: string; dryRun?: boolean } = {},
  ): Promise<Result<StageOutcome, ExecutionError>> {
    const startedAt = Date.now();

    const claimed = await this.claimInternal(ref, pipeline, opts, (stage) => {
      if (!this.options.dispatcher) {
        return `no dispatcher is configured, so "${stage.definition.id}" cannot be performed`;
      }
      if (this.options.dispatcher.canDispatch?.(stage) === false) {
        return `the configured dispatcher does not handle "${stage.definition.id}"`;
      }
      return null;
    });
    if (!claimed.ok) return claimed;

    const { outcome, stage, ctx, episodeDir } = claimed.value;
    if (outcome.status !== "claimed" || !stage || !ctx) return ok(outcome);

    const stageId = stage.definition.id;
    const { leaseId, attemptNumber, expiresAt } = outcome;
```

Then the pasted-back dispatch/validate/terminal-write body follows, unchanged, using those locals. It still needs `sm` and `instance`, which `claimInternal` no longer exposes — Task 2 replaces this whole tail with a `complete()` call. For now, reconstruct them at the top of the tail so this task compiles and every existing test stays green:

```ts
    const ttlMs = this.options.leaseTtlMs ?? DEFAULT_ENGINE_CONFIG.leaseTtlMs;
    const engineConfig = { ...DEFAULT_ENGINE_CONFIG, leaseTtlMs: ttlMs };
    const sm = new StageStateMachine(new FileLock(path.join(episodeDir, ".locks")), engineConfig);
    sm.adopt(stageId, {
      resource: `stage:${stageId}`,
      token: leaseId!,
      expiresAt: new Date(expiresAt!),
    });
    const events = await this.readJournal(episodeDir);
    if (!events.ok) return events;
    const resolved = await this.resolve(pipeline);
    if (!resolved.ok) return resolved;
    const derived = deriveExecutionState(
      events.value, resolved.value.stages.map((s) => s.definition.id), this.now(),
    );
    let instance = this.toEngineInstance(derived.get(stageId)!, stage);
```

`adopt` does not exist yet — add it in Step 7.

- [ ] **Step 7: Add `adopt` to the state machine**

In `studio/runtime/src/engine/state-machine.ts`, after `releaseAll`:

```ts
  /**
   * Register a lease this machine did not acquire.
   *
   * `activeLeases` is per-instance memory, so a machine that completes a stage
   * a DIFFERENT process claimed holds no lease for it and releases nothing —
   * the lockfile would then linger until its TTL, blocking a retry that should
   * have been immediate. Claim and complete are deliberately separate calls,
   * possibly in separate processes; adopting the lease recorded in the journal
   * is how the second of them can release it.
   *
   * The lease is not re-validated here. `FileLock.release` is token-checked
   * and refuses an expired lease, so adopting a stale one cannot release the
   * lease that replaced it.
   */
  adopt(stageId: string, lease: Lease): void {
    this.activeLeases.set(stageId, lease);
  }
```

- [ ] **Step 8: Run the full runtime suite**

```bash
npm test -w @studio/runtime
npx tsc --noEmit -p studio/runtime/tsconfig.json
```

Expected: the four new tests PASS, and all 428 pre-existing tests still pass. A failure in `run.test.ts`, `fail-closed.test.ts`, `concurrency.test.ts` or `gate-enforcement.test.ts` means the extraction changed behaviour — fix the extraction, never the test.

- [ ] **Step 9: Commit**

```bash
git add studio/runtime/src/execution/types.ts studio/runtime/src/execution/service.ts \
        studio/runtime/src/engine/state-machine.ts \
        studio/runtime/test/unit/execution/claim-complete.test.ts
git commit -m "feat(runtime): claim() takes a stage for an out-of-process performer

run() is now claimInternal() plus the tail it always had; the gating,
selection and leasing are one piece of code with a precheck hook, so a
claim cannot skip a gate a run applies."
```

---

### Task 2: `complete()`, and `run()` as claim-then-dispatch-then-complete

**Files:**
- Modify: `studio/runtime/src/execution/types.ts`
- Modify: `studio/runtime/src/execution/service.ts`
- Test: `studio/runtime/test/unit/execution/claim-complete.test.ts`

**Interfaces:**
- Consumes: `ExecutionService.claim` and the private `claimInternal` from Task 1; `StageStateMachine.adopt` from Task 1.
- Produces:
  - `CompleteInput` in `types.ts`.
  - `ExecutionService.complete(ref: EpisodeRef, pipeline: string, stageId: string, input: CompleteInput): Promise<Result<StageOutcome, ExecutionError>>`

**Context for the implementer:** `complete` runs in a process that may not be the one that claimed. It reconstructs everything it needs from the journal: the open attempt carries `leaseId`, `attemptNumber`, `expiresAt` and `holder`. Crucially, `deriveExecutionState` already closes an attempt whose lease has expired — it sets `outcome: "timeout"` and moves the stage to `failed`. So a lapsed claim shows up as *no open attempt*, and the refusal is structural rather than a hand-written clock comparison.

- [ ] **Step 1: Add `CompleteInput`**

In `types.ts`:

```ts
/** What a performer reports when it finishes a claimed stage. */
export interface CompleteInput {
  /**
   * The paths the performer wrote, absolute or relative to the episode
   * directory. Required unless `failed`.
   *
   * The performer names its outputs; the service does not go looking for
   * them. Resolving the manifest's labels to files would mean `artifactExists`
   * and its six-candidates-per-label search, which is the inference this
   * module exists to remove. A performer that cannot say what it wrote has
   * not finished.
   */
  outputs?: string[];
  /**
   * The claim being closed. When omitted, the stage's single open attempt is
   * used — and if there is none, the claim has lapsed and is refused.
   */
  leaseId?: string;
  /** The performer is reporting that the work failed. */
  failed?: boolean;
  /** Why, when `failed`. */
  error?: string;
}
```

- [ ] **Step 2: Write the failing tests**

Append to `studio/runtime/test/unit/execution/claim-complete.test.ts`:

```ts
describe("completing a claim", () => {
  it("validates the paths the performer names and records them", async () => {
    const { root, dir } = await episode();
    const svc = service(root);

    const claimed = await svc.claim(REF, "narrated-illustrated-video");
    expect(claimed.ok && claimed.value.status).toBe("claimed");

    await writeFile(join(dir, "artifacts/brief.md"), "a real brief");
    const done = await svc.complete(REF, "narrated-illustrated-video", "brief", {
      outputs: ["artifacts/brief.md"],
    });

    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.status).toBe("completed");
    expect(done.value.outputs).toEqual(["artifacts/brief.md"]);

    const events = await journal(dir);
    expect(events.map((e) => e.type)).toEqual(["stage-leased", "stage-started", "stage-completed"]);
  });

  it("fails the stage when a named output was never written", async () => {
    const { root, dir } = await episode();
    const svc = service(root);

    await svc.claim(REF, "narrated-illustrated-video");
    const done = await svc.complete(REF, "narrated-illustrated-video", "brief", {
      outputs: ["artifacts/brief.md"],
    });

    expect(done.ok && done.value.status).toBe("failed");
    expect(done.ok && done.value.reason).toMatch(/was not written/);
    const events = await journal(dir);
    expect(events.map((e) => e.type)).toEqual(["stage-leased", "stage-started", "stage-failed"]);
  });

  it("records the performer's own failure report", async () => {
    const { root, dir } = await episode();
    const svc = service(root);

    await svc.claim(REF, "narrated-illustrated-video");
    const done = await svc.complete(REF, "narrated-illustrated-video", "brief", {
      failed: true, error: "the model refused the prompt",
    });

    expect(done.ok && done.value.status).toBe("failed");
    const events = await journal(dir);
    const failed = events.find((e) => e.type === "stage-failed");
    expect((failed?.data as { error?: string })?.error).toBe("the model refused the prompt");
  });

  it("refuses a claim that has lapsed, and writes nothing", async () => {
    // The whole reason the lease exists. By the time a lapsed performer
    // reports, another process may already have taken the stage and closed
    // it; a terminal event for the stale lease landing after that makes
    // replay throw on every future call, because the journal is append-only.
    const { root, dir } = await episode();
    let clock = new Date("2026-09-20T10:00:00.000Z");
    const svc = service(root, { leaseTtlMs: 60_000, now: () => clock });

    const claimed = await svc.claim(REF, "narrated-illustrated-video");
    expect(claimed.ok && claimed.value.status).toBe("claimed");

    clock = new Date("2026-09-20T10:05:00.000Z"); // five minutes: well past the TTL
    await writeFile(join(dir, "artifacts/brief.md"), "written too late");
    const done = await svc.complete(REF, "narrated-illustrated-video", "brief", {
      outputs: ["artifacts/brief.md"],
    });

    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.status).toBe("failed");
    expect(done.value.reason).toMatch(/lapsed|expired/);

    const events = await journal(dir);
    expect(events.map((e) => e.type)).toEqual(["stage-leased", "stage-started"]);
  });

  it("lets a second claimant take a stage whose first claim lapsed, and still replays", async () => {
    const { root, dir } = await episode();
    let clock = new Date("2026-09-20T10:00:00.000Z");
    const svc = service(root, { leaseTtlMs: 60_000, now: () => clock });

    await svc.claim(REF, "narrated-illustrated-video");
    clock = new Date("2026-09-20T10:05:00.000Z");
    await svc.complete(REF, "narrated-illustrated-video", "brief", { outputs: ["artifacts/brief.md"] });

    const second = await svc.claim(REF, "narrated-illustrated-video");
    expect(second.ok && second.value.status).toBe("claimed");

    await writeFile(join(dir, "artifacts/brief.md"), "a real brief");
    const done = await svc.complete(REF, "narrated-illustrated-video", "brief", {
      outputs: ["artifacts/brief.md"],
    });
    expect(done.ok && done.value.status).toBe("completed");

    // The journal must still replay: the whole point of the silence above.
    const status = await svc.status(REF, "narrated-illustrated-video");
    expect(status.ok).toBe(true);
  });

  it("refuses to complete a stage nobody claimed", async () => {
    const { root } = await episode();
    const svc = service(root);

    const done = await svc.complete(REF, "narrated-illustrated-video", "brief", {
      outputs: ["artifacts/brief.md"],
    });

    expect(done.ok && done.value.status).toBe("blocked");
    expect(done.ok && done.value.reason).toMatch(/no open claim|not claimed/i);
  });

  it("refuses a leaseId that does not match the open claim", async () => {
    const { root } = await episode();
    const svc = service(root);

    await svc.claim(REF, "narrated-illustrated-video");
    const done = await svc.complete(REF, "narrated-illustrated-video", "brief", {
      outputs: ["artifacts/brief.md"], leaseId: "not-the-lease",
    });

    expect(done.ok && done.value.status).toBe("blocked");
  });
});

describe("run is claim, dispatch, complete", () => {
  it("writes exactly the events a claim followed by a complete writes", async () => {
    // Asserted on the journal rather than on which methods were called: the
    // guarantee is that the two paths leave the same record, not that one
    // happens to call the other today.
    const viaRun = await episode();
    const runSvc = new ExecutionService({
      libraryRoot: viaRun.root, builtinPipelines: PIPELINES, budget: permissiveBudget,
      dispatcher: {
        dispatch: async () => {
          await writeFile(join(viaRun.dir, "artifacts/brief.md"), "a real brief");
          return ["artifacts/brief.md"];
        },
      },
    });
    const ran = await runSvc.run(REF, "narrated-illustrated-video");
    expect(ran.ok && ran.value.status).toBe("completed");

    const viaClaim = await episode();
    const claimSvc = service(viaClaim.root);
    await claimSvc.claim(REF, "narrated-illustrated-video");
    await writeFile(join(viaClaim.dir, "artifacts/brief.md"), "a real brief");
    await claimSvc.complete(REF, "narrated-illustrated-video", "brief", {
      outputs: ["artifacts/brief.md"],
    });

    const shape = (events: Awaited<ReturnType<typeof journal>>) =>
      events.map((e) => ({
        type: e.type,
        stageId: (e.data as { stageId?: string }).stageId,
        attemptNumber: (e.data as { attemptNumber?: number }).attemptNumber,
        outputs: (e.data as { outputs?: string[] }).outputs,
      }));

    expect(shape(await journal(viaRun.dir))).toEqual(shape(await journal(viaClaim.dir)));
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx vitest run studio/runtime/test/unit/execution/claim-complete.test.ts --root studio/runtime
```

Expected: FAIL — `svc.complete is not a function`.

- [ ] **Step 4: Implement `complete`**

Add to `ExecutionService`, after `claim`:

```ts
  /**
   * Close a claim: validate what the performer wrote, record it, release the
   * lease.
   *
   * Runs in a process that may not be the one that claimed, so everything it
   * needs comes from the journal. The open attempt carries the lease id, the
   * attempt number and the expiry.
   */
  async complete(
    ref: EpisodeRef,
    pipeline: string,
    stageId: string,
    input: CompleteInput,
  ): Promise<Result<StageOutcome, ExecutionError>> {
    const startedAt = Date.now();

    const resolved = await this.resolve(pipeline);
    if (!resolved.ok) return resolved;

    const stage = resolved.value.stages.find((s) => s.definition.id === stageId);
    if (!stage) {
      return err({ code: "STAGE_UNKNOWN", message: `Pipeline "${pipeline}" declares no stage "${stageId}"` });
    }

    const episodeDir = this.episodeDir(ref);
    const events = await this.readJournal(episodeDir);
    if (!events.ok) return events;

    const now = this.now();
    let derived;
    try {
      derived = deriveExecutionState(
        events.value, resolved.value.stages.map((s) => s.definition.id), now,
      );
    } catch (e) {
      return err({
        code: "REPLAY_INVALID",
        message: `Journal and pipeline disagree: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    const instanceState = derived.get(stageId)!;
    const open = instanceState.attempts.find((a) => a.outcome === undefined);

    // A lapsed claim is not an open attempt. `deriveExecutionState` closes an
    // attempt whose lease has expired as a `timeout` and moves the stage to
    // `failed`, so the refusal below IS the lease expiring — there is no
    // separate clock comparison to get wrong, and no way for a stale
    // performer to append a terminal event after another holder has taken
    // the stage.
    if (!open) {
      const last = instanceState.attempts[instanceState.attempts.length - 1];
      const lapsed = last?.outcome === "timeout";
      return ok({
        stageId,
        status: lapsed ? "failed" : "blocked",
        reason: lapsed
          ? `the claim on "${stageId}" lapsed at ${last!.expiresAt} and nothing was recorded for it; ` +
            `the stage is retryable and may have been taken by someone else`
          : `"${stageId}" has no open claim to complete`,
        outputs: [],
        durationMs: Date.now() - startedAt,
      });
    }

    if (input.leaseId && input.leaseId !== open.leaseId) {
      return ok({
        stageId, status: "blocked",
        reason: `the open claim on "${stageId}" is "${open.leaseId}", not "${input.leaseId}"`,
        outputs: [], durationMs: Date.now() - startedAt,
      });
    }

    const leaseId = open.leaseId;
    const attemptNumber = open.number;

    const ttlMs = this.options.leaseTtlMs ?? DEFAULT_ENGINE_CONFIG.leaseTtlMs;
    const engineConfig = { ...DEFAULT_ENGINE_CONFIG, leaseTtlMs: ttlMs };
    const sm = new StageStateMachine(new FileLock(path.join(episodeDir, ".locks")), engineConfig);
    // Adopted so the terminal transition below releases the lockfile. Without
    // it a stage claimed by one process and completed by another holds its
    // lock until the TTL, blocking a retry that should be immediate.
    if (open.expiresAt) {
      sm.adopt(stageId, { resource: `stage:${stageId}`, token: leaseId, expiresAt: new Date(open.expiresAt) });
    }
    const instance = this.toEngineInstance(instanceState, stage);

    if (input.failed) {
      const message = input.error ?? "the performer reported failure without saying why";
      await this.recordFailure(episodeDir, ref, sm, instance, stageId, leaseId, attemptNumber, message);
      return ok({
        stageId, status: "failed", reason: message, outputs: [],
        attemptNumber, leaseId, durationMs: Date.now() - startedAt,
      });
    }

    const outputs = input.outputs ?? [];
    const invalid = await this.validateOutputs(episodeDir, outputs);
    if (invalid) {
      await this.recordFailure(episodeDir, ref, sm, instance, stageId, leaseId, attemptNumber, invalid);
      return ok({
        stageId, status: "failed", reason: invalid, outputs: [],
        attemptNumber, leaseId, durationMs: Date.now() - startedAt,
      });
    }

    const relative = outputs.map((o) => path.isAbsolute(o) ? path.relative(episodeDir, o) : o);

    // The journal is written before the lease is released. If this process
    // dies in between, the record says what happened and the lease expires on
    // its own; releasing first would leave a completed stage looking unstarted.
    await appendJournalEvent(episodeDir, {
      type: "stage-completed", actor: "runtime", episode: ref,
      data: { stageId, leaseId, attemptNumber, outputs: relative },
    });
    await sm.complete(instance);

    // Completion is what happened; acceptance is whether it counts. The
    // journal says completed because that is true; the outcome says
    // awaiting_review because that is what the caller needs.
    const needsReview = stage.definition.gates.review !== "none";
    return ok({
      stageId,
      status: needsReview ? "awaiting_review" : "completed",
      outputs: relative, attemptNumber, leaseId,
      durationMs: Date.now() - startedAt,
      ...(needsReview
        ? { reason: `"${stageId}" declares ${stage.definition.gates.review} review and is not accepted yet` }
        : {}),
    });
  }
```

- [ ] **Step 5: Replace `run`'s tail with a `complete` call**

Delete everything in `run` after the claim destructuring — the `sm`/`instance` reconstruction from Task 1 Step 6, the `lapsed` helper, the dispatch/validate/terminal-write body — and replace it with:

```ts
    let outputs: string[];
    try {
      outputs = await this.options.dispatcher!.dispatch(stage, ctx);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const failed = await this.complete(ref, pipeline, stageId, { leaseId, failed: true, error: message });
      return failed.ok ? ok({ ...failed.value, durationMs: Date.now() - startedAt }) : failed;
    }

    const done = await this.complete(ref, pipeline, stageId, { outputs, leaseId });
    return done.ok ? ok({ ...done.value, durationMs: Date.now() - startedAt }) : done;
  }
```

`complete` re-reads the journal, which `claim` has just written, so `run`'s second half exercises exactly the cross-process path on every call. That is the point: the two cannot drift, because there is only one of them.

The `leaseLapsed` private method and the `lapsed` helper are now unused — `complete`'s "no open attempt" branch replaces them. Delete `leaseLapsed` and its doc comment.

- [ ] **Step 6: Run the tests**

```bash
npx vitest run studio/runtime/test/unit/execution/claim-complete.test.ts --root studio/runtime
npm test -w @studio/runtime
npx tsc --noEmit -p studio/runtime/tsconfig.json
```

Expected: all new tests PASS and all 428 pre-existing tests still pass. Pay particular attention to `fail-closed.test.ts` and `concurrency.test.ts`, which assert the lapsed-lease silence — they must pass unchanged. If one fails, the lapse semantics differ between `leaseLapsed` and the no-open-attempt branch, and the branch is what needs fixing.

- [ ] **Step 7: Commit**

```bash
git add studio/runtime/src/execution/ studio/runtime/test/unit/execution/claim-complete.test.ts
git commit -m "feat(runtime): complete() closes a claim, and run() is built from claim and complete

One code path writes execution events. A lapsed claim is refused
structurally: replay closes an expired attempt as a timeout, so there is no
open attempt to complete and no clock comparison to get wrong."
```

---

### Task 3: `status()` reports a review-aware, derived state

**Files:**
- Modify: `studio/runtime/src/execution/types.ts`
- Modify: `studio/runtime/src/execution/service.ts`
- Test: `studio/runtime/test/unit/execution/status.test.ts`

**Interfaces:**
- Consumes: `ExecutionService.claim` from Task 1.
- Produces: `StageStatusReport` gains `state: StageState` and `blockedReason?: string`, where
  `export type StageState = "pending" | "runnable" | "running" | "blocked" | "failed" | "completed" | "awaiting_review";`

**Context for the implementer:** `StageStatusReport.dependenciesMet` is computed by the exported `dependenciesMet()` in `service.ts`, which tests only for `completed`. The dependency check inside `claimInternal` additionally consults the `ReviewGate`. So status reports a stage as ready that `run` will refuse. This is a live bug, and the CLI is about to start printing that field.

- [ ] **Step 1: Write the failing test**

Add to `studio/runtime/test/unit/execution/status.test.ts`:

```ts
describe("status agrees with what run will do", () => {
  it("does not call a stage runnable when its dependency's review is outstanding", async () => {
    // The disagreement this fixes: `dependenciesMet` tested only for
    // `completed`, while the dependency check inside a run also consults the
    // review gate. Status said ready; run said blocked.
    const { root, dir } = await episode();
    const pipelineDir = await reviewChainPipeline();
    const svc = new ExecutionService({
      libraryRoot: root,
      builtinPipelines: pipelineDir,
      budget: permissiveBudget,
      review: { isOutstanding: async (id) =>
        id === "gated" ? { state: "outstanding", reason: "is awaiting review" } : { state: "no-record" } },
    });

    await svc.claim(REF, "review-chain");
    await writeFile(join(dir, "artifacts/upstream.md"), "x");
    await svc.complete(REF, "review-chain", "upstream", { outputs: ["artifacts/upstream.md"] });
    await svc.claim(REF, "review-chain", { stage: "gated" });
    await writeFile(join(dir, "artifacts/gated.md"), "x");
    await svc.complete(REF, "review-chain", "gated", { outputs: ["artifacts/gated.md"] });

    const status = await svc.status(REF, "review-chain");
    expect(status.ok).toBe(true);
    if (!status.ok) return;

    const downstream = status.value.stages.find((s) => s.stageId === "downstream")!;
    expect(downstream.state).toBe("blocked");
    expect(downstream.blockedReason).toMatch(/gated/);

    // And run agrees.
    const attempt = await svc.claim(REF, "review-chain", { stage: "downstream" });
    expect(attempt.ok && attempt.value.status).toBe("blocked");
  });

  it("calls a stage runnable when it genuinely is", async () => {
    const { root } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES, budget: permissiveBudget,
    });

    const status = await svc.status(REF, "narrated-illustrated-video");
    expect(status.ok).toBe(true);
    if (!status.ok) return;

    expect(status.value.stages.find((s) => s.stageId === "brief")!.state).toBe("runnable");
    expect(status.value.stages.find((s) => s.stageId === "art-direction")!.state).toBe("pending");
    // script declares autopilot: false, so it can never be runnable.
    expect(status.value.stages.find((s) => s.stageId === "script")!.state).not.toBe("runnable");
  });

  it("reports a completed stage that declares a review as awaiting_review", async () => {
    const { root, dir } = await episode();
    const pipelineDir = await reviewChainPipeline();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: pipelineDir, budget: permissiveBudget,
    });

    await svc.claim(REF, "review-chain");
    await writeFile(join(dir, "artifacts/upstream.md"), "x");
    await svc.complete(REF, "review-chain", "upstream", { outputs: ["artifacts/upstream.md"] });
    await svc.claim(REF, "review-chain", { stage: "gated" });
    await writeFile(join(dir, "artifacts/gated.md"), "x");
    await svc.complete(REF, "review-chain", "gated", { outputs: ["artifacts/gated.md"] });

    const status = await svc.status(REF, "review-chain");
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.value.stages.find((s) => s.stageId === "gated")!.state).toBe("awaiting_review");
  });
});
```

Copy `reviewChainPipeline` verbatim from `studio/runtime/test/unit/execution/review-gate.test.ts` into a shared helper at `studio/runtime/test/unit/execution/helpers/review-chain.ts`, exporting it, and import it from both files. Do not duplicate the YAML.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run studio/runtime/test/unit/execution/status.test.ts --root studio/runtime
```

Expected: FAIL — `state` is undefined on the report.

- [ ] **Step 3: Add the type**

In `types.ts`, above `StageStatusReport`:

```ts
/**
 * A stage's place in its pipeline.
 *
 * `StageStatusReport.status` has four members, which is everything the journal
 * can say about a stage on its own. These seven are answers about a stage IN
 * its pipeline: `runnable`, `blocked` and `awaiting_review` need the
 * dependency check, the manifest's gates and the review gate. They are
 * computed by the same code that answers those questions for a run, so a
 * caller is never told a stage is ready and then refused when it acts.
 */
export type StageState =
  | "pending" | "runnable" | "running" | "blocked" | "failed" | "completed" | "awaiting_review";
```

and to `StageStatusReport`, after `dependenciesMet`:

```ts
  /** As `run` would see it. This is what a caller should switch on. */
  state: StageState;
  /** Why, when `state` is `blocked`. */
  blockedReason?: string;
```

- [ ] **Step 4: Extract the dependency check and use it from both places**

In `service.ts`, extract the dependency-and-review block from `claimInternal` into a private method, and call it from both `claimInternal` and `status`:

```ts
  /**
   * Why this stage may not run, or null.
   *
   * Shared by `claimInternal` and `status` so the two cannot disagree. They
   * did: `status` used the exported `dependenciesMet`, which tests only for
   * `completed`, while a run also consulted the review gate — so status
   * reported a stage as ready that a run then refused.
   */
  private async whyBlocked(
    stage: ResolvedStage,
    stages: ResolvedStage[],
    derived: Map<string, { status: string }>,
    episodeDir: string,
  ): Promise<string | null> {
    const stageId = stage.definition.id;

    const unmet = (stage.definition.dependsOn ?? [])
      .filter((id) => derived.get(id)?.status !== "completed");
    if (unmet.length > 0) {
      return `"${stageId}" depends on ${unmet.map((m) => `"${m}"`).join(", ")}, ` +
        `which ${unmet.length === 1 ? "has" : "have"} not completed`;
    }

    if (!stage.definition.gates.autopilot) {
      return `"${stageId}" declares autopilot: false and may not run unattended; ` +
        `a person has to run it`;
    }

    for (const depId of stage.definition.dependsOn ?? []) {
      if (this.options.review) {
        const verdict = await this.options.review.isOutstanding(depId, episodeDir);
        if (verdict.state === "approved") continue;
        if (verdict.state === "outstanding") {
          return `"${stageId}" cannot run: "${depId}" ${verdict.reason ?? "has an outstanding review"}`;
        }
      }
      const depStage = stages.find((s) => s.definition.id === depId);
      const depNeedsReview = depStage?.definition.gates.review !== "none";
      if (depNeedsReview) {
        return `"${stageId}" cannot run: "${depId}" declares ${depStage!.definition.gates.review} ` +
          `review and no accepted review is recorded for it, so whether it was accepted ` +
          `cannot be known`;
      }
    }

    return null;
  }
```

Move the full explanatory comments from the original block into this method — the one about completion versus acceptance, the one about `autopilot` having been enforced nowhere, and the one about an injected gate having been weaker than none. They explain why these checks are ordered as they are and must not be lost in the move.

In `claimInternal`, replace the three inlined blocks with:

```ts
    const refusal = await this.whyBlocked(stage, stages, derived, episodeDir);
    if (refusal) return blocked(refusal);
```

- [ ] **Step 5: Compute `state` in `status`**

Replace the `reports` mapping in `status()` with:

```ts
    const reports: StageStatusReport[] = [];
    for (const stage of stages) {
      const instance = derived.get(stage.definition.id)!;
      const lease = leaseState(instance, now);
      const blockedReason = instance.status === "pending"
        ? await this.whyBlocked(stage, stages, derived, episodeDir)
        : null;

      let state: StageState;
      if (instance.status === "completed") {
        state = stage.definition.gates.review !== "none" ? "awaiting_review" : "completed";
      } else if (instance.status === "running") {
        state = "running";
      } else if (instance.status === "failed") {
        state = "failed";
      } else {
        state = blockedReason ? "blocked" : "runnable";
      }

      reports.push({
        stageId: stage.definition.id,
        name: stage.definition.name,
        status: instance.status,
        attempts: instance.attempts.length,
        outputArtifacts: instance.outputArtifacts,
        lease,
        dependenciesMet: dependenciesMet(stage, derived),
        state,
        ...(blockedReason ? { blockedReason } : {}),
      });
    }
```

A `completed` stage that declares a review reports `awaiting_review` even when a `ReviewGate` would say `approved`. That is a known simplification: reconciling it needs `avg-qr4.3`'s definition of what an approval is, and the studio's action for `awaiting_review` is "approve", which is harmless to offer twice. Add that as a comment.

- [ ] **Step 6: Run the tests**

```bash
npm test -w @studio/runtime
npx tsc --noEmit -p studio/runtime/tsconfig.json
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add studio/runtime/src/execution/ studio/runtime/test/unit/execution/
git commit -m "fix(runtime): status and run answer the dependency question with the same code

status used the exported dependenciesMet, which tests only for completed,
while a run also consulted the review gate — so status reported a stage as
ready that a run then refused."
```

---

### Task 4: `vpr run` claims, and `vpr complete` closes the claim

**Files:**
- Modify: `studio/runtime/src/cli.ts` (`cmdRun` at :526, the `COMMANDS` registry at :595)
- Test: `studio/runtime/test/integration/cli.test.ts`

**Interfaces:**
- Consumes: `ExecutionService`, `claim`, `complete`, `CompleteInput`, `StageOutcome` from `../execution/index.js`.
- Produces: `cmdComplete(ctx: CliContext, args: string[]): Promise<number>` registered as `complete`.

**Context for the implementer:** `cmdRun` currently filters `pipeline.stages` for one whose declared outputs are missing on disk and prints "Ready to execute: <id>". It persists nothing and consults no gate. Replace the body entirely. The CLI helpers you need already exist in this file: `parsePath`, `libraryFrom`, `extractPipeline`, `emit`, and the exit-code constants `EX_OK`, `EX_USAGE`, `EX_RUNTIME`.

The CLI must inject a `BudgetGuard`, because absence is refusal and a claim with no guard would always be blocked. There is no budget subsystem wired anywhere yet (`BudgetLedger` has no callers; see `avg-91o`), so the CLI injects an explicit pass-through with a comment naming that gap — the same thing the gateway does, made visible rather than implied.

- [ ] **Step 1: Write the failing tests**

Add to `studio/runtime/test/integration/cli.test.ts`. Match the file's existing harness for invoking the CLI; if it shells out to the built binary, follow that pattern exactly.

```ts
describe("vpr run claims a stage", () => {
  it("leases the stage and journals it, rather than printing advice", async () => {
    const { root, dir } = await episodeFixture();

    const result = await cli(["run", "childrens/fairy-tales/ep", "--library", root, "--json"]);

    expect(result.code).toBe(0);
    const out = JSON.parse(result.stdout);
    expect(out.status).toBe("claimed");
    expect(out.stage).toBe("brief");
    expect(out.leaseId).toBeTruthy();
    expect(out.expiresAt).toBeTruthy();

    const events = await readJournal(dir);
    expect(events.map((e) => e.type)).toEqual(["stage-leased", "stage-started"]);
  });

  it("--dry-run reports the selection and every gate, and writes nothing", async () => {
    const { root, dir } = await episodeFixture();

    const result = await cli(["run", "childrens/fairy-tales/ep", "--library", root, "--json", "--dry-run"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).status).toBe("would-run");
    await expect(readJournal(dir)).rejects.toThrow();
  });

  it("refuses a stage the manifest says may not run unattended", async () => {
    const { root } = await episodeFixture();

    const result = await cli([
      "run", "childrens/fairy-tales/ep", "--stage", "script", "--library", root, "--json",
    ]);

    const out = JSON.parse(result.stdout);
    expect(out.status).toBe("blocked");
    expect(out.reason).toMatch(/autopilot/);
  });
});

describe("vpr complete closes a claim", () => {
  it("records the outputs the performer names", async () => {
    const { root, dir } = await episodeFixture();
    await cli(["run", "childrens/fairy-tales/ep", "--library", root, "--json"]);
    await writeFile(join(dir, "artifacts/brief.md"), "a real brief");

    const result = await cli([
      "complete", "childrens/fairy-tales/ep", "brief",
      "--outputs", "artifacts/brief.md", "--library", root, "--json",
    ]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).status).toBe("completed");
    const events = await readJournal(dir);
    expect(events.map((e) => e.type)).toEqual(["stage-leased", "stage-started", "stage-completed"]);
  });

  it("refuses a successful completion that names no outputs", async () => {
    const { root } = await episodeFixture();
    await cli(["run", "childrens/fairy-tales/ep", "--library", root, "--json"]);

    const result = await cli([
      "complete", "childrens/fairy-tales/ep", "brief", "--library", root, "--json",
    ]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).error).toMatch(/--outputs/);
  });

  it("records a reported failure", async () => {
    const { root, dir } = await episodeFixture();
    await cli(["run", "childrens/fairy-tales/ep", "--library", root, "--json"]);

    const result = await cli([
      "complete", "childrens/fairy-tales/ep", "brief",
      "--failed", "--error", "the model refused", "--library", root, "--json",
    ]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).status).toBe("failed");
    const events = await readJournal(dir);
    expect(events.some((e) => e.type === "stage-failed")).toBe(true);
  });
});
```

Add the fixture helper if the file has none:

```ts
async function episodeFixture() {
  const root = await mkdtemp(join(tmpdir(), "vpr-cli-"));
  roots.push(root);
  const dir = join(root, "childrens", "series", "fairy-tales", "episodes", "ep");
  await mkdir(join(dir, "journal"), { recursive: true });
  await mkdir(join(dir, "artifacts"), { recursive: true });
  return { root, dir };
}
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm run build -w @studio/runtime && npx vitest run test/integration/cli.test.ts --root studio/runtime
```

Expected: FAIL — `vpr run` still emits `Ready to execute`, and `complete` is an unknown subcommand.

- [ ] **Step 3: Add a shared service factory to the CLI**

Above `cmdRun` in `cli.ts`:

```ts
/**
 * The execution service, composed for the CLI.
 *
 * The CLI injects no dispatcher: the four handlers that perform stages
 * automatically live in @studio/gateway, which depends on this package and
 * not the reverse. That is why `vpr run` claims rather than performs — a
 * terminal cannot run `illustrations`, and pretending otherwise would be a
 * lie about where work happens.
 */
function makeService(args: string[]): ExecutionService {
  return new ExecutionService({
    libraryRoot: libraryFrom(args) || ".",
    builtinPipelines: process.env.AVG_BUILTIN_PIPELINES || undefined,
    // Absence is refusal, and there is no budget subsystem wired anywhere yet
    // — BudgetLedger's reserve/consume/release have no callers (avg-91o). An
    // explicit pass-through keeps the gap visible in code rather than making
    // every claim fail for a reason nobody can act on.
    budget: { maySpend: async () => ok({ reserveId: "cli", estimatedCost: 0 }) },
    holder: `cli/pid-${process.pid}`,
    // Stated, not inherited. The engine's default is 5 minutes, chosen for a
    // dispatcher that finishes in seconds; a claim is held by a person or an
    // agent doing real work, and 5 minutes would expire under them. A TTL
    // that is too long only delays recovery from an abandoned claim; one that
    // is too short destroys live work, so this errs long.
    leaseTtlMs: Number(process.env.AVG_CLAIM_TTL_MS ?? 15 * 60 * 1000),
  });
}

/** Turn a StageOutcome into the CLI's JSON shape. */
function outcomeFields(outcome: StageOutcome): Record<string, unknown> {
  return {
    stage: outcome.stageId,
    status: outcome.status,
    ...(outcome.reason ? { reason: outcome.reason } : {}),
    ...(outcome.outputs.length > 0 ? { outputs: outcome.outputs } : {}),
    ...(outcome.leaseId ? { leaseId: outcome.leaseId } : {}),
    ...(outcome.expiresAt ? { expiresAt: outcome.expiresAt } : {}),
    ...(outcome.attemptNumber ? { attemptNumber: outcome.attemptNumber } : {}),
  };
}
```

Add `import { ExecutionService } from "./execution/index.js";`, `import type { StageOutcome } from "./execution/index.js";` and `import { ok } from "./result.js";` to the imports at the top. Task 6 additionally needs `import type { RerunMode } from "./rerun/index.js";` — add it then, not now.

`builtinPipelines` is read from `AVG_BUILTIN_PIPELINES` with `|| undefined` rather than a bare read, for the reason documented in `production.ts`: an empty string does not trigger `createDefaultLoader`'s `??` fallback, so the escape hatch would be dead exactly when it is needed.

- [ ] **Step 4: Replace `cmdRun`'s body**

```ts
async function cmdRun(ctx: CliContext, args: string[]): Promise<number> {
  const { pipeline: pipelineName, remaining } = extractPipeline(args);
  const pathArg = remaining.find((a: string) => !a.startsWith("--"));
  if (!pathArg) {
    emit(ctx, { error: "Usage: vpr run <channel>/<series>/<episode> [--stage <id>] [--pipeline <name>] [--dry-run]" });
    return EX_USAGE;
  }
  const parsed = parsePath(pathArg);
  if (!parsed) {
    emit(ctx, { error: `Invalid path "${pathArg}"` });
    return EX_USAGE;
  }
  const stageIdx = remaining.indexOf("--stage");
  const stage = stageIdx >= 0 ? remaining[stageIdx + 1] : undefined;

  const service = makeService(args);
  const claimed = await service.claim(parsed, pipelineName ?? DEFAULT_PIPELINE, {
    ...(stage ? { stage } : {}),
    dryRun: ctx.dryRun,
  });

  if (!claimed.ok) {
    emit(ctx, { error: `${claimed.error.code}: ${claimed.error.message}` });
    return EX_RUNTIME;
  }

  const outcome = claimed.value;
  if (outcome.status === "idle") {
    emit(ctx, { message: "Nothing to run: every stage is complete or none is runnable", ...outcomeFields(outcome) });
    return EX_OK;
  }
  if (outcome.status === "claimed") {
    emit(ctx, {
      message:
        `Claimed "${outcome.stageId}" until ${outcome.expiresAt}. ` +
        `Perform it, then: vpr complete ${pathArg} ${outcome.stageId} --outputs <path>`,
      ...outcomeFields(outcome),
    });
    return EX_OK;
  }
  if (outcome.status === "would-run") {
    emit(ctx, { message: `[DRY RUN] Would claim "${outcome.stageId}"`, ...outcomeFields(outcome) });
    return EX_OK;
  }
  emit(ctx, { message: outcome.reason ?? `"${outcome.stageId}" did not run`, ...outcomeFields(outcome) });
  return EX_OK;
}
```

A `blocked` outcome exits 0: the service worked and refused, which is not a CLI failure. Only an `ExecutionError` — an unreadable journal, an unresolvable pipeline — is `EX_RUNTIME`.

- [ ] **Step 5: Add `cmdComplete`**

Immediately after `cmdRun`:

```ts
async function cmdComplete(ctx: CliContext, args: string[]): Promise<number> {
  const { pipeline: pipelineName, remaining } = extractPipeline(args);
  const positional = remaining.filter((a, i) =>
    !a.startsWith("--") && !remaining[i - 1]?.startsWith("--"));
  if (positional.length < 2) {
    emit(ctx, {
      error: "Usage: vpr complete <channel>/<series>/<episode> <stage-id> " +
        "--outputs <path>[,<path>...] | --failed [--error <message>]",
    });
    return EX_USAGE;
  }
  const parsed = parsePath(positional[0]!);
  if (!parsed) {
    emit(ctx, { error: `Invalid path "${positional[0]}"` });
    return EX_USAGE;
  }
  const stageId = positional[1]!;

  const flag = (name: string): string | undefined => {
    const i = remaining.indexOf(name);
    return i >= 0 ? remaining[i + 1] : undefined;
  };
  const failed = remaining.includes("--failed");
  const outputs = flag("--outputs")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];

  if (!failed && outputs.length === 0) {
    emit(ctx, {
      error: "--outputs is required: name the files you wrote, or pass --failed. " +
        "The performer is the only party that knows what it produced.",
    });
    return EX_USAGE;
  }

  if (ctx.dryRun) {
    emit(ctx, {
      message: `[DRY RUN] Would complete "${stageId}" with ${failed ? "a failure" : `${outputs.length} output(s)`}`,
      dryRun: true, stage: stageId,
    });
    return EX_OK;
  }

  const service = makeService(args);
  const done = await service.complete(parsed, pipelineName ?? DEFAULT_PIPELINE, stageId, {
    ...(failed ? { failed: true, error: flag("--error") } : { outputs }),
    ...(flag("--lease") ? { leaseId: flag("--lease") } : {}),
  });

  if (!done.ok) {
    emit(ctx, { error: `${done.error.code}: ${done.error.message}` });
    return EX_RUNTIME;
  }
  emit(ctx, {
    message: done.value.reason ?? `"${stageId}" is ${done.value.status}`,
    ...outcomeFields(done.value),
  });
  return EX_OK;
}
```

- [ ] **Step 6: Register `complete` and update `run`'s help**

In the `COMMANDS` registry, change the `run` entry's description and usage, and add `complete` after it:

```ts
  run: { name: "run", description: "Claim the next runnable stage for a performer", usage: "vpr run <channel>/<series>/<episode> [--stage <id>] [--pipeline <name>] [--json] [--dry-run]", examples: ["vpr run my-channel/my-series/ep001", "vpr run my-channel/my-series/ep001 --dry-run"], run: cmdRun },
  complete: { name: "complete", description: "Close a claimed stage with the outputs it produced", usage: "vpr complete <channel>/<series>/<episode> <stage-id> --outputs <path>[,<path>] | --failed [--error <msg>]", examples: ["vpr complete my-channel/my-series/ep001 brief --outputs artifacts/brief.md", "vpr complete my-channel/my-series/ep001 brief --failed --error 'the model refused'"], run: cmdComplete },
```

- [ ] **Step 7: Run the tests**

```bash
npm run build -w @studio/runtime && npx vitest run test/integration/cli.test.ts --root studio/runtime
npm test -w @studio/runtime
npx tsc --noEmit -p studio/runtime/tsconfig.json
```

Expected: PASS. Existing `cli.test.ts` assertions about `Ready to execute` will now fail — those encode the advisory behaviour this task replaces, so update them to the new contract rather than preserving them. Note in the commit message which assertions changed and why.

- [ ] **Step 8: Commit**

```bash
git add studio/runtime/src/cli.ts studio/runtime/test/integration/cli.test.ts
git commit -m "feat(cli): vpr run claims a stage; vpr complete closes it

run no longer picks the first stage with a missing output file and prints
advice. It selects through the service, checks every gate, takes a lease and
journals. --dry-run is the advisory path, and reports gates the old version
never consulted."
```

---

### Task 5: `vpr status` reports the journal, not the filesystem

**Files:**
- Modify: `studio/runtime/src/cli.ts` (`cmdStatus` at :306)
- Test: `studio/runtime/test/integration/cli.test.ts`

**Interfaces:**
- Consumes: `makeService` from Task 4; `EpisodeStatus`, `StageStatusReport`, `StageState` from Task 3.
- Produces: no new exports. The JSON shape becomes `{ episode, pipeline, stages: StageStatusReport[] }`.

**Context for the implementer:** `cmdStatus` calls `artifactExists` per declared output label to decide `completed`/`runnable`/`pending`, and emits `budget: { currency: "USD", limitMicros, consumed: 0, reserved: 0 }`. Both go. The zero budget is the more dangerous of the two: it is a number a caller can act on, and it is not measured.

- [ ] **Step 1: Write the failing test**

```ts
describe("vpr status reports the journal", () => {
  it("reports pending for a stage with artifacts but no journal", async () => {
    // The exact case avg-7he describes: every episode under library/ has
    // real artifacts and no journal. The old status called those complete.
    const { root, dir } = await episodeFixture();
    await writeFile(join(dir, "artifacts/brief.md"), "a brief written before journals existed");

    const result = await cli(["status", "childrens/fairy-tales/ep", "--library", root, "--json"]);

    expect(result.code).toBe(0);
    const out = JSON.parse(result.stdout);
    const brief = out.stages.find((s: { stageId: string }) => s.stageId === "brief");
    expect(brief.status).toBe("pending");
    expect(brief.state).toBe("runnable");
  });

  it("reports a claimed stage as running, with its holder and expiry", async () => {
    const { root } = await episodeFixture();
    await cli(["run", "childrens/fairy-tales/ep", "--library", root, "--json"]);

    const result = await cli(["status", "childrens/fairy-tales/ep", "--library", root, "--json"]);

    const out = JSON.parse(result.stdout);
    const brief = out.stages.find((s: { stageId: string }) => s.stageId === "brief");
    expect(brief.state).toBe("running");
    expect(brief.lease.state).toBe("live");
    expect(brief.lease.holder).toMatch(/^cli\/pid-/);
  });

  it("no longer reports a budget it cannot measure", async () => {
    const { root } = await episodeFixture();

    const result = await cli(["status", "childrens/fairy-tales/ep", "--library", root, "--json"]);

    expect(JSON.parse(result.stdout).budget).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run build -w @studio/runtime && npx vitest run test/integration/cli.test.ts --root studio/runtime
```

Expected: FAIL — `brief.status` is `completed` (inferred from the file) and `budget` is present.

- [ ] **Step 3: Replace `cmdStatus`'s body**

```ts
async function cmdStatus(ctx: CliContext, args: string[]): Promise<number> {
  const { pipeline: pipelineName, remaining } = extractPipeline(args);
  const pathArg = remaining.find((a: string) => !a.startsWith("--"));
  if (!pathArg) {
    emit(ctx, { error: "Usage: vpr status <channel>/<series>/<episode> [--pipeline <name>]" });
    return EX_USAGE;
  }
  const parsed = parsePath(pathArg);
  if (!parsed) {
    emit(ctx, { error: `Invalid path "${pathArg}"` });
    return EX_USAGE;
  }

  const service = makeService(args);
  const status = await service.status(parsed, pipelineName ?? DEFAULT_PIPELINE);
  if (!status.ok) {
    emit(ctx, { error: `${status.error.code}: ${status.error.message}` });
    return EX_RUNTIME;
  }

  // No budget field. The old one reported `consumed: 0, reserved: 0`
  // unconditionally — a number a caller can act on, that nothing measured.
  // Budget reporting returns when there is a ledger behind it (avg-91o).
  emit(ctx, {
    message: `Status for ${parsed.channel}/${parsed.series}/${parsed.episode}`,
    episode: parsed,
    pipeline: status.value.pipeline,
    stages: status.value.stages,
  });
  return EX_OK;
}
```

Remove the now-unused `artifactExists` import if `cmdRun` no longer uses it either (Task 4 removed its other call site). Check with `grep -n artifactExists studio/runtime/src/cli.ts` before removing, and leave `resolveSettings`/`emptyLayer` alone — other commands use them.

- [ ] **Step 4: Run the tests and typecheck**

```bash
npm test -w @studio/runtime
npx tsc --noEmit -p studio/runtime/tsconfig.json
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/runtime/src/cli.ts studio/runtime/test/integration/cli.test.ts
git commit -m "feat(cli): vpr status replays the journal instead of stat-ing artifacts

An episode with artifacts and no journal now reports pending, which is the
truth. The unconditional zero-consumption budget is gone: a number nothing
measured is worse than no number."
```

---

### Task 6: `vpr rerun` plans from the journal, and refuses the mode it cannot compute

**Files:**
- Modify: `studio/runtime/src/rerun/planner.ts:20-25`
- Modify: `studio/runtime/src/cli.ts` (`cmdRerun` at :405)
- Test: `studio/runtime/test/unit/rerun/planner.test.ts` (if absent, create)
- Test: `studio/runtime/test/integration/cli.test.ts`

**Interfaces:**
- Consumes: `makeService` from Task 4; `ExecutionService.status` and `ExecutionService.rerun`.
- Produces: `planRerun(report: StalenessReport | undefined, pipeline, stages, mode, selectedStages?)` — `report` becomes optional and the `rerun-affected-downstream` branch raises when it is absent.

**Context for the implementer:** `cmdRerun` today emits `Rerun plan (<mode>): 0 stage(s)` with an empty `stages` array, always, for every mode, whether or not the episode exists. `planRerun` reads its `report` argument in exactly one place — `planner.ts:51`, the `rerun-affected-downstream` case — so the three other modes need no staleness at all. The CLI's current default mode string, `rerun-affected`, matches no member of `RerunMode` and has never done anything.

- [ ] **Step 1: Write the failing tests**

For the planner:

```ts
import { describe, expect, it } from "vitest";
import { planRerun } from "../../../src/rerun/planner.js";

describe("planRerun without a staleness report", () => {
  it("plans full-rebuild from the stage map alone", () => {
    const plan = planRerun(undefined, pipelineOf(["a", "b"]), instancesOf(["a", "b"]), "full-rebuild");
    expect(plan.rerunStageIds).toEqual(["a", "b"]);
  });

  it("plans retry-current from the stage map alone", () => {
    const stages = instancesOf(["a", "b"]);
    stages.get("a")!.status = "failed";
    const plan = planRerun(undefined, pipelineOf(["a", "b"]), stages, "retry-current");
    expect(plan.rerunStageIds).toEqual(["a"]);
  });

  it("raises for rerun-affected-downstream, which needs staleness", () => {
    expect(() =>
      planRerun(undefined, pipelineOf(["a", "b"]), instancesOf(["a", "b"]), "rerun-affected-downstream"),
    ).toThrow(/staleness/i);
  });
});
```

Write `pipelineOf` and `instancesOf` as local helpers in that file, building the minimal `ResolvedPipeline` and `Map<string, StageInstance>` shapes the planner reads — it uses only `pipeline.stages[].definition.id` and each instance's `status` and `attempts`.

For the CLI:

```ts
describe("vpr rerun", () => {
  it("names the stages it would rerun, rather than reporting zero", async () => {
    const { root, dir } = await episodeFixture();
    await cli(["run", "childrens/fairy-tales/ep", "--library", root, "--json"]);
    await writeFile(join(dir, "artifacts/brief.md"), "a brief");
    await cli(["complete", "childrens/fairy-tales/ep", "brief", "--outputs", "artifacts/brief.md", "--library", root, "--json"]);

    const result = await cli([
      "rerun", "childrens/fairy-tales/ep", "--mode", "rerun-selected",
      "--stages", "brief", "--library", root, "--json", "--dry-run",
    ]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).stages).toEqual(["brief"]);
  });

  it("refuses rerun-affected-downstream by name and says what owns it", async () => {
    const { root } = await episodeFixture();

    const result = await cli([
      "rerun", "childrens/fairy-tales/ep", "--mode", "rerun-affected-downstream",
      "--library", root, "--json",
    ]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).error).toMatch(/staleness/i);
  });

  it("refuses the mode string that never matched a mode", async () => {
    const { root } = await episodeFixture();

    const result = await cli([
      "rerun", "childrens/fairy-tales/ep", "--mode", "rerun-affected", "--library", root, "--json",
    ]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).error).toMatch(/rerun-affected-downstream/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm run build -w @studio/runtime && npx vitest run test/unit/rerun test/integration/cli.test.ts --root studio/runtime
```

Expected: FAIL — `planRerun` requires a report; `vpr rerun` exits 0 with zero stages for every input.

- [ ] **Step 3: Make `report` optional in `planRerun`**

```ts
/**
 * Generate a rerun plan from pipeline, stage instances, and mode.
 *
 * `report` is optional because exactly one mode reads it. The three others
 * derive their rerun set from the stage map alone — which is what
 * `deriveExecutionState` produces — so requiring staleness for all four would
 * make a caller fabricate an empty report to satisfy a signature, and an
 * empty report silently plans nothing. The type says which mode depends on
 * staleness; the throw says so at the one moment it matters.
 */
export function planRerun(
  report: StalenessReport | undefined,
  pipeline: ResolvedPipeline,
  stages: Map<string, StageInstance>,
  mode: RerunMode,
  selectedStages?: string[],
): RerunPlan {
```

and in the switch:

```ts
    case "rerun-affected-downstream":
      if (!report) {
        throw new Error(
          'mode "rerun-affected-downstream" needs a staleness report, which is not computed yet (avg-33r)',
        );
      }
      rerunSet = new Set([...(selectedStages ?? []), ...report.stale]);
      break;
```

Also change `episodeSlug: report.episodeSlug` (or equivalent uses of `report` in building the plan) to take the slug from the pipeline or a new argument — check every other `report.` reference in the function and remove the dependency. If `episodeSlug` is only cosmetic, derive it from `pipeline.name` and note that in a comment.

- [ ] **Step 4: Rewrite `cmdRerun`**

```ts
const JOURNAL_DERIVABLE_MODES = ["retry-current", "rerun-selected", "full-rebuild"] as const;

async function cmdRerun(ctx: CliContext, args: string[]): Promise<number> {
  const { pipeline: pipelineName, remaining } = extractPipeline(args);
  const pathArg = remaining.find((a: string) => !a.startsWith("--"));
  if (!pathArg) {
    emit(ctx, { error: "Usage: vpr rerun <channel>/<series>/<episode> [--mode <mode>] [--stages a,b]" });
    return EX_USAGE;
  }
  const parsed = parsePath(pathArg);
  if (!parsed) {
    emit(ctx, { error: `Invalid path "${pathArg}"` });
    return EX_USAGE;
  }

  const modeIdx = remaining.indexOf("--mode");
  const mode = (modeIdx >= 0 ? remaining[modeIdx + 1] : "retry-current") as string;

  if (mode === "rerun-affected-downstream") {
    emit(ctx, {
      error: 'mode "rerun-affected-downstream" needs staleness propagation, ' +
        "which is not implemented yet (avg-33r). Available: " + JOURNAL_DERIVABLE_MODES.join(", "),
    });
    return EX_USAGE;
  }
  if (!JOURNAL_DERIVABLE_MODES.includes(mode as typeof JOURNAL_DERIVABLE_MODES[number])) {
    emit(ctx, {
      error: `Unknown mode "${mode}". Available: ${JOURNAL_DERIVABLE_MODES.join(", ")}` +
        ' (and "rerun-affected-downstream", once avg-33r lands)',
    });
    return EX_USAGE;
  }

  const stagesIdx = remaining.indexOf("--stages");
  const selected = stagesIdx >= 0
    ? remaining[stagesIdx + 1]!.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const service = makeService(args);
  const pipeline = pipelineName ?? DEFAULT_PIPELINE;

  const plan = await service.planRerun(parsed, pipeline, mode as RerunMode, selected);
  if (!plan.ok) {
    emit(ctx, { error: `${plan.error.code}: ${plan.error.message}` });
    return EX_RUNTIME;
  }

  if (ctx.dryRun) {
    emit(ctx, {
      message: `[DRY RUN] Rerun plan (${mode}): ${plan.value.rerunStageIds.length} stage(s)`,
      mode, dryRun: true, stages: plan.value.rerunStageIds,
      estimatedCost: plan.value.totalEstimatedCost,
    });
    return EX_OK;
  }

  const outcomes = await service.rerun(parsed, pipeline, plan.value.rerunStageIds);
  if (!outcomes.ok) {
    emit(ctx, {
      error: `${outcomes.error.code}: ${outcomes.error.message}`,
      ...(outcomes.error.partialOutcomes ? { partial: outcomes.error.partialOutcomes } : {}),
    });
    return EX_RUNTIME;
  }
  emit(ctx, {
    message: `Rerun (${mode}): ${outcomes.value.length} stage(s)`,
    mode, stages: plan.value.rerunStageIds,
    outcomes: outcomes.value.map(outcomeFields),
  });
  return EX_OK;
}
```

- [ ] **Step 5: Add `planRerun` to the service**

`cmdRerun` needs a plan built from replay, and building it in the CLI would put stage-map construction into a second place. Add to `ExecutionService`:

```ts
  /**
   * Which stages a rerun would touch.
   *
   * The stage map `planRerun` needs is exactly what replay produces, so this
   * is replay plus the planner — no new machinery, and no second notion of
   * what a rerun covers.
   */
  async planRerun(
    ref: EpisodeRef,
    pipeline: string,
    mode: RerunMode,
    selectedStages: string[] = [],
  ): Promise<Result<RerunPlan, ExecutionError>> {
    const resolved = await this.resolve(pipeline);
    if (!resolved.ok) return resolved;

    const episodeDir = this.episodeDir(ref);
    const events = await this.readJournal(episodeDir);
    if (!events.ok) return events;

    const stageIds = resolved.value.stages.map((s) => s.definition.id);
    let derived;
    try {
      derived = deriveExecutionState(events.value, stageIds, this.now());
    } catch (e) {
      return err({
        code: "REPLAY_INVALID",
        message: `Journal and pipeline disagree: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    const engineInstances = new Map(
      resolved.value.stages.map((s) => [
        s.definition.id, this.toEngineInstance(derived.get(s.definition.id)!, s),
      ]),
    );

    try {
      return ok(planRerun(undefined, resolved.value, engineInstances, mode, selectedStages));
    } catch (e) {
      return err({
        code: "STAGE_UNKNOWN",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
```

Import `planRerun` and the `RerunMode`/`RerunPlan` types from `../rerun/index.js`, and re-export `planRerun`'s availability through `src/execution/index.ts` only if a consumer outside the service needs it — it does not.

- [ ] **Step 6: Run the tests and typecheck**

```bash
npm test -w @studio/runtime
npx tsc --noEmit -p studio/runtime/tsconfig.json
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add studio/runtime/src/rerun/planner.ts studio/runtime/src/execution/service.ts \
        studio/runtime/src/cli.ts studio/runtime/test/
git commit -m "feat(cli): vpr rerun plans from replay and refuses the mode it cannot compute

planRerun reads its staleness report in exactly one branch, so the three
journal-derivable modes work today and rerun-affected-downstream raises
rather than silently planning nothing (avg-33r owns it)."
```

---

### Task 7: One service composition, and the gateway's remaining execute paths on it

**Files:**
- Create: `studio/gateway/src/runtime/service.ts`
- Modify: `studio/gateway/src/routes/production.ts` (single-stage route at :143, status route at :256, the inline composition at :200-216)
- Test: `studio/gateway/test/single-stage-route.test.ts` (create)

**Interfaces:**
- Consumes: `ExecutionService`, `StageOutcome` from `@studio/runtime`; `GatewayDispatcher` from `../runtime/dispatcher.js`; `GatewayReviewGate` from `../runtime/review-gate.js`; `builtinPipelinesPath` from `../runtime/client.js`.
- Produces: `makeExecutionService(log: (message: string) => void): ExecutionService` exported from `studio/gateway/src/runtime/service.ts`.

**Context for the implementer:** `/execute` builds an `ExecutionService` inline in its handler (`production.ts:200-216`), including a long comment about why `builtinPipelinesPath() || undefined` needs the `|| undefined`. Four routes now need that composition. Extract it once — a fifth copy is how the `builtinPipelines` bug got in, which made every built-in pipeline resolve to nothing on an ordinary install.

The single-stage route currently calls `runtime.run(ref, stageId, dryRun, pipeline)`, which shells out to `vpr run`. The web UI's "Run stage" button uses this route: today it prints advice, executes nothing, and reports success.

- [ ] **Step 1: Write the failing test**

Create `studio/gateway/test/single-stage-route.test.ts`. Follow the app-construction and auth pattern in `studio/gateway/test/gate-enforcement.test.ts` — reuse its `buildApp`/fixture helpers rather than writing new ones.

```ts
describe("POST /stages/:stage/execute", () => {
  it("performs a stage the gateway has a handler for, and journals it", async () => {
    const { app, dir, token } = await appWithEpisode();
    await seedCompleted(dir, ["brief", "script", "art-direction", "terminal-recordings"]);

    const res = await app.inject({
      method: "POST",
      url: "/api/channels/childrens/series/fairy-tales/episodes/ep/stages/illustrations/execute",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.outcome.status).toBe("awaiting_review");

    const events = await readJournal(dir);
    expect(events.some((e) => e.type === "stage-completed" &&
      (e.data as { stageId?: string }).stageId === "illustrations")).toBe(true);
  });

  it("blocks a stage the gateway has no handler for, rather than reporting success", async () => {
    // What this route did before: shell out to `vpr run`, which printed
    // "Ready to execute: brief" and exited 0. The studio's Run button
    // reported success and nothing had happened.
    const { app, dir, token } = await appWithEpisode();

    const res = await app.inject({
      method: "POST",
      url: "/api/channels/childrens/series/fairy-tales/episodes/ep/stages/brief/execute",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.outcome.status).toBe("blocked");
    expect(body.outcome.reason).toMatch(/does not handle/);
    await expect(readJournal(dir)).rejects.toThrow();
  });

  it("refuses a stage the pipeline does not declare", async () => {
    const { app, token } = await appWithEpisode();

    const res = await app.inject({
      method: "POST",
      url: "/api/channels/childrens/series/fairy-tales/episodes/ep/stages/not-a-stage/execute",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.json().ok).toBe(false);
    expect(res.json().error.code).toBe("STAGE_UNKNOWN");
  });
});

describe("GET /status", () => {
  it("reports pending for a stage with artifacts and no journal", async () => {
    const { app, dir, token } = await appWithEpisode();
    await writeFile(join(dir, "artifacts/brief.md"), "written before journals existed");

    const res = await app.inject({
      method: "GET",
      url: "/api/channels/childrens/series/fairy-tales/episodes/ep/status",
      headers: { authorization: `Bearer ${token}` },
    });

    const brief = res.json().stages.find((s: { stageId: string }) => s.stageId === "brief");
    expect(brief.state).toBe("runnable");
    expect(brief.status).toBe("pending");
  });
});

describe("claim and complete over HTTP", () => {
  it("claims a stage, then completes it with the outputs the caller names", async () => {
    const { app, dir, token } = await appWithEpisode();

    const claimed = await app.inject({
      method: "POST",
      url: "/api/channels/childrens/series/fairy-tales/episodes/ep/stages/brief/claim",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(claimed.json().outcome.status).toBe("claimed");

    await writeFile(join(dir, "artifacts/brief.md"), "a real brief");

    const done = await app.inject({
      method: "POST",
      url: "/api/channels/childrens/series/fairy-tales/episodes/ep/stages/brief/complete",
      headers: { authorization: `Bearer ${token}` },
      payload: { outputs: ["artifacts/brief.md"] },
    });
    expect(done.json().outcome.status).toBe("completed");

    const events = await readJournal(dir);
    expect(events.map((e) => e.type)).toEqual(["stage-leased", "stage-started", "stage-completed"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/single-stage-route.test.ts --root studio/gateway
```

Expected: FAIL — the claim and complete routes 404, and the single-stage route reports the CLI's advisory output.

- [ ] **Step 3: Create the shared composition**

`studio/gateway/src/runtime/service.ts`:

```ts
// ---------------------------------------------------------------------------
// The execution service, composed for the gateway
// ---------------------------------------------------------------------------
// Four routes need this composition — execute, the single-stage execute,
// claim and complete. It lives here rather than inline in each handler
// because a copy is how the builtinPipelines bug got in: the route that
// omitted it resolved every built-in pipeline to nothing on an ordinary
// install, and looked fine in a test that supplied its own manifests.
// ---------------------------------------------------------------------------

import { ExecutionService } from "@studio/runtime";
import { GatewayDispatcher } from "./dispatcher.js";
import { GatewayReviewGate } from "./review-gate.js";
import { builtinPipelinesPath } from "./client.js";

export function makeExecutionService(log: (message: string) => void): ExecutionService {
  return new ExecutionService({
    libraryRoot: process.env.AVG_LIBRARY_ROOT ?? "./library",
    // `|| undefined` rather than the bare call: builtinPipelinesPath()
    // returns "" when package resolution fails, and createDefaultLoader's
    // `??` does not fall back on an empty string — so AVG_BUILTIN_PIPELINES,
    // the operator's escape hatch, would be dead exactly when it is needed.
    builtinPipelines: builtinPipelinesPath() || undefined,
    dispatcher: new GatewayDispatcher(),
    review: new GatewayReviewGate(),
    // No budget subsystem is wired anywhere yet (avg-91o). An explicit
    // pass-through keeps the gap visible rather than blocking every stage
    // for a reason nobody can act on.
    budget: { maySpend: async () => ({ ok: true as const, value: { reserveId: "gateway", estimatedCost: 0 } }) },
    holder: `gateway/pid-${process.pid}`,
    // Stated, not inherited — the same reasoning as the CLI's composition.
    // The engine's 5-minute default was sized for a synchronous dispatcher;
    // the claim routes hand stages to Pi, which thinks for minutes.
    leaseTtlMs: Number(process.env.AVG_CLAIM_TTL_MS ?? 15 * 60 * 1000),
    log,
  });
}
```

Replace the inline composition in the `/execute` handler with `const service = makeExecutionService((message) => request.log.info(message));` and delete the now-unused imports of `ExecutionService`, `GatewayDispatcher`, `GatewayReviewGate` and `builtinPipelinesPath` from `production.ts`.

- [ ] **Step 4: Move the single-stage route onto the service**

Replace the handler at `production.ts:164-170`:

```ts
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const stageId = (request.params as Record<string, string>).stage!;
    const { dryRun } = request.body as { dryRun?: boolean };
    const pipeline = await inheritedPipeline(workspace, ref) ?? "narrated-illustrated-video";

    const service = makeExecutionService((message) => request.log.info(message));
    const outcome = await service.run(ref, pipeline, { stage: stageId, dryRun: dryRun ?? false });

    return outcome.ok
      ? { ok: true, outcome: outcome.value }
      : { ok: false, error: outcome.error };
  });
```

`ok` means the service reached a verdict. A `blocked` outcome is `ok: true` with a `blocked` status — the same convention `/execute` uses, and the reason it is safe here is that the outcome is in the body for the caller to read.

- [ ] **Step 5: Move the status route onto the service**

Replace the handler body at `production.ts:270-276`:

```ts
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const pipeline = await inheritedPipeline(workspace, ref) ?? "narrated-illustrated-video";

    const service = makeExecutionService((message) => request.log.info(message));
    const status = await service.status(ref, pipeline);
    if (!status.ok) return { ok: false, error: status.error };
    return { ok: true, ...status.value };
  });
```

Update the route's `response` schema if it declares one, so the `stages` items carry `stageId`, `name`, `status`, `state`, `attempts`, `outputArtifacts`, `lease` and `dependenciesMet`. Check the existing schema block before writing: Fastify strips properties a response schema does not declare, so an out-of-date schema here silently deletes the `state` field the studio is about to switch on.

- [ ] **Step 6: Add the claim and complete routes**

After the single-stage execute route:

```ts
  // ── Claim a stage for an out-of-process performer ─────────────────────────
  app.post("/api/channels/:channel/series/:series/episodes/:episode/stages/:stage/claim", {
    schema: {
      description:
        "Lease a stage and record that it has started, for a performer that is not this process. " +
        "The caller must close it with the matching complete call; an abandoned claim expires on its own.",
      tags: ["production"],
      params: {
        type: "object",
        required: ["channel", "series", "episode", "stage"],
        properties: {
          channel: { type: "string" }, series: { type: "string" },
          episode: { type: "string" }, stage: { type: "string" },
        },
      },
      body: { type: "object", properties: { dryRun: { type: "boolean", default: false } } },
    },
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const stageId = (request.params as Record<string, string>).stage!;
    const { dryRun } = request.body as { dryRun?: boolean };
    const pipeline = await inheritedPipeline(workspace, ref) ?? "narrated-illustrated-video";

    const service = makeExecutionService((message) => request.log.info(message));
    const outcome = await service.claim(ref, pipeline, { stage: stageId, dryRun: dryRun ?? false });
    return outcome.ok ? { ok: true, outcome: outcome.value } : { ok: false, error: outcome.error };
  });

  // ── Complete a claimed stage ──────────────────────────────────────────────
  app.post("/api/channels/:channel/series/:series/episodes/:episode/stages/:stage/complete", {
    schema: {
      description:
        "Close a claimed stage with the outputs the performer wrote, or report that it failed.",
      tags: ["production"],
      params: {
        type: "object",
        required: ["channel", "series", "episode", "stage"],
        properties: {
          channel: { type: "string" }, series: { type: "string" },
          episode: { type: "string" }, stage: { type: "string" },
        },
      },
      body: {
        type: "object",
        properties: {
          outputs: { type: "array", items: { type: "string" } },
          leaseId: { type: "string" },
          failed: { type: "boolean", default: false },
          error: { type: "string" },
        },
      },
    },
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const stageId = (request.params as Record<string, string>).stage!;
    const body = request.body as { outputs?: string[]; leaseId?: string; failed?: boolean; error?: string };
    const pipeline = await inheritedPipeline(workspace, ref) ?? "narrated-illustrated-video";

    if (!body.failed && (body.outputs ?? []).length === 0) {
      throw new GatewayError(
        ErrorCode.VALIDATION_FAILED,
        "outputs is required: name the files the performer wrote, or set failed",
      );
    }

    const service = makeExecutionService((message) => request.log.info(message));
    const outcome = await service.complete(ref, pipeline, stageId, {
      ...(body.failed ? { failed: true, error: body.error } : { outputs: body.outputs }),
      ...(body.leaseId ? { leaseId: body.leaseId } : {}),
    });
    return outcome.ok ? { ok: true, outcome: outcome.value } : { ok: false, error: outcome.error };
  });
```

Check `ErrorCode` for the member that matches a bad request body — `VALIDATION_FAILED` is the name used here; if `studio/gateway/src/errors/index.ts` spells it differently, use the real one.

Both routes are POST and therefore require authentication under the gateway's existing rule; confirm by checking how the sibling `/execute` route is protected and match it.

- [ ] **Step 7: Run the tests and typecheck**

```bash
npx vitest run --root studio/gateway
npm run typecheck -w @studio/gateway
```

Expected: PASS, including all 297 pre-existing gateway tests. `runtime-client.test.ts` may assert on `runtime.run`/`status`/`rerun`; leave those alone in this task — Task 8 removes them.

Also confirm by reading that `/execute`'s loop halts on `claimed`. It calls `service.run`, which never returns that status, so the loop is safe today — but the member is now in the shared `OutcomeStatus` union, and the loop's `if (outcome.value.status !== "completed") break;` is what makes it safe. Do not relax that condition into a list of statuses to stop on: a caller looping until nothing advances must halt on every status it does not explicitly know how to continue past.

- [ ] **Step 8: Commit**

```bash
git add studio/gateway/src/runtime/service.ts studio/gateway/src/routes/production.ts \
        studio/gateway/test/single-stage-route.test.ts
git commit -m "feat(gateway): single-stage execute, status, claim and complete go through the service

The studio's Run Stage button shelled out to a CLI that printed advice and
exited zero. It now performs the stage or says why it cannot."
```

---

### Task 8: Delete `routes/runtime.ts`

**Files:**
- Delete: `studio/gateway/src/routes/runtime.ts`
- Modify: `studio/gateway/src/routes/index.ts:9` (import), `:105` (call)
- Modify: `studio/gateway/src/runtime/client.ts` (remove `run` at :136, `status` at :129, `rerun` at :145)
- Modify: `studio/gateway/test/runtime-client.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `RuntimeClient` keeps `health`, `init`, `resolve`, `approve`, `validate` and loses `run`, `status`, `rerun`.

**Context for the implementer:** `routes/runtime.ts` registers eight endpoints — `/runtime/health`, `/init`, `/resolve`, `/status`, `/run`, `/rerun`, `/approve`, `/validate` — that map one-to-one onto `vpr` subcommands. A repository-wide search for any of those paths outside the file that defines them returns nothing: no route is called by the studio, the agent, a test, or any doc. Verify that before deleting:

```bash
grep -rn --include='*.ts' --include='*.svelte' --include='*.md' \
  -e '/runtime/run' -e '/runtime/status' -e '/runtime/rerun' -e '/runtime/approve' \
  -e '/runtime/init' -e '/runtime/resolve' -e '/runtime/validate' -e '/runtime/health' . \
  | grep -v node_modules | grep -v 'routes/runtime.ts'
```

If that returns anything at all, stop and report it — a consumer exists that this plan did not account for, and deleting the surface is no longer a free move.

- [ ] **Step 1: Verify there are no consumers**

Run the grep above. Expected: no output. Record the result in your report.

- [ ] **Step 2: Delete the routes file and its registration**

```bash
git rm studio/gateway/src/routes/runtime.ts
```

In `studio/gateway/src/routes/index.ts`, remove the import at line 9 and the call at line 105, along with the `// ── Runtime endpoints ──` comment banner above it.

- [ ] **Step 3: Remove the three RuntimeClient methods**

In `studio/gateway/src/runtime/client.ts`, delete `status`, `run` and `rerun`. Leave `health`, `init`, `resolve`, `approve` and `validate`: `production.ts` still uses `resolve` behind `/snapshot`, `init` behind `/init`, and `approve` behind `/stages/:stage/approve`. Approval is `avg-qr4.3`'s to move, and `cmdApprove` has written a hash-bound gate-review record since `avg-2n7`, so shelling to it is correct today.

Add a note at the top of the file recording what left and why:

```ts
// `run`, `status` and `rerun` are gone: those are execution, and execution
// goes through ExecutionService (see ../runtime/service.ts). What remains
// here is workspace setup and approval, which the service does not own.
```

- [ ] **Step 4: Update the client's tests**

`studio/gateway/test/runtime-client.test.ts` asserts on the removed methods. Delete exactly those cases — do not rewrite them against the service, which Task 7's tests already cover. Read each test before deleting it: if one asserts something about argument construction or the `vpr` binary discovery that is NOT specific to `run`/`status`/`rerun`, keep it by re-pointing it at `resolve` or `init`.

- [ ] **Step 5: Run the tests and typecheck**

```bash
npx vitest run --root studio/gateway
npm run typecheck -w @studio/gateway
```

Expected: PASS. A typecheck error naming `registerRuntimeRoutes` means the registration was missed.

- [ ] **Step 6: Commit**

```bash
git add -A studio/gateway/
git commit -m "refactor(gateway): delete the /runtime/* CLI passthrough surface

Eight endpoints exposing vpr subcommands over HTTP, with no callers anywhere
in the repository. A second execute surface kept alive by nobody is an
invitation to wire the wrong one."
```

---

### Task 9: The studio's action mapping matches the states the service reports

**Files:**
- Modify: `studio/web/src/lib/production-store.svelte.ts:15-37`
- Modify: `studio/web/src/contracts/gateway.ts:84-88`
- Modify: `studio/gateway/src/contracts/types.ts:60-64`
- Test: `studio/web/test/unit/production-actions.test.ts` (create)

**Interfaces:**
- Consumes: the `StageState` vocabulary from Task 3 — `pending | runnable | running | blocked | failed | completed | awaiting_review`.
- Produces: `actionsFor(state: string): Array<"run" | "approve">` handling exactly those seven; `StageStatus.state` typed to them.

**Context for the implementer:** `actionsFor` currently accepts `runnable`, `awaiting_approval`, `awaiting_review`, `complete` and `completed` — a set assembled from two vocabularies, of which the old `vpr status` emitted exactly two (`completed`, `runnable`). `awaiting_approval` appears in `studio/web/src/contracts/gateway.ts` and `studio/gateway/src/contracts/types.ts`; nothing produces it. `skipped` sits beside it and became unreachable when `runAutopilot` was deleted in `avg-2n7`.

- [ ] **Step 1: Write the failing test**

Create `studio/web/test/unit/production-actions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { actionsFor } from "../../src/lib/production-store.svelte.ts";

describe("what the studio offers for each state", () => {
  it("offers run only where a run would be accepted", () => {
    expect(actionsFor("runnable")).toEqual(["run"]);
    expect(actionsFor("completed")).toEqual(["run"]);
    expect(actionsFor("failed")).toEqual(["run"]);
  });

  it("offers approve for a stage waiting on acceptance", () => {
    expect(actionsFor("awaiting_review")).toEqual(["approve"]);
  });

  it("offers nothing for a stage that cannot act", () => {
    // A blocked stage's condition is someone else's to clear, and a running
    // one is held by a live lease. Offering a button that the service will
    // refuse is how the Run Stage button came to report success for work
    // that never happened.
    expect(actionsFor("pending")).toEqual([]);
    expect(actionsFor("blocked")).toEqual([]);
    expect(actionsFor("running")).toEqual([]);
  });

  it("offers nothing for a state it does not know", () => {
    expect(actionsFor("awaiting_approval")).toEqual([]);
    expect(actionsFor("skipped")).toEqual([]);
    expect(actionsFor("")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/unit/production-actions.test.ts --root studio/web
```

Expected: FAIL — `awaiting_approval` returns `["approve"]`, `failed` and `blocked` are unhandled.

- [ ] **Step 3: Rewrite `actionsFor` and the `StageStatus` type**

```ts
/**
 * A stage's place in its pipeline, as the execution service reports it.
 *
 * Seven members and no synonyms. The previous set carried `awaiting_approval`
 * beside `awaiting_review` and `complete` beside `completed` — two spellings
 * for one state each, from two vocabularies, of which the runtime emitted
 * neither pair consistently.
 */
export type StageState =
  | "pending" | "runnable" | "running" | "blocked" | "failed" | "completed" | "awaiting_review";

// This mirrors `StageState` in studio/runtime/src/execution/types.ts. The
// studio cannot import from the runtime package, so the two are separate
// declarations of one vocabulary and must be changed together. `actionsFor`'s
// `default` branch is what keeps a drift safe rather than silent: a member
// added there and not here yields no buttons, never the wrong ones.

export interface StageStatus {
  id: string;
  state: StageState;
  dependsOn: string[];
  /** Artifact labels this stage produces, e.g. ["script.md"]. */
  produces: string[];
  /** Why, when `state` is `blocked`. Shown rather than hidden: it names what to fix. */
  blockedReason?: string;
}

/**
 * What the studio is allowed to offer for a stage in a given state.
 *
 * Only what the service will accept. A button the service refuses is worse
 * than no button: the Run Stage button used to report success for a request
 * that printed advice to a log and executed nothing.
 */
export function actionsFor(state: string): Array<"run" | "approve"> {
  switch (state) {
    // Runnable now; completed and failed are reruns, which the service
    // supports for an explicitly named stage.
    case "runnable":
    case "completed":
    case "failed":
      return ["run"];
    case "awaiting_review":
      return ["approve"];
    // pending, blocked, running — and anything this build does not know.
    default:
      return [];
  }
}
```

- [ ] **Step 4: Remove the two dead status members**

In `studio/web/src/contracts/gateway.ts` and `studio/gateway/src/contracts/types.ts`, delete `"awaiting_approval"` and `"skipped"` from the stage-status union. Compile after each: a reference elsewhere means something reads a state nothing produces, which is worth seeing rather than preserving.

- [ ] **Step 5: Check the store's other readers of `state`**

```bash
grep -rn --include='*.ts' --include='*.svelte' -e 'awaiting_approval' -e "state ===" -e 'stage.state' studio/web/src/
```

Update anything comparing against the removed spellings. A Svelte component branching on `complete` (singular) needs `completed`.

- [ ] **Step 6: Run the tests and typecheck**

```bash
npx vitest run --root studio/web
npm run typecheck -w @studio/web
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add studio/web/ studio/gateway/src/contracts/types.ts
git commit -m "fix(web): offer only the actions the service will accept

actionsFor carried two spellings each for two states, from two vocabularies,
and offered approve for awaiting_approval, which nothing produces."
```

---

### Task 10: The agent claims and completes, and its tools describe what they do

**Files:**
- Modify: `studio/agent/src/pipeline-tools.ts`

**Interfaces:**
- Consumes: the gateway routes from Task 7 — `POST .../stages/:stage/claim` and `POST .../stages/:stage/complete`.
- Produces: the Pi tools `pva_claim_stage` and `pva_complete_stage`.

**Context for the implementer:** This file registers eight Pi tools over the gateway's HTTP API using `pi.registerTool` and typebox schemas. Follow the existing shape exactly: `Type.Object({...})` parameters, an `execute` that calls `client.fetch`, and a return of `{ content: [{ type: "text", text }], details: {...} }` with `isError: true as unknown as boolean` on the failure path.

These two tools are what let the pipeline start. Six of the ten stages in the default pipeline — `brief`, `script`, `art-direction`, `terminal-recordings`, `narration`, `compose` — have no handler in the gateway, and `brief` is first. Pi is what performs them.

- [ ] **Step 1: Add `pva_claim_stage`**

After the `pva_run_stage` registration:

```ts
  // --- Tool: pva_claim_stage ---------------------------------------------

  pi.registerTool({
    name: "pva_claim_stage",
    label: "Claim Stage",
    description:
      "Take a pipeline stage so you can perform it yourself. Leases the stage, records that it " +
      "has started, and returns a deadline. Use this for stages the gateway has no automated " +
      "handler for — brief, script, art-direction — then do the work and call pva_complete_stage. " +
      "The claim expires on its own if you abandon it.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      stageId: Type.String({ description: "Stage ID to claim" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const client = await getClient();
        const result = await client.fetch(
          `/api/channels/${params.channel}/series/${params.series}/episodes/${params.episode}/stages/${params.stageId}/claim`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          },
        );

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: { claim: result },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Claim failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });
```

- [ ] **Step 2: Add `pva_complete_stage`**

```ts
  // --- Tool: pva_complete_stage ------------------------------------------

  pi.registerTool({
    name: "pva_complete_stage",
    label: "Complete Stage",
    description:
      "Close a stage you claimed. Name the files you wrote — the runtime checks they exist and " +
      "are non-empty, and records them. Pass failed with an error instead if the work did not " +
      "succeed. A claim that has already expired is refused: take the stage again with " +
      "pva_claim_stage before redoing the work.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      stageId: Type.String({ description: "Stage ID to complete" }),
      outputs: Type.Optional(Type.Array(Type.String(), {
        description: "Paths written, relative to the episode directory. Required unless failed.",
      })),
      failed: Type.Optional(Type.Boolean({ description: "The work did not succeed" })),
      error: Type.Optional(Type.String({ description: "Why, when failed" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const client = await getClient();
        const result = await client.fetch(
          `/api/channels/${params.channel}/series/${params.series}/episodes/${params.episode}/stages/${params.stageId}/complete`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              outputs: params.outputs ?? [],
              failed: params.failed ?? false,
              error: params.error,
            }),
          },
        );

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: { completion: result },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Completion failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });
```

- [ ] **Step 3: Correct the descriptions that overstate**

`pva_run_stage`, currently "Execute a single pipeline stage and wait for completion":

```ts
    description:
      "Run a single pipeline stage using the gateway's own handler for it — illustrations, " +
      "captions, timing, qa. Returns when the stage has finished. Stages with no handler come " +
      "back blocked rather than running: claim those with pva_claim_stage and perform them yourself.",
```

`pva_run_pipeline`, currently "Execute all pending pipeline stages in topological order":

```ts
    description:
      "Run pending stages in dependency order, stopping at the first stage that is blocked, " +
      "fails, or is awaiting review. Stops at any stage the gateway has no handler for — " +
      "claim that stage and perform it, then call this again to continue.",
```

`pva_check_staleness`, currently "Check which artifacts are stale after changes to upstream stages":

```ts
    description:
      "Not implemented yet: staleness propagation is unbuilt (avg-33r), and this returns an " +
      "empty result rather than a computed one. Do not treat an empty result as evidence that " +
      "nothing is stale.",
```

`pva_plan_rerun`'s mode union carries `rerun-affected`, which matches no member of `RerunMode`. Replace the union and the description:

```ts
      mode: Type.Optional(
        Type.Union([
          Type.Literal("retry-current"),
          Type.Literal("rerun-selected"),
          Type.Literal("full-rebuild"),
        ], { description: "Rerun mode. rerun-affected-downstream needs staleness (avg-33r) and is refused." }),
      ),
```

and change the body's default from `params.mode ?? "rerun-affected"` to `params.mode ?? "retry-current"`.

- [ ] **Step 4: Build the agent and run its suite**

```bash
npm run build -w @studio/agent 2>/dev/null || npx tsc --noEmit -p studio/agent/tsconfig.json
npm test -w @studio/agent
```

Expected: PASS, all 184 tests. `studio/agent` has no test directory of its own for this file; if the build script does not exist, the typecheck is the gate.

- [ ] **Step 5: Commit**

```bash
git add studio/agent/src/pipeline-tools.ts
git commit -m "feat(agent): Pi can claim and complete stages the gateway has no handler for

This is what lets the pipeline start: brief, script and art-direction have no
automated performer, and brief is the first stage. Also corrects four tool
descriptions that claimed more than the code behind them does."
```

---

### Task 11: A pipeline that runs from end to end

**Files:**
- Test: `studio/runtime/test/integration/pipeline-end-to-end.test.ts` (create)

**Interfaces:**
- Consumes: `ExecutionService.claim`, `complete`, `run`, `status` from Tasks 1-3.
- Produces: nothing. This task adds no source code.

**Context for the implementer:** Nothing in this repository has ever run a pipeline to completion. Every slice so far has tested its own layer against fakes. This test drives the real ten-stage `narrated-illustrated-video` manifest from `brief` to `qa`, alternating claim/complete for the six stages with no handler against dispatcher runs for the four that have one, and then asserts the journal is coherent.

If this test cannot be made to pass, that is a finding about the design, not a test to weaken. Report what blocked it.

Two stages will not run: `script` and `compose` declare `autopilot: false`, and the service has no way to express that a person is present (`avg-qr4.3`). The test must therefore use a pipeline manifest of its own — a ten-stage chain with the same shape and dependency structure as the real one, but with `autopilot: true` throughout — and separately assert that the real manifest blocks at `script` for the documented reason. Both halves matter: the first proves the machinery works end to end, the second pins the one thing that stops the shipped pipeline.

- [ ] **Step 1: Write the end-to-end test**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ExecutionService } from "../../src/execution/service.js";
import type { StageDispatcher } from "../../src/execution/types.js";
import { parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { deriveExecutionState } from "@studio/contracts/src/execution-state.mjs";
import { ok } from "../../src/result.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_PIPELINES = resolve(__dirname, "../../../pipelines/pipelines");
const REF = { channel: "childrens", series: "fairy-tales", episode: "ep" };

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

/**
 * The shipped pipeline's shape with autopilot: true throughout.
 *
 * `script` and `compose` declare autopilot: false in the real manifest, and
 * the service has no way to express that a person is at the controls
 * (avg-qr4.3). A fixture that keeps their dependency structure but lets them
 * run is what makes an end-to-end assertion possible at all; the real
 * manifest's refusal is asserted separately below.
 */
async function runnablePipeline(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "e2e-pipeline-"));
  roots.push(dir);
  const stage = (id: string, dependsOn: string[], review: "none" | "human") => [
    `    - id: ${id}`,
    `      name: "${id}"`,
    `      type: editorial`,
    ...(dependsOn.length
      ? [`      inputs:`, ...dependsOn.flatMap((d) => [`        - contract: ${d}.md`, `          version: "1.0.0"`])]
      : []),
    `      outputs:`,
    `        - contract: ${id}.md`,
    `          version: "1.0.0"`,
    `      gates:`,
    `        autopilot: true`,
    `        review: ${review}`,
    `        retry_on_failure: 0`,
    `      depends_on:`,
    ...(dependsOn.length ? dependsOn.map((d) => `        - ${d}`) : ["        []"]),
    ``,
  ].join("\n");

  await writeFile(join(dir, "e2e.yaml"), [
    "pipeline:",
    "  id: e2e",
    '  version: "1.0.0"',
    "  stages:",
    stage("brief", [], "none"),
    stage("script", ["brief"], "none"),
    stage("art-direction", ["script"], "none"),
    stage("terminal-recordings", ["art-direction"], "none"),
    stage("illustrations", ["art-direction"], "none"),
    stage("narration", ["script"], "none"),
    stage("captions", ["narration"], "none"),
    stage("timing", ["captions"], "none"),
    stage("compose", ["illustrations", "timing", "terminal-recordings"], "none"),
    stage("qa", ["compose"], "none"),
  ].join("\n"));
  return dir;
}

/** Performs only the four stages the gateway has handlers for. */
function handlerDispatcher(dir: string): StageDispatcher {
  const handled = new Set(["illustrations", "captions", "timing", "qa"]);
  return {
    canDispatch: (stage) => handled.has(stage.definition.id),
    dispatch: async (stage) => {
      const rel = `artifacts/${stage.definition.id}.md`;
      await mkdir(dirname(join(dir, rel)), { recursive: true });
      await writeFile(join(dir, rel), `${stage.definition.id} by handler`);
      return [rel];
    },
  };
}

describe("a pipeline from brief to qa", () => {
  it("runs to completion, alternating claimed stages with dispatched ones", async () => {
    const root = await mkdtemp(join(tmpdir(), "e2e-"));
    roots.push(root);
    const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
    await mkdir(join(dir, "journal"), { recursive: true });
    await mkdir(join(dir, "artifacts"), { recursive: true });

    const pipelineDir = await runnablePipeline();
    const svc = new ExecutionService({
      libraryRoot: root,
      builtinPipelines: pipelineDir,
      budget: { maySpend: async () => ok({ reserveId: "e2e", estimatedCost: 0 }) },
      dispatcher: handlerDispatcher(dir),
      holder: "e2e-test",
    });

    const order: string[] = [];
    for (let i = 0; i < 20; i++) {
      // A dispatcher-backed stage runs here and now.
      const ran = await svc.run(REF, "e2e");
      expect(ran.ok).toBe(true);
      if (!ran.ok) return;
      if (ran.value.status === "idle") break;
      if (ran.value.status === "completed") {
        order.push(`ran:${ran.value.stageId}`);
        continue;
      }

      // Anything else is a stage this process cannot perform. Claim it, do
      // the work the way a performer would, and close the claim.
      expect(ran.value.reason).toMatch(/does not handle/);
      const stageId = ran.value.stageId!;
      const claimed = await svc.claim(REF, "e2e", { stage: stageId });
      expect(claimed.ok && claimed.value.status).toBe("claimed");

      const rel = `artifacts/${stageId}.md`;
      await writeFile(join(dir, rel), `${stageId} by hand`);
      const done = await svc.complete(REF, "e2e", stageId, { outputs: [rel] });
      expect(done.ok && done.value.status).toBe("completed");
      order.push(`claimed:${stageId}`);
    }

    expect(order).toEqual([
      "claimed:brief",
      "claimed:script",
      "claimed:art-direction",
      "claimed:terminal-recordings",
      "ran:illustrations",
      "claimed:narration",
      "ran:captions",
      "ran:timing",
      "claimed:compose",
      "ran:qa",
    ]);

    // Every stage completed, and the journal that says so replays cleanly.
    const status = await svc.status(REF, "e2e");
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.value.stages.every((s) => s.state === "completed")).toBe(true);

    const events = parseJournal(await readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8"), { strict: true });
    const derived = deriveExecutionState(events, status.value.stages.map((s) => s.stageId), new Date());
    for (const [stageId, instance] of derived) {
      expect(instance.status, stageId).toBe("completed");
      expect(instance.attempts.length, stageId).toBe(1);
      expect(instance.attempts[0]!.outcome, stageId).toBe("success");
    }

    // One lease per stage, one start per stage, one terminal event per stage.
    const counts = new Map<string, number>();
    for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    expect(counts.get("stage-leased")).toBe(10);
    expect(counts.get("stage-started")).toBe(10);
    expect(counts.get("stage-completed")).toBe(10);
  });

  it("stops the shipped pipeline at script, and says why", async () => {
    // The one thing standing between this machinery and the real manifest.
    const root = await mkdtemp(join(tmpdir(), "e2e-real-"));
    roots.push(root);
    const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
    await mkdir(join(dir, "journal"), { recursive: true });
    await mkdir(join(dir, "artifacts"), { recursive: true });

    const svc = new ExecutionService({
      libraryRoot: root,
      builtinPipelines: REAL_PIPELINES,
      budget: { maySpend: async () => ok({ reserveId: "e2e", estimatedCost: 0 }) },
      holder: "e2e-test",
    });

    await svc.claim(REF, "narrated-illustrated-video");
    await writeFile(join(dir, "artifacts/brief.md"), "a brief");
    await svc.complete(REF, "narrated-illustrated-video", "brief", { outputs: ["artifacts/brief.md"] });

    const next = await svc.claim(REF, "narrated-illustrated-video");
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.value.stageId).toBe("script");
    expect(next.value.status).toBe("blocked");
    expect(next.value.reason).toMatch(/autopilot: false/);
  });
});
```

- [ ] **Step 2: Run it**

```bash
npm run build -w @studio/runtime && npx vitest run test/integration/pipeline-end-to-end.test.ts --root studio/runtime
```

Expected: PASS. If the `order` array does not match, read the actual order before changing the expectation — the service selects the first stage whose dependencies are met, so the order is determined by the manifest's declaration order and its dependency graph. A different but valid order means the expectation is wrong; a stage appearing twice, or the loop running out of iterations, means the claim/complete seam is wrong.

- [ ] **Step 3: Run every suite**

```bash
npm test -w @studio/contracts
npm test -w @studio/runtime
npm test -w @studio/gateway
npm test -w @studio/agent
npx vitest run --root studio/web
npx tsc --noEmit -p studio/runtime/tsconfig.json
npm run typecheck -w @studio/gateway
npm run typecheck -w @studio/web
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add studio/runtime/test/integration/pipeline-end-to-end.test.ts
git commit -m "test: a pipeline runs from brief to qa

Nothing in this repository had ever run a pipeline to completion. Ten stages,
six claimed and performed out of process, four dispatched — one journal, one
attempt each, replaying cleanly. Plus the shipped manifest's refusal at
script, which is what avg-qr4.3 exists to lift."
```

---

## Notes for whoever executes this

**Tasks 1 and 2 are one refactor split in half.** Task 1 leaves `run` with a reconstructed state machine in its tail that Task 2 deletes. That is deliberate — it keeps each task green and independently reviewable — but do not ship Task 1 alone and stop.

**The 17 gate-enforcement tests in `studio/gateway/test/gate-enforcement.test.ts` are the net for Tasks 1-3.** They encode behaviour bought with the whole of `avg-qr4.1` and re-pointed in `avg-2n7`. A failure there during the refactor is information about the seam. Never adjust one of those tests to make a refactor pass.

**Filed issues this work touches, for context rather than action:** `avg-7he` (the twenty existing episodes have artifacts and no journal, so `status` will now correctly report them all pending), `avg-91o` (no budget ledger, which is why both compositions inject a pass-through guard), `avg-82z` (the root test runner flakes; use per-package), `avg-33r` (staleness), `avg-qr4.3` (attendance and what an approval is), `avg-qr4.4` (capability adapters, which is where the four handlers finally leave the gateway).
