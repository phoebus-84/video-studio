# Gateway As Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the gateway onto the execution service, so it stops deciding what runs, when, and whether it counted — without losing either of the two `avg-qr4.1` behaviours a naive swap would drop.

**Architecture:** The service gains a third injected port, `ReviewGate`, and a way for a dispatcher to say it does not handle a stage. The gateway supplies both collaborators — a dispatcher wrapping its four handlers, and a review gate backed by `deriveGateState` — and `production.ts` gains the loop that `runAutopilot` used to own. Then `runAutopilot` and its machinery are deleted and its 17 tests re-pointed.

**Tech Stack:** TypeScript in `@studio/runtime` and `@studio/gateway`, both vitest; `@studio/contracts` ESM `.mjs` for journal replay and gate-review records.

**Spec:** `docs/superpowers/specs/2026-09-20-gateway-as-transport-design.md`

## Global Constraints

- **Issue:** `avg-2n7`, slice C of `avg-qr4.2`. Branch `qr4.2c-gateway-as-transport` exists and holds the spec commit.
- **Two `avg-qr4.1` behaviours must survive, and a naive swap drops both.** (1) A dependency whose review is `requested` or `invalidated` blocks its dependents. (2) A stage declaring `review: human` must not read as `completed` to its dependents — I ran the real pipeline and `script`, `terminal-recordings` and `illustrations` all come back `completed` from the service today, which would let downstream stages build on unaccepted artifacts.
- **Completion and acceptance are different facts.** A `review: human` stage still writes `stage-completed` — it did run. The dependency test is what changes: a dependency is satisfied when it completed **and** its review, if required, is not outstanding.
- **An absent `ReviewGate` refuses only where a review is declared.** This deliberately differs from `StageDispatcher` and `BudgetGuard`, where absence is refusal flatly. Making every caller inject a gate to run an ungated pipeline turns a safety feature into boilerplate, and boilerplate invites a permissive stub that defeats it.
- **The gateway still writes files after this slice, and that is intended.** The handlers' home is `avg-qr4.4`'s adapters. This slice ends the gateway's ownership of execution *semantics*, not its filesystem access.
- **Streaming is out of scope.** There is no event stream in the gateway today; the route stays request/response.
- `studio/runtime` has **no `typecheck` script** — use `npx tsc --noEmit -p studio/runtime/tsconfig.json`. The gateway has one: `npm run typecheck -w @studio/gateway`.
- Baselines that must not regress: contracts 116, runtime 410 across 36 files, gateway 278, agent 184.
- **Commit after every task.**

---

## File Structure

| file | responsibility |
|---|---|
| `studio/runtime/src/execution/types.ts` | **modify** — `ReviewGate` port, `canDispatch` on `StageDispatcher`, `awaiting_review` on `OutcomeStatus` |
| `studio/runtime/src/execution/service.ts` | **modify** — use the gate in the dependency test and in reporting; honour `canDispatch` |
| `studio/runtime/test/unit/execution/review-gate.test.ts` | **new** |
| `studio/gateway/src/runtime/dispatcher.ts` | **new** — the four handlers behind `StageDispatcher` |
| `studio/gateway/src/runtime/review-gate.ts` | **new** — `ReviewGate` backed by `deriveGateState` |
| `studio/gateway/test/runtime/dispatcher.test.ts` | **new** |
| `studio/gateway/src/routes/production.ts` | **modify** — the loop, the report, the dry run |
| `studio/gateway/src/runtime/executor.ts` | **modify** — keep the four handlers, delete everything else |
| `studio/gateway/test/gate-enforcement.test.ts` | **modify** — 17 tests re-pointed |
| `studio/gateway/test/runtime-executor.test.ts` | **modify** — its `HANDLERS` assertions move |

---

### Task 1: `ReviewGate`, `canDispatch`, and `awaiting_review`

**Files:**
- Modify: `studio/runtime/src/execution/types.ts`
- Modify: `studio/runtime/src/execution/service.ts`
- Modify: `studio/runtime/src/execution/index.ts` (export the new type)
- Modify: `studio/runtime/src/index.ts` (export it from the package root)
- Create: `studio/runtime/test/unit/execution/review-gate.test.ts`

**Interfaces:**
- Consumes: the existing `ExecutionService`, `StageDispatcher`, `BudgetGuard`, `dependenciesMet`.
- Produces:
  - `interface ReviewGate { isOutstanding(stageId: string, episodeDir: string): Promise<{ outstanding: boolean; reason?: string }> }`
  - `StageDispatcher.canDispatch?(stage: ResolvedStage): boolean`
  - `OutcomeStatus` gains `"awaiting_review"`.
  - `ExecutionServiceOptions` gains `review?: ReviewGate`.
  - Tasks 2–4 depend on all four names.

**Why `canDispatch` exists, though the spec does not mention it.** `avg-qr4.1` requires a gated stage with no checker behind it to come back `blocked` — a refusal, not a failure. Under the new composition the service would call the dispatcher for `safety-review`, the gateway's dispatcher would find no handler, and a throw maps to `failed`. Without a way for a dispatcher to say "I do not handle this", that test cannot pass, and the distinction between "this attempt broke" and "nothing here can do this" is lost.

