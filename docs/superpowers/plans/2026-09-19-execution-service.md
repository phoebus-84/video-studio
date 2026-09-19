# One Execution Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One `ExecutionService` with a single meaning for `run`, `status` and `rerun`, so the CLI, the gateway and the agent stop each inventing their own.

**Architecture:** A library in `studio/runtime/src/execution/`, instantiated per process, holding no state between calls. `run` claims one stage: resolve the pipeline, derive state by replaying the journal, check gates, lease, dispatch to an injected port, validate the declared outputs, record the attempt. Callers that want a whole episode loop. It writes through `@studio/contracts`' journal — the one replay reads — and drives `StageStateMachine` and `FileLock`, not `StageExecutor`.

**Tech Stack:** TypeScript in `@studio/runtime` (vitest); `@studio/contracts` ESM `.mjs` for the journal and replay.

**Spec:** `docs/superpowers/specs/2026-09-19-execution-service-design.md`

## Global Constraints

- **Issue:** `avg-tt7`, slice B of `avg-qr4.2`. Branch `qr4.2b-execution-service` exists and holds the spec commit.
- **The service writes through `@studio/contracts/src/journal.mjs`.** Never through `studio/runtime/src/journal/` — that is a second, parallel journal with a dotted vocabulary that `deriveExecutionState` does not read. Writing there would produce state nothing can recover, which is the bug slice A existed to fix. Do not import it.
- **Do not use `StageExecutor`** (`studio/runtime/src/engine/executor.ts`). Its only distinct contributions are that wrong journal and an `initStages` that duplicates replay. Use `StageStateMachine` and `FileLock` directly.
- **Journal payloads are validated at write time.** `buildJournalEvent` enforces required fields per execution event: `stage-leased` needs `stageId, leaseId, attemptNumber, ttlMs, expiresAt, holder`; `stage-started` needs `stageId, leaseId, attemptNumber`; `stage-completed` adds `outputs`; `stage-failed` adds `error`. A missing field throws.
- **`appendJournalEvent` returns the event or `null`; it never throws.** It is deliberate that a stage which ran is not reported failed because its bookkeeping could not be written. Known gap: a malformed execution event is therefore silently dropped (`avg-0v5`). Do not change that contract in this plan.
- **Absence is refusal.** No dispatcher means the stage does not run; no budget guard means it does not spend.
- **No file-existence inference anywhere.** Completion comes from the journal, never from whether an output file happens to exist. That inference is the defect `cmdStatus` has today.
- `studio/runtime` uses vitest and has **no `typecheck` script** — use `npx tsc --noEmit -p studio/runtime/tsconfig.json`.
- Baselines that must not regress: runtime 360 tests across 31 files, contracts 116, gateway 278.
- **Commit after every task.**

---

## File Structure

| file | responsibility |
|---|---|
| `studio/runtime/src/engine/state-machine.ts` | **modify** — make terminality explicit, so the lease is released on `failed` as well as `completed` |
| `studio/runtime/src/engine/types.ts` | **modify** — `completed: ["pending"]`, matching replay |
| `studio/runtime/src/execution/types.ts` | **new** — `StageOutcome`, `StageDispatcher`, `BudgetGuard`, options |
| `studio/runtime/src/execution/service.ts` | **new** — `ExecutionService`: `run`, `status`, `rerun` |
| `studio/runtime/src/execution/index.ts` | **new** — public surface |
| `studio/runtime/src/index.ts` | **modify** — export the service from the package root |
| `studio/runtime/test/unit/engine/state-machine.test.ts` | **modify** — lease release on failure |
| `studio/runtime/test/unit/execution/status.test.ts` | **new** |
| `studio/runtime/test/unit/execution/run.test.ts` | **new** |
| `studio/runtime/test/unit/execution/fail-closed.test.ts` | **new** |
| `studio/runtime/test/unit/execution/dry-run-rerun.test.ts` | **new** |
| `studio/runtime/test/unit/execution/concurrency.test.ts` | **new** |

---

### Task 1: Explicit terminality, then the table divergence

**Files:**
- Modify: `studio/runtime/src/engine/state-machine.ts` (the `isTerminal` line inside `transition`)
- Modify: `studio/runtime/src/engine/types.ts` (`VALID_TRANSITIONS`)
- Modify: `studio/runtime/test/unit/engine/state-machine.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `VALID_TRANSITIONS.completed === ["pending"]`, and a state machine that releases its lease and stamps `endedAt` on both terminal outcomes. Task 3 relies on the lease actually being released after a stage finishes.

**Why this task exists, and why it is first.** `StageStateMachine.transition` decides whether to release the lease with `isTerminal = VALID_TRANSITIONS[to].length === 0`. I verified the consequences empirically:

- `→ completed` releases the lease today, only because `completed: []` happens to be empty.
- `→ failed` does **not** release it. A failed stage holds its lock until the TTL expires. That is a live bug, and no test covers it.
- `endedAt` is likewise never stamped on a failed attempt, because it sits in the same branch.

So adding `pending` to `completed`'s list — which the spec requires, so that a rerun is expressible — would stop `completed` releasing its lease too. Terminality has to stop being inferred from the table before the table changes.

- [ ] **Step 1: Write the failing tests**

Add to `studio/runtime/test/unit/engine/state-machine.test.ts`, inside its existing top-level `describe`:

```ts
  describe("lease lifecycle", () => {
    it("releases the lease when a stage fails", async () => {
      // A failed stage used to hold its lock until the TTL expired, because
      // terminality was inferred from the transition table being empty and
      // `failed` can be retried.
      let instance = makeInstance("brief", "pending");
      instance = (await sm.transition(instance, "running")).instance;
      await sm.fail(instance, "boom", true);

      const reacquired = await lock.acquire("stage:brief", 1000);
      expect(reacquired.ok).toBe(true);
    });

    it("releases the lease when a stage completes", async () => {
      let instance = makeInstance("brief", "pending");
      instance = (await sm.transition(instance, "running")).instance;
      await sm.complete(instance);

      const reacquired = await lock.acquire("stage:brief", 1000);
      expect(reacquired.ok).toBe(true);
    });

    it("stamps endedAt on a failed attempt", async () => {
      let instance = makeInstance("brief", "pending");
      instance = (await sm.transition(instance, "running")).instance;
      const { instance: failed } = await sm.fail(instance, "boom", true);

      expect(failed.attempts[0]!.endedAt).toBeDefined();
      expect(failed.attempts[0]!.outcome).toBe("failure");
    });
  });

  describe("rerun", () => {
    it("allows completed → pending, so a finished stage can be run again", async () => {
      // The journal is cumulative across runs; re-running a completed stage is
      // a first-class operation. Replay allows this, and the in-memory machine
      // must agree or the service could record a rerun the machine refuses.
      let instance = makeInstance("brief", "pending");
      instance = (await sm.transition(instance, "running")).instance;
      instance = (await sm.complete(instance)).instance;

      const { instance: reset } = await sm.transition(instance, "pending");
      expect(reset.status).toBe("pending");
    });
  });