- [ ] **Step 1: Write the failing tests**

Create `studio/runtime/test/unit/execution/review-gate.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ExecutionService } from "../../../src/execution/service.js";
import type { ReviewGate, StageDispatcher } from "../../../src/execution/types.js";
import { ok } from "../../../src/result.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINES = resolve(__dirname, "../../../../pipelines/pipelines");
const REF = { channel: "childrens", series: "fairy-tales", episode: "ep" };

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function episode() {
  const root = await mkdtemp(join(tmpdir(), "review-gate-"));
  roots.push(root);
  const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
  await mkdir(join(dir, "artifacts"), { recursive: true });
  return { root, dir };
}

function writer(dir: string): StageDispatcher {
  return {
    dispatch: async (stage) => {
      const file = join(dir, "artifacts", `${stage.definition.id}.md`);
      await writeFile(file, "output");
      return [file];
    },
  };
}

const budget = { maySpend: async () => ok({ reserveId: "r", estimatedCost: 0 }) };
/** Nothing is ever outstanding. */
const permissive: ReviewGate = { isOutstanding: async () => ({ outstanding: false }) };

describe("a stage that needs acceptance", () => {
  it("reports awaiting_review rather than completed", async () => {
    // script declares review: human. Under avg-qr4.1 such a stage never read
    // as completed, because completed is what dependents test.
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: writer(dir), budget, review: permissive,
    });

    await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "script" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("awaiting_review");
  });

  it("still records stage-completed, because it did run", async () => {
    // Completion is what happened; acceptance is whether it counts. The
    // journal records the first and must not be bent to express the second.
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: writer(dir), budget, review: permissive,
    });

    await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    await svc.run(REF, "narrated-illustrated-video", { stage: "script" });

    const status = await svc.status(REF, "narrated-illustrated-video");
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.value.stages.find((s) => s.stageId === "script")!.status).toBe("completed");
  });
});

describe("the review gate on dependencies", () => {
  it("blocks a stage whose dependency has an outstanding review", async () => {
    const { root, dir } = await episode();
    const gate: ReviewGate = {
      isOutstanding: async (stageId) =>
        stageId === "brief"
          ? { outstanding: true, reason: "awaiting review" }
          : { outstanding: false },
    };
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES, dispatcher: writer(dir), budget, review: gate,
    });

    await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "script" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/brief/);
    expect(result.value.reason).toMatch(/awaiting review/);
  });

  it("lets the stage run once that dependency is no longer outstanding", async () => {
    const { root, dir } = await episode();
    let outstanding = true;
    const gate: ReviewGate = {
      isOutstanding: async (stageId) => ({ outstanding: stageId === "brief" && outstanding }),
    };
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES, dispatcher: writer(dir), budget, review: gate,
    });
    await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    expect((await svc.run(REF, "narrated-illustrated-video", { stage: "script" })).ok).toBe(true);

    outstanding = false;
    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "script" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // script itself declares review: human, so it awaits rather than completes.
    expect(result.value.status).toBe("awaiting_review");
  });
});

describe("an absent review gate", () => {
  it("refuses when a stage in the dependency chain declares a review", async () => {
    // The service cannot know whether a required review happened, so it does
    // not guess. Absence is refusal exactly where something is protected.
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES, dispatcher: writer(dir), budget,
    });

    await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "script" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/review/i);
  });

  it("proceeds when nothing in the chain declares a review", async () => {
    // brief declares review: none, so no gate is needed to run it.
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES, dispatcher: writer(dir), budget,
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("completed");
  });
});

describe("a dispatcher that does not handle a stage", () => {
  it("blocks rather than failing", async () => {
    // "Nothing here can do this" is a refusal someone must clear, not an
    // attempt that broke and can be retried.
    const { root, dir } = await episode();
    const dispatcher: StageDispatcher = {
      ...writer(dir),
      canDispatch: (stage) => stage.definition.id !== "brief",
    };
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES, dispatcher, budget, review: permissive,
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/does not handle/i);
  });

  it("dispatches normally when canDispatch is absent", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: writer(dir), budget, review: permissive,
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("completed");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @studio/runtime -- review-gate`
Expected: FAIL — `review` is not a known option, `awaiting_review` is not a status, `canDispatch` is not on the type.

- [ ] **Step 3: Add the types**

In `studio/runtime/src/execution/types.ts`, add `"awaiting_review"` to `OutcomeStatus` with a doc line:

```ts
  /**
   * The stage ran and its outputs hold up, but it declares a review and is not
   * accepted yet. Its dependents must not treat it as done — completion is what
   * happened, acceptance is whether it counts.
   */
  | "awaiting_review"
```

Add `canDispatch` to `StageDispatcher`:

```ts
export interface StageDispatcher {
  dispatch(stage: ResolvedStage, ctx: DispatchContext): Promise<string[]>;
  /**
   * Whether this dispatcher performs this stage at all.
   *
   * A dispatcher that does not handle a stage is a refusal someone must clear —
   * no adapter exists, no handler is registered — not an attempt that broke.
   * Omit it to mean "I handle everything I am given".
   */
  canDispatch?(stage: ResolvedStage): boolean;
}
```

Add the port and the option:

```ts
/**
 * Whether a stage's review is still outstanding.
 *
 * Injected rather than owned, because what an approval IS belongs to
 * avg-qr4.3, and the service deciding it first is the mistake this epic exists
 * to close. The gateway supplies one backed by gate-review records.
 */
export interface ReviewGate {
  /** Outstanding means requested-but-not-granted, or invalidated. */
  isOutstanding(stageId: string, episodeDir: string): Promise<{ outstanding: boolean; reason?: string }>;
}
```

and in `ExecutionServiceOptions`:

```ts
  /**
   * Consulted for dependency acceptance and for whether a finished stage still
   * needs one. Absent, the service refuses only where the manifest declares a
   * review — see the dependency check in service.ts for why that is not the
   * flat "absence is refusal" the other two ports use.
   */
  review?: ReviewGate;
```

- [ ] **Step 4: Use the gate in the dependency test**

In `studio/runtime/src/execution/service.ts`, replace the dependency check inside `run()`. The existing check is `if (!dependenciesMet(stage, derived))`. Replace that block with:

```ts
    // A dependency is satisfied when it completed AND its review, if one is
    // required, is not outstanding. Completion is what happened; acceptance is
    // whether it counts. Conflating them is how downstream stages came to build
    // on artifacts nobody had accepted.
    const unmet = (stage.definition.dependsOn ?? [])
      .filter((id) => derived.get(id)?.status !== "completed");
    if (unmet.length > 0) {
      return blocked(
        `"${stageId}" depends on ${unmet.map((m) => `"${m}"`).join(", ")}, ` +
        `which ${unmet.length === 1 ? "has" : "have"} not completed`,
      );
    }

    for (const depId of stage.definition.dependsOn ?? []) {
      const depStage = stages.find((s) => s.definition.id === depId);
      const depNeedsReview = depStage?.definition.gates.review !== "none";
      if (!depNeedsReview) continue;

      if (!this.options.review) {
        return blocked(
          `"${depId}" declares ${depStage!.definition.gates.review} review and no review gate ` +
          `is configured, so whether it was accepted cannot be known`,
        );
      }
      const verdict = await this.options.review.isOutstanding(depId, episodeDir);
      if (verdict.outstanding) {
        return blocked(
          `"${stageId}" cannot run: "${depId}" ${verdict.reason ?? "has an outstanding review"}`,
        );
      }
    }
```

- [ ] **Step 5: Honour `canDispatch`, and report `awaiting_review`**

Still in `run()`, immediately after the existing `if (!this.options.dispatcher)` check, add:

```ts
    if (this.options.dispatcher.canDispatch?.(stage) === false) {
      return blocked(`the configured dispatcher does not handle "${stageId}"`);
    }
```

Then at the end of the success path, replace the final `return ok({ stageId, status: "completed", ... })` with:

```ts
    // A stage that declares a review has run, and its outputs hold up — but it
    // is not accepted. Its journal record says completed because that is true;
    // its outcome says awaiting_review because that is what the caller needs.
    const needsReview = stage.definition.gates.review !== "none";
    return ok({
      stageId,
      status: needsReview ? "awaiting_review" : "completed",
      outputs: relative, attemptNumber, leaseId,
      durationMs: Date.now() - startedAt,
      ...(needsReview ? { reason: `"${stageId}" declares ${stage.definition.gates.review} review and is not accepted yet` } : {}),
    });
```

- [ ] **Step 6: Export the new type**

In `studio/runtime/src/execution/index.ts` and `studio/runtime/src/index.ts`, add `ReviewGate` to the type export lists alongside `StageDispatcher` and `BudgetGuard`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -w @studio/runtime -- review-gate`
Expected: PASS, all eight.

Then the full runtime suite — earlier tests construct services without a `review` option and run pipelines that declare reviews, so some will now block where they previously completed:

Run: `npm test -w @studio/runtime && npx tsc --noEmit -p studio/runtime/tsconfig.json`
Expected: some existing execution tests FAIL. That is the new rule working. For each, decide deliberately: if the test's subject is unrelated to reviews, give it a permissive `ReviewGate` so it tests what it meant to; if its subject IS completion semantics, update the expectation and say so in your report. Do NOT make the rule conditional to keep a test green.

- [ ] **Step 8: Commit**

```bash
git add studio/runtime/src/execution studio/runtime/src/index.ts studio/runtime/test/unit/execution
git commit -m "runtime: a review gate the caller injects, and a status for unaccepted work

A stage declaring review: human ran and its outputs hold up, but it is not
accepted — and completed is exactly what dependents test. Separating the two
lets the journal keep recording what happened while the dependency check asks
whether it counts.

The gate is a port because what an approval IS belongs to avg-qr4.3. Absent,
the service refuses only where a review is declared: making every caller
inject a gate to run an ungated pipeline would turn a safety feature into
boilerplate, and boilerplate invites a permissive stub.