```

**You must hoist the lock first.** `studio/runtime/test/unit/engine/state-machine.test.ts:95-101` currently reads:

```ts
describe("StageStateMachine", () => {
  let sm: StageStateMachine;

  beforeEach(() => {
    const lock = new FakeLock();
    sm = new StageStateMachine(lock, DEFAULT_ENGINE_CONFIG);
  });
```

`lock` is scoped to `beforeEach`, so the tests above cannot reach it. Change it to:

```ts
describe("StageStateMachine", () => {
  let sm: StageStateMachine;
  let lock: FakeLock;

  beforeEach(() => {
    lock = new FakeLock();
    sm = new StageStateMachine(lock, DEFAULT_ENGINE_CONFIG);
  });
```

Do NOT construct a second lock inside the new tests — the machine holds the first one, and a reacquire against a different instance would pass while proving nothing. The suite uses `FakeLock` (an in-memory double from `test/fixtures/index.js`), not `FileLock`; that is correct here, since this task is about the machine's lease lifecycle rather than the filesystem's arbitration.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @studio/runtime -- state-machine`
Expected: the two release tests and the `endedAt` test FAIL; the `completed → pending` test FAILS with `StageTransitionError`.

- [ ] **Step 3: Make terminality explicit**

In `studio/runtime/src/engine/state-machine.ts`, replace:

```ts
    const isTerminal = VALID_TRANSITIONS[to].length === 0;
```

with:

```ts
    // Terminal for lease purposes means "this attempt is over", which is not
    // the same as "the stage can never move again". Inferring it from the
    // transition table being empty tied the two together: `failed` is
    // retryable, so its list was non-empty, so a failed stage never released
    // its lock and held it until the TTL expired. Naming the outcomes keeps
    // the lease lifecycle independent of what the stage may do next.
    const isTerminal = to === "completed" || to === "failed";
```

- [ ] **Step 4: Let a completed stage be leased again**

In `studio/runtime/src/engine/types.ts`, change `VALID_TRANSITIONS`:

```ts
export const VALID_TRANSITIONS: Record<StageStatus, StageStatus[]> = {
  pending: ["running"],
  running: ["completed", "failed"],
  // Deliberately diverges from a single-run reading: this table is also the
  // one an execution service consults, and the journal it replays is
  // cumulative across runs. Re-running a completed stage is a first-class
  // operation — rerun/planner.ts exists to plan it — so `completed` is not the
  // end of the stage's life, only of that attempt. Mirrors the same allowance
  // in @studio/contracts' execution-state replay; if you are tempted to
  // "restore" completed: [], read that module's table comment first.
  completed: ["pending"],
  failed: ["pending"], // retry resets to pending
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w @studio/runtime -- state-machine`
Expected: PASS.

Then the full runtime suite, because `VALID_TRANSITIONS` is read in several places:

Run: `npm test -w @studio/runtime && npx tsc --noEmit -p studio/runtime/tsconfig.json`
Expected: PASS. The existing `rejects completed → running` test should still pass — only `pending` was added, so `completed → running` remains forbidden. If a test breaks, read it before changing it: it may be asserting the behaviour this task deliberately alters, or it may be telling you something.

- [ ] **Step 6: Commit**

```bash
git add studio/runtime/src/engine/state-machine.ts studio/runtime/src/engine/types.ts \
        studio/runtime/test/unit/engine/state-machine.test.ts
git commit -m "runtime: release the lease when a stage fails, and let a completed stage rerun

Terminality was inferred from the transition table being empty. `failed` is
retryable, so its list was non-empty, so a failed stage never released its
lock — it held it until the TTL expired, untested. `endedAt` went unstamped
for the same reason.

Naming the terminal outcomes fixes that and makes the table safe to change:
completed now allows pending, so re-running a finished stage is expressible
in the machine as well as in replay, where the journal is cumulative across
runs."
```

---

### Task 2: The module, its ports, and `status()`

**Files:**
- Create: `studio/runtime/src/execution/types.ts`
- Create: `studio/runtime/src/execution/service.ts`
- Create: `studio/runtime/src/execution/index.ts`
- Create: `studio/runtime/test/unit/execution/status.test.ts`

**Interfaces:**
- Consumes: `deriveExecutionState(events, stageIds, now?)` and `leaseState(instance, now?)` from `@studio/contracts/src/execution-state.mjs`; `parseJournal(contents, { strict })` and `JOURNAL_RELATIVE_PATH` from `@studio/contracts/src/journal.mjs`; `resolvePipeline`, `createDefaultLoader` from the runtime's pipeline module; `episodePath` from `@studio/contracts/src/layout.mjs`.
- Produces: `class ExecutionService` with `status(ref)`; the `StageDispatcher`, `BudgetGuard`, `StageOutcome` and `EpisodeStatus` types Tasks 3–6 build on.

- [ ] **Step 1: Write the failing test**

Create `studio/runtime/test/unit/execution/status.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ExecutionService } from "../../../src/execution/service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINES = resolve(__dirname, "../../../../pipelines/pipelines");

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

const REF = { channel: "childrens", series: "fairy-tales", episode: "ep" };

async function episode() {
  const root = await mkdtemp(join(tmpdir(), "exec-status-"));
  roots.push(root);
  const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
  await mkdir(join(dir, "journal"), { recursive: true });
  await mkdir(join(dir, "artifacts"), { recursive: true });
  return { root, dir };
}

/** Append a raw journal line, as the writer would have produced it. */
async function journalLine(dir: string, type: string, data: Record<string, unknown>) {
  const event = {
    apiVersion: "studio.video/v1alpha1",
    kind: "JournalEvent",
    id: `evt_${"0".repeat(26)}`,
    episodeRef: REF,
    at: new Date().toISOString(),
    actor: "runtime",
    type,
    data,
  };
  await appendFile(join(dir, "journal", "events.jsonl"), `${JSON.stringify(event)}\n`, "utf-8");
}

function service(root: string) {
  return new ExecutionService({ libraryRoot: root, builtinPipelines: PIPELINES });
}

describe("ExecutionService.status", () => {
  it("reports every declared stage as pending for an untouched episode", async () => {
    const { root } = await episode();

    const result = await service(root).status(REF, "narrated-illustrated-video");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stages.length).toBeGreaterThan(0);
    expect(result.value.stages.every((s) => s.status === "pending")).toBe(true);
  });

  it("does not infer completion from output files that exist", async () => {
    // This is the defect cmdStatus has today: it decides a stage is done by
    // looking for its outputs on disk. A file nobody recorded producing is not
    // evidence that a stage ran.
    const { root, dir } = await episode();
    await writeFile(join(dir, "artifacts", "captions.srt"), "1\n00:00:00,000 --> 00:00:01,000\nhi\n");

    const result = await service(root).status(REF, "narrated-illustrated-video");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const captions = result.value.stages.find((s) => s.stageId === "captions");
    expect(captions!.status).toBe("pending");
  });

  it("reports what the journal records, including the holder of a live lease", async () => {
    const { root, dir } = await episode();
    await journalLine(dir, "stage-leased", {
      stageId: "brief", leaseId: "L1", attemptNumber: 1,
      ttlMs: 300000, expiresAt: "2999-01-01T00:00:00Z", holder: "gateway/pid-7",
    });
    await journalLine(dir, "stage-started", { stageId: "brief", leaseId: "L1", attemptNumber: 1 });

    const result = await service(root).status(REF, "narrated-illustrated-video");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const brief = result.value.stages.find((s) => s.stageId === "brief");
    expect(brief!.status).toBe("running");
    expect(brief!.lease.state).toBe("live");
    expect(brief!.lease.holder).toBe("gateway/pid-7");
  });

  it("fails rather than guessing when the pipeline cannot be resolved", async () => {
    const { root } = await episode();

    const result = await service(root).status(REF, "no-such-pipeline");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PIPELINE_UNRESOLVED");
  });

  it("surfaces a corrupt journal instead of silently skipping the line", async () => {
    const { root, dir } = await episode();
    await journalLine(dir, "stage-leased", {
      stageId: "brief", leaseId: "L1", attemptNumber: 1,
      ttlMs: 300000, expiresAt: "2999-01-01T00:00:00Z", holder: "h",
    });
    await appendFile(join(dir, "journal", "events.jsonl"), "{ truncated mid-wri\n", "utf-8");

    const result = await service(root).status(REF, "narrated-illustrated-video");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("JOURNAL_UNREADABLE");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @studio/runtime -- execution`
Expected: FAIL — cannot resolve `../../../src/execution/service.js`.

- [ ] **Step 3: Write the types**

Create `studio/runtime/src/execution/types.ts`:

```ts
// ---------------------------------------------------------------------------
// Execution service types
// ---------------------------------------------------------------------------

import type { ResolvedStage } from "../pipeline/types.js";
import type { Result } from "../result.js";

/** Which episode a call is about. */
export interface EpisodeRef {
  channel: string;
  series: string;
  episode: string;
}

/** What a stage's work needs in order to do it. */
export interface DispatchContext {
  /** Absolute path to the episode directory. */
  episodeDir: string;
  ref: EpisodeRef;
  /** Attempt number this dispatch belongs to, for logging and idempotency. */
  attemptNumber: number;
  log: (message: string) => void;
}

/**
 * Whatever actually performs a stage's work.
 *
 * Injected rather than owned: the service leases, gates, validates and records,
 * and what happens inside a stage is not its business. The gateway injects its
 * handlers, the agent path injects Pi, tests inject a fake. Keeping this a port
 * is what lets the service exist without absorbing the adapter registry.
 *
 * Returns the paths it wrote, absolute or relative to the episode directory.
 */
export interface StageDispatcher {
  dispatch(stage: ResolvedStage, ctx: DispatchContext): Promise<string[]>;
}

/** A budget reservation, opaque to the service. */
export interface Reservation {
  reserveId: string;
  estimatedCost: number;
}

/**
 * Whether a stage may spend.
 *
 * Absence is refusal: a service with no guard does not run stages that could
 * cost money. "Missing budget reservations fail closed" is met by construction
 * rather than by remembering to check.
 */
export interface BudgetGuard {
  maySpend(stage: ResolvedStage, ctx: DispatchContext): Promise<Result<Reservation, { code: string; message: string }>>;
}

/** Why a call ended the way it did. */
export type OutcomeStatus =
  /** The stage ran and its declared outputs hold up. */
  | "completed"
  /** The stage ran and did not produce what it declared, or threw. Retryable. */
  | "failed"
  /** The stage never started. Someone else's condition to clear. */
  | "blocked"
  /** Nothing was selectable — every stage is done, or none is runnable. */
  | "idle";

export interface StageOutcome {
  /** Null when nothing was selected. */
  stageId: string | null;
  status: OutcomeStatus;
  /** Why, in a form worth putting in front of a person. */
  reason?: string;
  outputs: string[];
  attemptNumber?: number;
  leaseId?: string;
  durationMs: number;
  /** True when this was a dry run: nothing was leased, dispatched or written. */
  dryRun?: boolean;
}

/** One stage's place in the episode, as the journal records it. */
export interface StageStatusReport {
  stageId: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  attempts: number;
  outputArtifacts: string[];
  lease: { state: "none" | "live" | "expired"; holder?: string; expiresAt?: string };
  /** True when every stage it depends on has completed. */
  dependenciesMet: boolean;
}

export interface EpisodeStatus {
  ref: EpisodeRef;
  pipeline: string;
  stages: StageStatusReport[];
}

export interface ExecutionError {
  code:
    | "PIPELINE_UNRESOLVED"
    | "JOURNAL_UNREADABLE"
    | "STAGE_UNKNOWN";
  message: string;
}

export interface ExecutionServiceOptions {
  /** Root of the library tree episodes live under. */
  libraryRoot: string;
  /** Where the built-in pipeline manifests are, when not on the default path. */
  builtinPipelines?: string;
  dispatcher?: StageDispatcher;
  budget?: BudgetGuard;
  /** Recorded on every lease, so an expired one names who held it. */
  holder?: string;
  /** How long a lease lasts. Defaults to the engine's default. */
  leaseTtlMs?: number;
  /** Injected so tests can control time. */
  now?: () => Date;
  log?: (message: string) => void;
}
```

- [ ] **Step 4: Write the service with `status()` only**

Create `studio/runtime/src/execution/service.ts`:

```ts
// ---------------------------------------------------------------------------
// The execution service
// ---------------------------------------------------------------------------
// One meaning for run/status/rerun, shared by every caller.
//
// Three paths each had their own: the CLI persisted nothing and printed an
// instruction, the gateway executed handlers and wrote artifacts, the agent
// described tools as executing and waiting. Meanwhile the engine built for this
// — leases, attempts, validated transitions — had no production callers at all.
//
// State comes from replaying the episode journal, never from which files happen
// to exist. The service writes through @studio/contracts' journal, which is the
// log replay reads; studio/runtime/src/journal/ is a separate, unwired
// implementation with a different vocabulary and must not be used here.
// ---------------------------------------------------------------------------

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { episodePath } from "@studio/contracts/src/layout.mjs";
import { parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { deriveExecutionState, leaseState } from "@studio/contracts/src/execution-state.mjs";
import { resolvePipeline } from "../pipeline/resolver.js";
import { createDefaultLoader } from "../pipeline/fs-loader.js";
import type { ResolvedPipeline, ResolvedStage } from "../pipeline/types.js";
import { ok, err, type Result } from "../result.js";
import type {
  EpisodeRef, EpisodeStatus, ExecutionError, ExecutionServiceOptions, StageStatusReport,
} from "./types.js";

export class ExecutionService {
  constructor(private readonly options: ExecutionServiceOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private episodeDir(ref: EpisodeRef): string {
    return episodePath(this.options.libraryRoot, ref.channel, ref.series, ref.episode);
  }

  /** Resolve the pipeline, failing rather than guessing when it cannot be read. */
  protected async resolve(pipeline: string): Promise<Result<ResolvedPipeline, ExecutionError>> {
    try {
      const loader = createDefaultLoader(
        this.options.libraryRoot,
        this.options.builtinPipelines || undefined,
      );
      const resolved = await resolvePipeline(loader, pipeline);
      if (!resolved || resolved.stages.length === 0) {
        return err({ code: "PIPELINE_UNRESOLVED", message: `Pipeline "${pipeline}" resolved to no stages` });
      }
      return ok(resolved);
    } catch (e) {
      return err({
        code: "PIPELINE_UNRESOLVED",
        message: `Pipeline "${pipeline}" could not be resolved: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  /**
   * Read the journal strictly.
   *
   * A malformed line is surfaced, not skipped: this log is the only record of
   * what ran, so a line nobody can read is a gap in the history rather than a
   * cosmetic problem.
   */
  protected async readJournal(episodeDir: string): Promise<Result<unknown[], ExecutionError>> {
    const file = path.join(episodeDir, JOURNAL_RELATIVE_PATH);
    let contents: string;
    try {
      contents = await readFile(file, "utf-8");
    } catch {
      return ok([]); // No journal yet is a new episode, not a broken one.
    }
    try {
      return ok(parseJournal(contents, { strict: true }));
    } catch (e) {
      return err({
        code: "JOURNAL_UNREADABLE",
        message: `Journal for this episode could not be read: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  async status(ref: EpisodeRef, pipeline: string): Promise<Result<EpisodeStatus, ExecutionError>> {
    const resolved = await this.resolve(pipeline);
    if (!resolved.ok) return resolved;

    const episodeDir = this.episodeDir(ref);
    const events = await this.readJournal(episodeDir);
    if (!events.ok) return events;

    const stages = resolved.value.stages;
    const stageIds = stages.map((s) => s.definition.id);
    const now = this.now();

    let derived;
    try {
      derived = deriveExecutionState(events.value, stageIds, now);
    } catch (e) {
      return err({
        code: "JOURNAL_UNREADABLE",
        message: `Journal and pipeline disagree: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    const reports: StageStatusReport[] = stages.map((stage) => {
      const instance = derived.get(stage.definition.id)!;
      return {
        stageId: stage.definition.id,
        name: stage.definition.name,
        status: instance.status,
        attempts: instance.attempts.length,
        outputArtifacts: instance.outputArtifacts,
        lease: leaseState(instance, now),
        dependenciesMet: dependenciesMet(stage, derived),
      };
    });

    return ok({ ref, pipeline, stages: reports });
  }
}

/** Every stage this one is built on has completed. */
export function dependenciesMet(
  stage: ResolvedStage,
  derived: Map<string, { status: string }>,
): boolean {
  return (stage.definition.dependsOn ?? []).every(
    (id) => derived.get(id)?.status === "completed",
  );
}
```

Create `studio/runtime/src/execution/index.ts`:

```ts
export { ExecutionService, dependenciesMet } from "./service.js";
export type {
  EpisodeRef, DispatchContext, StageDispatcher, BudgetGuard, Reservation,
  OutcomeStatus, StageOutcome, StageStatusReport, EpisodeStatus,
  ExecutionError, ExecutionServiceOptions,
} from "./types.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w @studio/runtime -- execution`
Expected: PASS, all five tests.

- [ ] **Step 6: Commit**

```bash
git add studio/runtime/src/execution studio/runtime/test/unit/execution/status.test.ts
git commit -m "runtime: an execution service that reports status from the journal

status() replays the episode journal and reports what it records. It does not
look at which output files exist — a file nobody recorded producing is not
evidence that a stage ran, which is the inference cmdStatus makes today.

A pipeline that will not resolve, and a journal line nobody can parse, both
fail rather than resolving to a plausible-looking empty state."
```

---

### Task 3: `run()` — claim one stage and record what happened

**Files:**
- Modify: `studio/runtime/src/execution/service.ts`
- Create: `studio/runtime/test/unit/execution/run.test.ts`

**Interfaces:**
- Consumes: `ExecutionService`, `dependenciesMet`, the port types from Task 2; `StageStateMachine` and `DEFAULT_ENGINE_CONFIG` from the engine; `FileLock` from `../ports/file-lock.js`; `appendJournalEvent` from the contracts journal.
- Produces: `run(ref, pipeline, opts?) -> Promise<Result<StageOutcome, ExecutionError>>` where `opts` is `{ stage?: string; dryRun?: boolean }`. Tasks 4–6 extend this method.

- [ ] **Step 1: Write the failing test**

Create `studio/runtime/test/unit/execution/run.test.ts`. Reuse the `episode()` and `service()` helpers from `status.test.ts` by copying them into this file — the suites are independent and a shared helper module for two files is not worth the indirection:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ExecutionService } from "../../../src/execution/service.js";
import type { StageDispatcher, BudgetGuard } from "../../../src/execution/types.js";
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
  const root = await mkdtemp(join(tmpdir(), "exec-run-"));
  roots.push(root);
  const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
  await mkdir(join(dir, "journal"), { recursive: true });
  await mkdir(join(dir, "artifacts"), { recursive: true });
  return { root, dir };
}

async function journal(dir: string) {
  return parseJournal(await readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8"));
}

/** A dispatcher that writes the file it claims to have written. */
function writingDispatcher(dir: string, relative = "artifacts/brief.md"): StageDispatcher {
  return {
    dispatch: vi.fn(async () => {
      const file = join(dir, relative);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, "real content");
      return [file];
    }),
  };
}

const permissiveBudget: BudgetGuard = {
  maySpend: async () => ok({ reserveId: "r1", estimatedCost: 0 }),
};

describe("ExecutionService.run", () => {
  it("claims a stage, dispatches it, and records the attempt", async () => {
    const { root, dir } = await episode();
    const dispatcher = writingDispatcher(dir);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher, budget: permissiveBudget, holder: "test/1",
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stageId).toBe("brief");
    expect(result.value.status).toBe("completed");
    expect(result.value.outputs.length).toBe(1);
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);

    const types = (await journal(dir)).map((e: any) => e.type);
    expect(types).toEqual(["stage-leased", "stage-started", "stage-completed"]);
  });

  it("writes a lease event that names the holder and an expiry", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: writingDispatcher(dir), budget: permissiveBudget, holder: "gateway/pid-9",
    });

    await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    const leased = (await journal(dir)).find((e: any) => e.type === "stage-leased") as any;
    expect(leased.data.holder).toBe("gateway/pid-9");
    expect(leased.data.leaseId).toMatch(/\S/);
    expect(leased.data.attemptNumber).toBe(1);
    expect(Date.parse(leased.data.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("releases the lease once the stage finishes, so it can run again", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: writingDispatcher(dir), budget: permissiveBudget, holder: "test/1",
    });

    await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    const second = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.status).toBe("completed");
    expect(second.value.attemptNumber).toBe(2);
  });

  it("selects the first stage whose dependencies are met when none is named", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: writingDispatcher(dir), budget: permissiveBudget, holder: "test/1",
    });

    const result = await svc.run(REF, "narrated-illustrated-video");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // brief is the only stage with no dependencies in this pipeline.
    expect(result.value.stageId).toBe("brief");
  });

  it("reports idle when every stage that could run has run", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      // A dispatcher that writes nothing and is never expected to be reached.
      dispatcher: { dispatch: async () => [] },
      budget: permissiveBudget, holder: "test/1",
    });

    // The one stage with no dependencies is brief; with a dispatcher that
    // writes nothing everything else stays blocked on dependencies.
    const svcOk = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: writingDispatcher(dir), budget: permissiveBudget, holder: "test/1",
    });
    await svcOk.run(REF, "narrated-illustrated-video", { stage: "brief" });

    const result = await svc.run(REF, "narrated-illustrated-video");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Nothing else is runnable: every remaining stage depends on something
    // that has not completed.
    expect(result.value.status).toBe("idle");
    expect(result.value.stageId).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @studio/runtime -- execution/run`
Expected: FAIL — `svc.run is not a function`.

- [ ] **Step 3: Implement `run()`**

Add to `studio/runtime/src/execution/service.ts`. Extend the imports:

```ts
import { appendJournalEvent } from "@studio/contracts/src/journal.mjs";
import { StageStateMachine, LeaseError } from "../engine/state-machine.js";
import { DEFAULT_ENGINE_CONFIG, type StageInstance as EngineStageInstance } from "../engine/types.js";
import { FileLock } from "../ports/file-lock.js";
import type { DispatchContext, StageOutcome } from "./types.js";
import { stat } from "node:fs/promises";
```

Add these methods and helpers to the class:

```ts
  /**
   * Bridge replay's stage instance to the engine's.
   *
   * Replay produces a deliberate subset — it receives stage ids and cannot
   * invent a human-readable name, and it leaves createdAt null for a stage the
   * journal has never mentioned. The pipeline supplies the name; a stage with
   * no history is created now.
   */
  private toEngineInstance(
    derived: { stageId: string; status: string; attempts: unknown[]; outputArtifacts: string[]; createdAt: string | null },
    stage: ResolvedStage,
  ): EngineStageInstance {
    return {
      stageId: derived.stageId,
      name: stage.definition.name,
      status: derived.status as EngineStageInstance["status"],
      attempts: derived.attempts.map((a) => ({ ...(a as object) })) as EngineStageInstance["attempts"],
      outputArtifacts: [...derived.outputArtifacts],
      createdAt: derived.createdAt ?? this.now().toISOString(),
    };
  }

  /** Every declared output exists and has bytes in it. Returns why not, or null. */
  private async validateOutputs(episodeDir: string, outputs: string[]): Promise<string | null> {
    if (outputs.length === 0) return "the stage produced no outputs";
    for (const file of outputs) {
      const absolute = path.isAbsolute(file) ? file : path.join(episodeDir, file);
      let info;
      try {
        info = await stat(absolute);
      } catch {
        return `declared output "${path.relative(episodeDir, absolute)}" was not written`;
      }
      if (info.size === 0) {
        return `declared output "${path.relative(episodeDir, absolute)}" is empty`;
      }
    }
    return null;
  }

  async run(
    ref: EpisodeRef,
    pipeline: string,
    opts: { stage?: string; dryRun?: boolean } = {},
  ): Promise<Result<StageOutcome, ExecutionError>> {
    const startedAt = Date.now();
    const log = this.options.log ?? (() => {});

    const resolved = await this.resolve(pipeline);
    if (!resolved.ok) return resolved;

    const episodeDir = this.episodeDir(ref);
    const events = await this.readJournal(episodeDir);
    if (!events.ok) return events;

    const stages = resolved.value.stages;
    const stageIds = stages.map((s) => s.definition.id);
    const now = this.now();

    let derived;
    try {
      derived = deriveExecutionState(events.value, stageIds, now);
    } catch (e) {
      return err({
        code: "JOURNAL_UNREADABLE",
        message: `Journal and pipeline disagree: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    // ── Select ────────────────────────────────────────────────────────────
    let stage: ResolvedStage | undefined;
    if (opts.stage) {
      stage = stages.find((s) => s.definition.id === opts.stage);
      if (!stage) {
        return err({ code: "STAGE_UNKNOWN", message: `Pipeline "${pipeline}" declares no stage "${opts.stage}"` });
      }
    } else {
      stage = stages.find((s) =>
        derived.get(s.definition.id)!.status !== "completed" && dependenciesMet(s, derived));
    }

    if (!stage) {
      return ok({ stageId: null, status: "idle", outputs: [], durationMs: Date.now() - startedAt });
    }

    const stageId = stage.definition.id;
    const blocked = (reason: string): Result<StageOutcome, ExecutionError> =>
      ok({ stageId, status: "blocked", reason, outputs: [], durationMs: Date.now() - startedAt, dryRun: opts.dryRun });

    // ── Gate ──────────────────────────────────────────────────────────────
    if (!dependenciesMet(stage, derived)) {
      const missing = (stage.definition.dependsOn ?? [])
        .filter((id) => derived.get(id)?.status !== "completed");
      return blocked(`"${stageId}" depends on ${missing.map((m) => `"${m}"`).join(", ")}, which ${missing.length === 1 ? "has" : "have"} not completed`);
    }

    const ctx: DispatchContext = {
      episodeDir, ref,
      attemptNumber: derived.get(stageId)!.attempts.length + 1,
      log,
    };

    if (!this.options.dispatcher) {
      return blocked(`no dispatcher is configured, so "${stageId}" cannot be performed`);
    }
    if (!this.options.budget) {
      return blocked(`no budget guard is configured, so "${stageId}" may not spend`);
    }
    const permitted = await this.options.budget.maySpend(stage, ctx);
    if (!permitted.ok) {
      return blocked(`budget refused "${stageId}": ${permitted.error.message}`);
    }

    // ── Dry run stops here: everything above is free, everything below writes.
    if (opts.dryRun) {
      return ok({
        stageId, status: "completed", reason: "dry run — would have dispatched",
        outputs: [], durationMs: Date.now() - startedAt, dryRun: true,
      });
    }

    // ── Lease ─────────────────────────────────────────────────────────────
    const ttlMs = this.options.leaseTtlMs ?? DEFAULT_ENGINE_CONFIG.leaseTtlMs;
    const sm = new StageStateMachine(new FileLock(path.join(episodeDir, ".locks")), {
      ...DEFAULT_ENGINE_CONFIG, leaseTtlMs: ttlMs,
    });

    let instance = this.toEngineInstance(derived.get(stageId)!, stage);
    // A completed stage named explicitly is a rerun: reset it before leasing.
    if (instance.status === "completed") {
      instance = (await sm.transition(instance, "pending")).instance;
    }

    let leaseId: string;
    try {
      const started = await sm.transition(instance, "running");
      instance = started.instance;
      leaseId = started.transition.leaseId!;
    } catch (e) {
      if (e instanceof LeaseError) {
        return blocked(`"${stageId}" is already held by another run`);
      }
      return blocked(`"${stageId}" cannot start: ${e instanceof Error ? e.message : String(e)}`);
    }

    const attemptNumber = instance.attempts.length;
    const expiresAt = new Date(this.now().getTime() + ttlMs).toISOString();
    const holder = this.options.holder ?? `runtime/pid-${process.pid}`;

    await appendJournalEvent(episodeDir, {
      type: "stage-leased", actor: "runtime", episode: ref,
      data: { stageId, leaseId, attemptNumber, ttlMs, expiresAt, holder },
    });
    await appendJournalEvent(episodeDir, {
      type: "stage-started", actor: "runtime", episode: ref,
      data: { stageId, leaseId, attemptNumber },
    });

    // ── Dispatch ──────────────────────────────────────────────────────────
    let outputs: string[];
    try {
      outputs = await this.options.dispatcher.dispatch(stage, { ...ctx, attemptNumber });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await this.recordFailure(episodeDir, ref, sm, instance, stageId, leaseId, attemptNumber, message);
      return ok({ stageId, status: "failed", reason: message, outputs: [], attemptNumber, leaseId,
        durationMs: Date.now() - startedAt });
    }

    // ── Validate ──────────────────────────────────────────────────────────
    const invalid = await this.validateOutputs(episodeDir, outputs);
    if (invalid) {
      await this.recordFailure(episodeDir, ref, sm, instance, stageId, leaseId, attemptNumber, invalid);
      return ok({ stageId, status: "failed", reason: invalid, outputs: [], attemptNumber, leaseId,
        durationMs: Date.now() - startedAt });
    }

    const relative = outputs.map((o) => path.isAbsolute(o) ? path.relative(episodeDir, o) : o);

    // The journal is written before the lease is released. If this process dies
    // in between, the record says what happened and the lease expires on its
    // own; releasing first would leave a completed stage looking unstarted.
    await appendJournalEvent(episodeDir, {
      type: "stage-completed", actor: "runtime", episode: ref,
      data: { stageId, leaseId, attemptNumber, outputs: relative },
    });
    await sm.complete(instance);

    return ok({ stageId, status: "completed", outputs: relative, attemptNumber, leaseId,
      durationMs: Date.now() - startedAt });
  }

  /** Record a failed attempt and release its lease, in that order. */
  private async recordFailure(
    episodeDir: string, ref: EpisodeRef, sm: StageStateMachine,
    instance: EngineStageInstance, stageId: string, leaseId: string,
    attemptNumber: number, error: string,
  ): Promise<void> {
    await appendJournalEvent(episodeDir, {
      type: "stage-failed", actor: "runtime", episode: ref,
      data: { stageId, leaseId, attemptNumber, error, retryable: true },
    });
    await sm.fail(instance, error, true);
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @studio/runtime -- execution/run`
Expected: PASS, all five tests.

- [ ] **Step 5: Run the whole runtime suite**

Run: `npm test -w @studio/runtime && npx tsc --noEmit -p studio/runtime/tsconfig.json`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add studio/runtime/src/execution/service.ts studio/runtime/test/unit/execution/run.test.ts
git commit -m "runtime: run() claims one stage and records what happened

One call leases one stage, dispatches it through the injected port, validates
the outputs it declared, and writes the attempt to the journal replay reads.
Callers that want a whole episode loop; callers that want one step do not.

The journal is written before the lease is released: if the process dies
between, the record says what happened and the lease expires on its own,
where releasing first would leave a finished stage looking unstarted."
```

---

### Task 4: The fail-closed matrix

**Files:**
- Modify: `studio/runtime/src/execution/service.ts` (lease-expiry check only)
- Create: `studio/runtime/test/unit/execution/fail-closed.test.ts`

**Interfaces:**
- Consumes: `run()` from Task 3.
- Produces: no new API. Every row of the spec's table is asserted, and the one gap Task 3 leaves — a lease that expired mid-dispatch — is closed.

- [ ] **Step 1: Write the failing tests**

Create `studio/runtime/test/unit/execution/fail-closed.test.ts`, copying the `episode()`, `journal()` and `permissiveBudget` helpers from `run.test.ts`:

```ts
describe("failing closed", () => {
  it("refuses a stage the pipeline does not declare", async () => {
    const { root } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: { dispatch: async () => [] }, budget: permissiveBudget,
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "no-such-stage" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STAGE_UNKNOWN");
  });

  it("blocks when no dispatcher is configured", async () => {
    const { root } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES, budget: permissiveBudget,
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/no dispatcher/);
  });

  it("blocks when no budget guard is configured", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES, dispatcher: writingDispatcher(dir),
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/budget/);
  });

  it("blocks when the budget guard refuses", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES, dispatcher: writingDispatcher(dir),
      budget: { maySpend: async () => err({ code: "OVER_LIMIT", message: "no funds remain" }) },
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/no funds remain/);
  });

  it("fails a stage whose dispatcher returned nothing", async () => {
    const { root } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: { dispatch: async () => [] }, budget: permissiveBudget,
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("failed");
    expect(result.value.reason).toMatch(/no outputs/);
  });

  it("fails a stage whose declared output was never written", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: { dispatch: async () => [join(dir, "artifacts", "ghost.md")] },
      budget: permissiveBudget,
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("failed");
    expect(result.value.reason).toMatch(/was not written/);
  });

  it("fails a stage whose output is empty", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: {
        dispatch: async () => {
          const file = join(dir, "artifacts", "empty.md");
          await writeFile(file, "");
          return [file];
        },
      },
      budget: permissiveBudget,
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("failed");
    expect(result.value.reason).toMatch(/is empty/);
  });

  it("fails, and records the failure, when the dispatcher throws", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: { dispatch: async () => { throw new Error("the renderer died"); } },
      budget: permissiveBudget,
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("failed");
    expect(result.value.reason).toMatch(/the renderer died/);

    const types = (await journal(dir)).map((e: any) => e.type);
    expect(types).toContain("stage-failed");
  });

  it("blocks a stage whose dependency has not completed", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: writingDispatcher(dir), budget: permissiveBudget,
    });

    // script depends on brief, which has never run.
    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "script" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/brief/);
  });

  it("fails a stage whose lease expired while it was dispatching", async () => {
    // The holder took too long. Something else may have taken the stage, so
    // this attempt's result cannot be trusted and must not be recorded as
    // a completion.
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      leaseTtlMs: 20,
      dispatcher: {
        dispatch: async () => {
          await new Promise((r) => setTimeout(r, 60));
          const file = join(dir, "artifacts", "brief.md");
          await writeFile(file, "content");
          return [file];
        },
      },
      budget: permissiveBudget,
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("failed");
    expect(result.value.reason).toMatch(/lease/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @studio/runtime -- execution/fail-closed`
Expected: most PASS already from Task 3's implementation; the lease-expiry test FAILS, because nothing rechecks the lease after dispatch.

Note which ones fail before you change anything, and say so in your report. A test that passed without any new code is still evidence, but it is evidence about Task 3.

- [ ] **Step 3: Check the lease after dispatch**

In `studio/runtime/src/execution/service.ts`, after the dispatcher returns and **before** validating outputs, add:

```ts
    // The lease may have expired while the stage was working. If it has,
    // something else may already have taken the stage, so this attempt's
    // outputs cannot be trusted — record the timeout rather than a completion.
    if (this.now().getTime() >= Date.parse(expiresAt)) {
      const reason = `the lease on "${stageId}" expired after ${ttlMs}ms, while the stage was still running`;
      await appendJournalEvent(episodeDir, {
        type: "attempt-recorded", actor: "runtime", episode: ref,
        data: { stageId, leaseId, attemptNumber, outcome: "timeout" },
      });
      return ok({ stageId, status: "failed", reason, outputs: [], attemptNumber, leaseId,
        durationMs: Date.now() - startedAt });
    }
```

Note this writes `attempt-recorded` with outcome `timeout` rather than `stage-failed`: replay maps a `timeout` outcome to a failed stage, and the distinction records *why* the attempt ended, which a plain failure would lose.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @studio/runtime -- execution/fail-closed`
Expected: PASS, all eleven.

- [ ] **Step 5: Commit**

```bash
git add studio/runtime/src/execution/service.ts studio/runtime/test/unit/execution/fail-closed.test.ts
git commit -m "runtime: fail closed on every condition the service can detect

Unknown stage, absent dispatcher, absent or refusing budget guard, empty
output list, a declared output missing or empty, a dispatcher that threw, an
unmet dependency, and a lease that expired mid-dispatch.

The expiry case records attempt-recorded with outcome timeout rather than a
plain failure: something else may already hold the stage, so the outputs
cannot be trusted, and the record should say why the attempt ended."
```

---

### Task 5: Dry run and `rerun()`

**Files:**
- Modify: `studio/runtime/src/execution/service.ts`
- Create: `studio/runtime/test/unit/execution/dry-run-rerun.test.ts`

**Interfaces:**
- Consumes: `run()` and its gate order from Tasks 3–4.
- Produces: `rerun(ref, pipeline, stageIds) -> Promise<Result<StageOutcome[], ExecutionError>>`.

- [ ] **Step 1: Write the failing tests**

Create `studio/runtime/test/unit/execution/dry-run-rerun.test.ts`, with the same helpers:

```ts
describe("dry run", () => {
  it("writes nothing and dispatches nothing", async () => {
    const { root, dir } = await episode();
    const dispatcher = writingDispatcher(dir);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES, dispatcher, budget: permissiveBudget,
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief", dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dryRun).toBe(true);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    await expect(readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8")).rejects.toThrow();
  });

  it("still reports a gate refusal, so it answers the same question as a real run", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES, dispatcher: writingDispatcher(dir),
      budget: { maySpend: async () => err({ code: "OVER_LIMIT", message: "no funds remain" }) },
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief", dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/no funds remain/);
  });

  it("takes no lease, so a real run immediately after is unaffected", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: writingDispatcher(dir), budget: permissiveBudget,
    });

    await svc.run(REF, "narrated-illustrated-video", { stage: "brief", dryRun: true });
    const real = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(real.ok).toBe(true);
    if (!real.ok) return;
    expect(real.value.status).toBe("completed");
  });
});

describe("rerun", () => {
  it("runs a completed stage again and records a second attempt", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: writingDispatcher(dir), budget: permissiveBudget,
    });
    await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    const result = await svc.rerun(REF, "narrated-illustrated-video", ["brief"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.status).toBe("completed");
    expect(result.value[0]!.attemptNumber).toBe(2);

    const status = await svc.status(REF, "narrated-illustrated-video");
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.value.stages.find((s) => s.stageId === "brief")!.attempts).toBe(2);
  });

  it("refuses a stage the pipeline does not declare", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: writingDispatcher(dir), budget: permissiveBudget,
    });

    const result = await svc.rerun(REF, "narrated-illustrated-video", ["no-such-stage"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STAGE_UNKNOWN");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @studio/runtime -- execution/dry-run-rerun`
Expected: the dry-run tests PASS (Task 3 already stops before the lease); the rerun tests FAIL with `svc.rerun is not a function`.

If a dry-run test fails, the gate order is wrong — dry run must stop *after* the gates and *before* the lease. Fix the order rather than the test.

- [ ] **Step 3: Implement `rerun()`**

Add to the class:

```ts
  /**
   * Run named stages again.
   *
   * There is no separate machinery: a completed stage that is named explicitly
   * takes a fresh lease, which replay reads as a new attempt — `completed ->
   * pending` is a legal transition precisely because the journal is cumulative
   * across runs.
   *
   * Stops at the first stage that does not complete, so a caller is not left
   * guessing which of several reruns is responsible for the state they see.
   */
  async rerun(
    ref: EpisodeRef,
    pipeline: string,
    stageIds: string[],
  ): Promise<Result<StageOutcome[], ExecutionError>> {
    const outcomes: StageOutcome[] = [];
    for (const stageId of stageIds) {
      const outcome = await this.run(ref, pipeline, { stage: stageId });
      if (!outcome.ok) return outcome;
      outcomes.push(outcome.value);
      if (outcome.value.status !== "completed") break;
    }
    return ok(outcomes);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @studio/runtime -- execution/dry-run-rerun`
Expected: PASS, all five.

- [ ] **Step 5: Commit**

```bash
git add studio/runtime/src/execution/service.ts studio/runtime/test/unit/execution/dry-run-rerun.test.ts
git commit -m "runtime: dry run stops before the lease, and rerun needs no new machinery

A dry run takes the same path through selection and every gate, then stops
before writing anything — so it reports a gate refusal exactly as a real call
would, which is the property that makes it worth having.

rerun is ordinary run calls naming each stage: a completed stage taking a
fresh lease is what a rerun is, now that completed -> pending is legal in
both the machine and replay."
```

---

### Task 6: Concurrency, restart, and the package export

**Files:**
- Modify: `studio/runtime/src/index.ts`
- Create: `studio/runtime/test/unit/execution/concurrency.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–5.
- Produces: `ExecutionService` and its types importable from `@studio/runtime`, which is how the gateway will reach it in `avg-2n7`.

- [ ] **Step 1: Write the failing tests**

Create `studio/runtime/test/unit/execution/concurrency.test.ts`, with the same helpers:

```ts
describe("two services over one episode", () => {
  it("lets exactly one of them run a stage", async () => {
    // The gateway and the CLI genuinely run at the same time. The lockfile is
    // what decides; the journal only records the decision.
    const { root, dir } = await episode();
    const slow: StageDispatcher = {
      dispatch: async () => {
        await new Promise((r) => setTimeout(r, 120));
        const file = join(dir, "artifacts", "brief.md");
        await writeFile(file, "content");
        return [file];
      },
    };
    const opts = { libraryRoot: root, builtinPipelines: PIPELINES, budget: permissiveBudget };
    const a = new ExecutionService({ ...opts, dispatcher: slow, holder: "A" });
    const b = new ExecutionService({ ...opts, dispatcher: slow, holder: "B" });

    const [ra, rb] = await Promise.all([
      a.run(REF, "narrated-illustrated-video", { stage: "brief" }),
      b.run(REF, "narrated-illustrated-video", { stage: "brief" }),
    ]);

    const statuses = [ra, rb].map((r) => (r.ok ? r.value.status : "error"));
    expect(statuses.filter((s) => s === "completed")).toHaveLength(1);
    expect(statuses.filter((s) => s === "blocked")).toHaveLength(1);
  });

  it("records only the winner's attempt in the journal", async () => {
    const { root, dir } = await episode();
    const slow: StageDispatcher = {
      dispatch: async () => {
        await new Promise((r) => setTimeout(r, 120));
        const file = join(dir, "artifacts", "brief.md");
        await writeFile(file, "content");
        return [file];
      },
    };
    const opts = { libraryRoot: root, builtinPipelines: PIPELINES, budget: permissiveBudget };
    const a = new ExecutionService({ ...opts, dispatcher: slow, holder: "A" });
    const b = new ExecutionService({ ...opts, dispatcher: slow, holder: "B" });

    await Promise.all([
      a.run(REF, "narrated-illustrated-video", { stage: "brief" }),
      b.run(REF, "narrated-illustrated-video", { stage: "brief" }),
    ]);

    const leases = (await journal(dir)).filter((e: any) => e.type === "stage-leased");
    expect(leases).toHaveLength(1);
  });
});

describe("restart", () => {
  it("derives the same state a fresh service sees after a crash mid-stage", async () => {
    const { root, dir } = await episode();
    // A dispatcher that never returns stands in for a process that died: the
    // lease and start are journaled, no terminal event ever is.
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES, budget: permissiveBudget,
      leaseTtlMs: 40,
      dispatcher: { dispatch: async () => { await new Promise((r) => setTimeout(r, 90)); return []; } },
    });
    await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    // A fresh service, after the lease has expired.
    const fresh = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES, budget: permissiveBudget,
      dispatcher: writingDispatcher(dir), holder: "fresh",
    });

    const status = await fresh.status(REF, "narrated-illustrated-video");
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    const brief = status.value.stages.find((s) => s.stageId === "brief")!;
    expect(brief.lease.state).not.toBe("live");

    // And the stage is runnable again rather than stuck.
    const again = await fresh.run(REF, "narrated-illustrated-video", { stage: "brief" });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.status).toBe("completed");
  });
});