canDispatch lets a dispatcher say it does not perform a stage at all, which is
a refusal to clear rather than an attempt that broke."
```

---

### Task 2: The gateway's two collaborators

**Files:**
- Create: `studio/gateway/src/runtime/dispatcher.ts`
- Create: `studio/gateway/src/runtime/review-gate.ts`
- Create: `studio/gateway/test/runtime/dispatcher.test.ts`
- Modify: `studio/gateway/src/runtime/executor.ts` (export the four handlers)

**Interfaces:**
- Consumes: `StageDispatcher`, `ReviewGate`, `DispatchContext` from `@studio/runtime` (Task 1); `deriveGateState` and `parseJournal` from `@studio/contracts`.
- Produces: `class GatewayDispatcher implements StageDispatcher` and `class GatewayReviewGate implements ReviewGate`, both consumed by Task 3.

Nothing is wired yet — both files are additive and the gateway suite stays green.

- [ ] **Step 1: Write the failing test**

Create `studio/gateway/test/runtime/dispatcher.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GatewayDispatcher } from "../../src/runtime/dispatcher.js";
import { GatewayReviewGate } from "../../src/runtime/review-gate.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

const REF = { channel: "childrens", series: "fairy-tales", episode: "ep" };

async function episode() {
  const root = await mkdtemp(join(tmpdir(), "gw-dispatch-"));
  roots.push(root);
  const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
  await mkdir(join(dir, "artifacts"), { recursive: true });
  await mkdir(join(dir, "assets", "images"), { recursive: true });
  await mkdir(join(dir, "journal"), { recursive: true });
  return { root, dir };
}

/** A minimal ResolvedStage, which is all the dispatcher reads. */
const stageNamed = (id: string) =>
  ({ definition: { id, name: id, dependsOn: [], gates: { autopilot: true, review: "none", retryOnFailure: 0 } },
     source: "test", topoIndex: 0 }) as never;

const ctx = (dir: string) => ({ episodeDir: dir, ref: REF, attemptNumber: 1, log: () => {} });

describe("GatewayDispatcher", () => {
  it("performs a stage it has a handler for, and returns what it wrote", async () => {
    const { dir } = await episode();
    await writeFile(join(dir, "assets", "images", "s1.png"), "image bytes");

    const outputs = await new GatewayDispatcher().dispatch(stageNamed("illustrations"), ctx(dir));

    expect(outputs.length).toBeGreaterThan(0);
    // The work really happened — assert the artifact, not the call.
    expect(await readFile(outputs[0]!, "utf-8")).toBe("image bytes");
  });

  it("says it does not handle a stage with no handler", () => {
    const dispatcher = new GatewayDispatcher();
    expect(dispatcher.canDispatch(stageNamed("safety-review"))).toBe(false);
    expect(dispatcher.canDispatch(stageNamed("continuity-check"))).toBe(false);
  });

  it("handles exactly the four stages the gateway still performs", () => {
    const dispatcher = new GatewayDispatcher();
    for (const id of ["illustrations", "captions", "timing", "qa"]) {
      expect(dispatcher.canDispatch(stageNamed(id))).toBe(true);
    }
  });
});

describe("GatewayReviewGate", () => {
  /** Append a gate-review journal event the way requestReview did. */
  async function requested(dir: string, stageId: string) {
    const event = {
      apiVersion: "studio.video/v1alpha1", kind: "JournalEvent",
      id: `evt_${"0".repeat(26)}`, episodeRef: REF, at: new Date().toISOString(),
      actor: "gateway", type: "approval-requested",
      data: { stageId, decision: "requested", actor: "gateway", at: new Date().toISOString(),
              inputs: [], outputs: [], checks: [] },
    };
    await appendFile(join(dir, "journal", "events.jsonl"), `${JSON.stringify(event)}\n`, "utf-8");
  }

  it("reports a requested review as outstanding", async () => {
    const { dir } = await episode();
    await requested(dir, "illustrations");

    const verdict = await new GatewayReviewGate().isOutstanding("illustrations", dir);

    expect(verdict.outstanding).toBe(true);
    expect(verdict.reason).toMatch(/review/i);
  });

  it("reports a stage with no review record as not outstanding", async () => {
    const { dir } = await episode();
    const verdict = await new GatewayReviewGate().isOutstanding("illustrations", dir);
    expect(verdict.outstanding).toBe(false);
  });

  it("treats an unreadable journal as outstanding rather than guessing", async () => {
    // Failing closed: not knowing whether a review happened is not the same as
    // knowing it did.
    const { dir } = await episode();
    await appendFile(join(dir, "journal", "events.jsonl"), "{ truncated mid-wri\n", "utf-8");

    const verdict = await new GatewayReviewGate().isOutstanding("illustrations", dir);

    expect(verdict.outstanding).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @studio/gateway -- dispatcher`
Expected: FAIL — neither module exists.

- [ ] **Step 3: Export the four handlers**

In `studio/gateway/src/runtime/executor.ts`, change the four handler declarations from `async function handleX` to `export async function handleX`, and export the `StageContext` interface. Leave everything else in that file alone — Task 4 deletes the rest.

- [ ] **Step 4: Write the dispatcher**

Create `studio/gateway/src/runtime/dispatcher.ts`:

```ts
// ---------------------------------------------------------------------------
// The gateway's stage dispatcher
// ---------------------------------------------------------------------------
// The gateway used to decide what ran, when, and whether it counted. It now
// only performs the work it is asked to, when the execution service asks.
//
// These four handlers still write artifacts, which ADR-0027 does not literally
// permit. Their home is avg-qr4.4's capability adapters; moving them before
// that issue designs the registry would decide where capability work lives
// ahead of the decision itself. What ends here is the gateway's ownership of
// execution semantics.
// ---------------------------------------------------------------------------

import type { StageDispatcher, DispatchContext } from "@studio/runtime";
import type { ResolvedStage } from "@studio/runtime";
import {
  handleIllustrations, handleCaptions, handleTiming, handleQa, type StageContext,
} from "./executor.js";

type Handler = (ctx: StageContext) => Promise<string[]>;

const HANDLERS: Record<string, Handler> = {
  illustrations: handleIllustrations,
  captions: handleCaptions,
  timing: handleTiming,
  qa: handleQa,
};

export class GatewayDispatcher implements StageDispatcher {
  /**
   * safety-review and continuity-check are deliberately absent, as they have
   * been since avg-qr4.1 deleted the handlers that invented their findings. A
   * stage with no handler is a refusal for someone to clear, not a failure.
   */
  canDispatch(stage: ResolvedStage): boolean {
    return stage.definition.id in HANDLERS;
  }

  async dispatch(stage: ResolvedStage, ctx: DispatchContext): Promise<string[]> {
    const handler = HANDLERS[stage.definition.id];
    if (!handler) {
      throw new Error(`The gateway has no handler for stage "${stage.definition.id}"`);
    }
    return handler({ episodeDir: ctx.episodeDir, ref: ctx.ref, log: ctx.log });
  }
}
```

- [ ] **Step 5: Write the review gate**

Create `studio/gateway/src/runtime/review-gate.ts`:

```ts
// ---------------------------------------------------------------------------
// The gateway's review gate
// ---------------------------------------------------------------------------
// avg-qr4.1 bound a review to sha256 hashes of the artifacts it examined, so
// changing a reviewed artifact invalidates its review. This adapts that record
// to the port the execution service consults, moving the logic rather than
// rewriting it.
// ---------------------------------------------------------------------------

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import type { ReviewGate } from "@studio/runtime";
import { parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { deriveGateState } from "@studio/contracts/src/gate-review.mjs";

export class GatewayReviewGate implements ReviewGate {
  async isOutstanding(
    stageId: string,
    episodeDir: string,
  ): Promise<{ outstanding: boolean; reason?: string }> {
    let events;
    try {
      const contents = await readFile(path.join(episodeDir, JOURNAL_RELATIVE_PATH), "utf-8");
      events = parseJournal(contents, { strict: true });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        // No journal at all means nothing has been reviewed or requested.
        return { outstanding: false };
      }
      // A journal that exists and cannot be read is not evidence of approval.
      return {
        outstanding: true,
        reason: `has a review that cannot be read: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    const state = await deriveGateState(events, stageId, episodeDir);
    if (state.state === "requested") {
      return { outstanding: true, reason: "is awaiting review" };
    }
    if (state.state === "invalidated") {
      return { outstanding: true, reason: `has an invalidated review: ${state.reason}` };
    }
    return { outstanding: false };
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -w @studio/gateway -- dispatcher`
Expected: PASS, all six.

Then: `npm test -w @studio/gateway && npm run typecheck -w @studio/gateway`
Expected: PASS — nothing is wired yet, so the 278 existing tests are untouched.

- [ ] **Step 7: Commit**

```bash
git add studio/gateway/src/runtime/dispatcher.ts studio/gateway/src/runtime/review-gate.ts \
        studio/gateway/test/runtime/dispatcher.test.ts studio/gateway/src/runtime/executor.ts
git commit -m "gateway: a dispatcher and a review gate the service can consult

The four handlers keep doing the work and stop deciding when. The review gate
adapts avg-qr4.1's hash-bound records to the port the service asks, moving
that logic rather than rewriting it — and an unreadable journal reports as
outstanding, because not knowing whether a review happened is not the same as
knowing it did."
```

---

### Task 3: `production.ts` runs the service

**Files:**
- Modify: `studio/gateway/src/routes/production.ts`

**Interfaces:**
- Consumes: `ExecutionService`, `GatewayDispatcher`, `GatewayReviewGate`, `StageOutcome` (Tasks 1–2).
- Produces: an `/execute` route whose report has the same shape the web UI already reads — `{ episodeSlug, pipeline, stages: [{ stageId, status, outputs, durationMs, error? }], totalDurationMs, summary }`.

`runAutopilot` still exists after this task, merely unused. That is deliberate: it keeps this task's diff reviewable on its own and leaves the 17 tests passing against the old path until Task 4 re-points them. Do not delete it here.

- [ ] **Step 1: Replace the execute handler**

In `studio/gateway/src/routes/production.ts`, replace the body of the `/execute` route (currently the `dryRun` branch plus the `runAutopilot` call, around lines 125-143) with:

```ts
    const libraryRoot = process.env.AVG_LIBRARY_ROOT ?? "./library";
    const service = new ExecutionService({
      libraryRoot,
      dispatcher: new GatewayDispatcher(),
      review: new GatewayReviewGate(),
      budget: { maySpend: async () => ({ ok: true as const, value: { reserveId: "gateway", estimatedCost: 0 } }) },
      holder: `gateway/pid-${process.pid}`,
      log: (message) => request.log.info(message),
    });

    if (dryRun) {
      const outcome = await service.run(ref, pipeline, { dryRun: true });
      return outcome.ok
        ? { ok: true, dryRun: true, outcome: outcome.value }
        : { ok: false, dryRun: true, error: outcome.error };
    }

    // The loop the gateway used to own is now just a caller's choice: keep
    // going while stages complete, stop at the first one that does not.
    const startedAt = Date.now();
    const stages: StageOutcome[] = [];
    for (let i = 0; i < MAX_STAGES_PER_EXECUTE; i++) {
      const outcome = await service.run(ref, pipeline);
      if (!outcome.ok) {
        return { ok: false, error: outcome.error, report: report(ref, pipeline, stages, startedAt) };
      }
      if (outcome.value.status === "idle") break;
      stages.push(outcome.value);
      if (outcome.value.status !== "completed") break;
    }

    return {
      ok: stages.every((s) => s.status !== "failed"),
      report: report(ref, pipeline, stages, startedAt),
    };
```

- [ ] **Step 2: Add the report helper and the imports**

At the top of `production.ts`, add:

```ts
import { ExecutionService, type StageOutcome } from "@studio/runtime";
import { GatewayDispatcher } from "../runtime/dispatcher.js";
import { GatewayReviewGate } from "../runtime/review-gate.js";
```

I checked: `ok` is **not** exported from `@studio/runtime`'s root, and reaching into `@studio/runtime/dist/src/result.js` to get it would violate ADR-0026's package-resolution rule. So build the permissive budget's result inline in the service construction above:

```ts
      budget: { maySpend: async () => ({ ok: true as const, value: { reserveId: "gateway", estimatedCost: 0 } }) },
```

`ResolvedStage` **is** exported from the root, so `dispatcher.ts`'s import of it in Task 2 needs no such workaround.

Near the other module-level constants, add:

```ts
/** A single execute call advances at most this many stages before returning. */
const MAX_STAGES_PER_EXECUTE = 20;

/** The shape the web UI already reads. Kept deliberately unchanged. */
function report(
  ref: { channel: string; series: string; episode: string },
  pipeline: string,
  stages: StageOutcome[],
  startedAt: number,
) {
  const totalDurationMs = Date.now() - startedAt;
  const count = (status: StageOutcome["status"]) => stages.filter((s) => s.status === status).length;
  const parts = [`${count("completed")} completed`, `${count("failed")} failed`];
  // A run that halted is not a run that finished.
  if (count("awaiting_review") > 0) parts.push(`${count("awaiting_review")} awaiting review`);
  if (count("blocked") > 0) parts.push(`${count("blocked")} blocked`);

  return {
    episodeSlug: `${ref.channel}/${ref.series}/${ref.episode}`,
    pipeline,
    stages: stages.map((s) => ({
      stageId: s.stageId,
      status: s.status,
      outputs: s.outputs,
      durationMs: s.durationMs,
      ...(s.reason ? { error: s.reason } : {}),
    })),
    totalDurationMs,
    summary: stages.length === 0
      ? `Nothing to do (${(totalDurationMs / 1000).toFixed(1)}s)`
      : `${parts.join(", ")}, ${stages.length} total (${(totalDurationMs / 1000).toFixed(1)}s)`,
  };
}
```

- [ ] **Step 3: Run the gateway suite**

Run: `npm test -w @studio/gateway && npm run typecheck -w @studio/gateway`
Expected: the 17 `gate-enforcement` tests still PASS — they call `runAutopilot` directly, which still exists. Any `production`-route test may fail if one asserts the old report's exact fields; fix those against the new shape and say so in your report.

- [ ] **Step 4: Commit**

```bash
git add studio/gateway/src/routes/production.ts
git commit -m "gateway: /execute runs through the execution service

The loop the gateway used to own is now just a caller's choice — keep going
while stages complete, stop at the first that does not. The report keeps the
shape the web UI reads, and counts awaiting and blocked stages so a halt
cannot be read as a finish.

runAutopilot is now unused but still present; deleting it is the next commit,
so that the 17 tests encoding its behaviour move in one reviewable step."
```

---

### Task 4: Re-point the 17 tests, then delete `runAutopilot`

**Files:**
- Modify: `studio/gateway/test/gate-enforcement.test.ts` (all 17)
- Modify: `studio/gateway/test/runtime-executor.test.ts`
- Modify: `studio/gateway/src/runtime/executor.ts` (delete everything but the four handlers)

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: an `executor.ts` containing only the four handlers, their helpers, and `StageContext`.

**This is the task that can go wrong quietly.** These 17 tests encode behaviour bought with a whole branch. The failure mode is not that they break — it is that they pass after translation while asserting less than they did. Translate each one deliberately, and when you cannot express a test against the new composition, say so in your report rather than dropping or weakening it.

- [ ] **Step 1: Read the originals before changing anything**

Run: `git show HEAD:studio/gateway/test/gate-enforcement.test.ts > /tmp/gate-enforcement-original.ts`

Keep that file open while you work. For each test, the question is "does my replacement assert the same property?", not "does it pass?".

- [ ] **Step 2: Rewrite the harness**

The old tests drove `runAutopilot` with a fake `RuntimeClient` (`runtimeOffering(...stageIds)`) that fed it a stage sequence. The service selects its own stages from the pipeline and the journal, so that fake disappears. Replace the file's setup with:

```ts
import { ExecutionService } from "@studio/runtime";
import { GatewayDispatcher } from "../src/runtime/dispatcher.js";
import { GatewayReviewGate } from "../src/runtime/review-gate.js";

const PIPELINES = resolve(__dirname, "../../pipelines/pipelines");

/** The gateway's real composition, with a permissive budget. */
function gatewayService(root: string, over?: Partial<ConstructorParameters<typeof ExecutionService>[0]>) {
  return new ExecutionService({
    libraryRoot: root,
    builtinPipelines: PIPELINES,
    dispatcher: new GatewayDispatcher(),
    review: new GatewayReviewGate(),
    budget: { maySpend: async () => ({ ok: true as const, value: { reserveId: "t", estimatedCost: 0 } }) },
    holder: "test/1",
    ...over,
  });
}
```

Where a test previously controlled which stage ran by what the fake runtime offered, name the stage explicitly: `svc.run(REF, "fairy-tale-adaptation", { stage: "safety-review" })`.

- [ ] **Step 3: Translate the 17, one at a time**

Work through them in file order. The mapping for each:

| original | how it is expressed now |
|---|---|
| blocks a stage the manifest says may not run unattended | `run(..., { stage: "safety-review" })` → `blocked`; `safety-review` declares `autopilot: false` |
| never writes a safety report for an episode it did not read | unchanged in substance — assert no `artifacts/safety-report.json` after the run |
| blocks a gated stage that has no checker behind it | `continuity-check` → `blocked`; this is the test `canDispatch` exists for |
| leaves a human-reviewed stage awaiting approval, not completed | now `status === "awaiting_review"` rather than the old `awaiting_approval` string |
| never emits an approval of its own | unchanged — assert no `approval-granted` in the journal |
| stops the run at the first unaccepted stage | drive the loop the route uses and assert it stops |
| blocks rather than guessing a stage has no gates | point `builtinPipelines` at an empty directory so the pipeline will not resolve, and assert the error rather than a silent proceed |
| does not run the handler of a stage whose gates it could not read | same setup; assert no artifacts written |
| fails a stage that produced nothing | inject a dispatcher returning `[]` via the `over` parameter |
| fails a stage whose output is an empty file | inject a dispatcher writing a zero-byte file |
| counts blocked and awaiting stages so a halt cannot read as a finish | assert on the route's `report.summary` |
| does not report completion when the runtime never resolved a stage | assert the unresolvable-pipeline error surfaces |
| blocks a stage whose dependency is still awaiting review | the `GatewayReviewGate` path — write an `approval-requested` for the dependency |
| lets the stage run once that dependency is approved | write a valid `approval-granted` with real hashes |
| blocks when the dependency's approval no longer matches what is on disk | approve, then mutate the artifact; `deriveGateState` returns `invalidated` |
| keeps a halt at a review gate across the next execute | run twice; the second must still block |
| cannot produce a pass with no render present | `qa` with no render → not `completed`, report carries no passing verdict |

Two of these change wording rather than substance: `awaiting_approval` becomes `awaiting_review`, and where a test asserted on `ExecutionReport.stages[].status` it now asserts on `StageOutcome.status`. Neither is a weakening. Any other change to an assertion is, and must be reported.

- [ ] **Step 4: Move the HANDLERS assertions**

`runtime-executor.test.ts` asserts that `HANDLERS` has exactly four keys and no fabricating handler. `HANDLERS` moves into `dispatcher.ts` as a module-private constant, so re-point those assertions at `GatewayDispatcher.canDispatch` instead — it is the same property through the surviving surface:

```ts
  it("registers no handler that invents a review", () => {
    const dispatcher = new GatewayDispatcher();
    expect(dispatcher.canDispatch(stageNamed("safety-review"))).toBe(false);
    expect(dispatcher.canDispatch(stageNamed("continuity-check"))).toBe(false);
  });
```

Keep the test that greps `executor.ts` for the wolf text — it still guards the same thing.

- [ ] **Step 5: Run the tests before deleting anything**

Run: `npm test -w @studio/gateway`
Expected: PASS. If a test cannot be made to pass without weakening it, STOP and report that — it is a finding about the design, not a test to adjust.

- [ ] **Step 6: Delete `runAutopilot` and its machinery**

From `studio/gateway/src/runtime/executor.ts`, delete: `runAutopilot`, `HANDLERS`, `loadGates`, `blockingDependency`, `readJournal`, `requestReview`, `validateOutputs`, `closeIfExpired` if present, `StageResult`, `ExecutionReport`, and any import left unused.

What remains: `handleIllustrations`, `handleCaptions`, `handleTiming`, `handleQa`, `StageContext`, and the helpers those four use (`findRender`, `exists`, the narration and SRT helpers).

Add a header comment saying what the file is now:

```ts
// ── Stage handlers ─────────────────────────────────────────────────────────
//
// What the gateway can perform, and nothing about when. Orchestration — what
// runs, in what order, under what lease, and whether the result counted — moved
// to the execution service in @studio/runtime; this file used to own all of it.
//
// These handlers still write artifacts, which ADR-0027 does not literally
// permit. Their home is avg-qr4.4's capability adapters.
```

- [ ] **Step 7: Verify**

Run:

```bash
npm test -w @studio/gateway && npm test -w @studio/runtime && npm test -w @studio/contracts
npm run typecheck -w @studio/gateway && npx tsc --noEmit -p studio/runtime/tsconfig.json
```

Expected: all pass, zero failures.

- [ ] **Step 8: Commit**

```bash
git add studio/gateway/test studio/gateway/src/runtime/executor.ts
git commit -m "gateway: delete runAutopilot, and re-point the tests that encoded it

The gateway no longer decides what runs, when, under what lease, or whether
the result counted. executor.ts is now what the gateway can perform and
nothing about when.

The 17 tests avg-qr4.1 left behind move to the new composition with their
assertions intact — two change wording (awaiting_approval becomes
awaiting_review, and StageResult becomes StageOutcome) and none change
substance."
```

---

## Self-Review

**Spec coverage:**

| spec section | task |
|---|---|
| 1. Completion and acceptance are different facts | 1 (the dependency test) |
| 2. The `ReviewGate` port, both uses | 1 |
| 2a. Absent gate refuses only where a review is declared | 1, both halves tested |
| 3. What the gateway keeps and loses | 2 (collaborators), 4 (deletion) |
| 3a. `production.ts` gains the loop | 3 |
| 4. Handlers stay, deliberately | 2's header comment, 4's header comment |
| 5. Streaming out of scope | not implemented; route stays synchronous |
| Testing: the 17 survive | 4, with a per-test mapping table |

**Gap found and closed during review:** the spec does not mention `canDispatch`. Without it, `avg-qr4.1`'s "blocks a gated stage that has no checker behind it" cannot pass — the service would call the gateway's dispatcher for `safety-review`, get a throw, and report `failed` where the test requires `blocked`. Task 1 adds it as an optional method so existing dispatchers are unaffected. The spec should be treated as incomplete here rather than as authority.

**Second gap:** the spec says the dependency test consults the gate, but not what happens when a dependency declares a review and the gate is absent — the "conditional refusal" rule is stated for stages generally. Task 1 step 4 resolves it explicitly: the refusal is per-dependency, checked against that dependency's own declared `gates.review`.

**Placeholder scan:** clean. Task 3 step 2 originally left open whether `ok` is exported from `@studio/runtime`'s root; I checked rather than leaving the implementer to re-derive it. It is not, and reaching into `dist/` for it would violate ADR-0026, so the step now specifies the inline literal. `ResolvedStage`, which Task 2 imports from the root, is exported.

**Type consistency:** `ReviewGate.isOutstanding(stageId, episodeDir)` returning `{ outstanding, reason? }` is defined in Task 1 and implemented in Task 2 with those exact names. `canDispatch(stage)` likewise. `StageOutcome.status` gains `awaiting_review` in Task 1 and is consumed in Task 3's report and Task 4's assertions. `GatewayDispatcher` and `GatewayReviewGate` are created in Task 2 and constructed in Tasks 3 and 4 with no arguments.

## Risks

- **Task 4 is where this goes wrong.** A translated test that passes while asserting less is invisible at merge and afterwards. The mapping table names what each test must still prove; the reviewer should compare against `/tmp/gate-enforcement-original.ts`, not just check the suite is green.
- **Task 1 will break existing runtime tests**, because pipelines that declare reviews now block without a gate. That is the rule working. The instruction is to give unrelated tests a permissive gate rather than soften the rule — a reviewer should check no test was made green by weakening the condition.
- **`awaiting_review` is the third addition to `OutcomeStatus`.** There were no exhaustive consumers before this slice; `production.ts` becomes the first, and must handle all five members.
- **This slice gives the execution service its first production caller.** Defects in slices A or B stop being theoretical here, which is a reason to weight the final review toward integration behaviour rather than the diff.