describe("package surface", () => {
  it("exports the service from @studio/runtime", async () => {
    const mod = await import("../../../src/index.js");
    expect(typeof (mod as Record<string, unknown>).ExecutionService).toBe("function");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @studio/runtime -- execution/concurrency`
Expected: the export test FAILS. The concurrency and restart tests may already pass — note which, and report it honestly rather than implying the export change fixed them.

- [ ] **Step 3: Export from the package root**

In `studio/runtime/src/index.ts`, add alongside the other value exports:

```ts
// Execution (one meaning for run/status/rerun)
export { ExecutionService, dependenciesMet } from "./execution/index.js";
export type {
  DispatchContext, StageDispatcher, BudgetGuard, Reservation,
  OutcomeStatus, StageOutcome, StageStatusReport, EpisodeStatus,
  ExecutionError, ExecutionServiceOptions,
} from "./execution/index.js";
```

I checked: `studio/runtime/src/index.ts` exports no `EpisodeRef` today, so there is no collision and you may export it alongside the rest. If that has changed by the time you run this, leave the execution module's own `EpisodeRef` un-exported at the root and say so in your report — two different `EpisodeRef` types reaching consumers is worse than one missing export.

- [ ] **Step 4: Run everything**

Run:

```bash
npm test -w @studio/runtime && npm test -w @studio/contracts && npm test -w @studio/gateway
npx tsc --noEmit -p studio/runtime/tsconfig.json && npm run typecheck -w @studio/gateway
npm run build -w @studio/runtime
```

Expected: all pass. The build matters: `@studio/runtime` resolves through `dist/`, so the gateway cannot see these exports in `avg-2n7` until it succeeds.

- [ ] **Step 5: Commit**

```bash
git add studio/runtime/src/index.ts studio/runtime/test/unit/execution/concurrency.test.ts
git commit -m "runtime: export the execution service, and pin its concurrency behaviour

Two services over one episode directory: exactly one runs the stage, one
lease is journaled, and the loser is blocked rather than failed — someone
else holding the stage is the system working.

After a crash mid-stage the lease expires and a fresh service derives the
same state and can run the stage again, which is what makes restart recovery
deterministic rather than a matter of which files survived."
```

---

## Self-Review

**Spec coverage:**

| spec section | task |
|---|---|
| 1. A library, and who calls it | 2 (module), 6 (package export) |
| 2. One operation, one stage | 3 |
| 2a. `status()` with no file-existence inference | 2 |
| 2b. `rerun()` needing no new machinery | 5 |
| 3. The state machine's table divergence | 1 |
| 4. Two ports the caller injects | 2 (types), 3 (used), 4 (absence is refusal) |
| 5. Failing closed, all eight rows | 4 |
| 6. Dry run | 5 |
| Testing section | 3, 4, 5, 6 |

**Gap found and closed during review:** the spec says the service "drives `StageStateMachine`", but replay's `StageInstance` lacks the `name` the engine's requires and types `createdAt` as nullable — the deliberate subset slice A documented and deferred to this slice. Without a bridge, Task 3 would not typecheck. Task 3 step 3 now contains `toEngineInstance`, which takes the name from the resolved pipeline and defaults `createdAt` to now. This was implicit in the spec and is explicit here.

**Second gap:** the spec's fail-closed table lists "lease expired mid-flight", but nothing in the run sequence rechecks the lease after dispatch returns — Task 3's implementation would report a completion for work whose lease had lapsed. Task 4 step 3 adds the check, writing `attempt-recorded` with outcome `timeout`.

**A deliberate deviation from the spec:** the spec's step 3 lists gates as "dependencies, budget, approval". This plan implements dependencies and budget, and does **not** implement an approval gate. Approval means gate-review records, which `avg-qr4.1` put in the gateway and which `avg-qr4.3` is rewriting with authenticated, revision-bound receipts. Wiring a third interpretation here — before `qr4.3` decides what an approval *is* — would be the same mistake this whole issue exists to fix. A reviewer should treat the absence as intentional; if they disagree, the hook is `run`'s gate block, and it is three lines.

**Type consistency:** `StageOutcome`, `StageStatusReport`, `EpisodeStatus`, `ExecutionError`, `StageDispatcher`, `BudgetGuard`, `DispatchContext` and `ExecutionServiceOptions` are defined once in Task 2 and used with those exact names in 3–6. `run`'s signature is `run(ref, pipeline, opts?)` in every task. `dependenciesMet(stage, derived)` is exported from `service.ts` in Task 2 and used inside `run` in Task 3.

## Risks

- **Task 1 changes a table read in several places.** Run the full runtime suite, not just the state-machine file. A test that breaks may be asserting the behaviour this task deliberately alters — read it before adjusting it.
- **The lock directory is `<episode>/.locks`.** It is created under the episode rather than in a temp dir so two processes on the same episode share it, which is the whole point. It is not in the layout contract; if `tools/check-paths` or the workspace doctor objects to an unknown directory, that is a real finding, not a test to silence.
- **`appendJournalEvent` never throws.** If a payload is malformed the event is silently dropped and the run continues, so a green test does not prove the journal has what you expect. Several tests assert on journal contents for exactly this reason; keep them.
- **This slice ships with no production caller.** `avg-2n7` and `avg-grf` are what make the acceptance criterion literally true. It is the second such slice in a row.
