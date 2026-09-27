import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionService } from "../../../src/execution/service.js";
import type { StageDispatcher } from "../../../src/execution/types.js";
import { ok } from "../../../src/result.js";
import { reviewChainPipeline } from "./helpers/review-chain.js";
import { parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { verifyReceipt } from "@studio/contracts/src/receipt.mjs";
import { FileLock } from "../../../src/ports/file-lock.js";

const REF = { channel: "childrens", series: "fairy-tales", episode: "ep" };
const KEY = "operator-key-for-tests";

// Controls a mock of @studio/contracts' appendJournalEvent, used only by the
// "the append fails" test below. Same technique run.test.ts uses for
// stage-leased/stage-started/terminal writes (Finding 3): a dropped write
// must never be reported as recorded, and `review()` is the only code that
// writes a review event, so this is the one place that guarantee has to hold
// for approval-granted/-rejected/-requested too. vi.hoisted so the vi.mock
// factory — hoisted above these imports — can close over it.
const journalMockState = vi.hoisted(() => ({
  /** A review event type to drop, or null. */
  dropReviewEvent: null as null | "approval-granted" | "approval-rejected" | "approval-requested",
  /**
   * Fix round 1: when true, the mock probes `stage:<id>`'s file lock at the
   * exact moment `complete()` appends `approval-requested`, before handing
   * the write to the real `appendJournalEvent`. This is what pins the
   * ordering fix — the request must be written while `complete()` still
   * holds the lease, before `sm.complete()` releases it — without depending
   * on timing: the probe's own `acquire` either finds the lockfile still
   * there (conflict, the fix holds) or gets it (the ordering regressed).
   */
  probeLockOnRequest: false,
  /** `false` = the probe's `acquire` conflicted (lock still held — correct).
   * `true` = the probe acquired it (lock already released — the bug this
   * pins). `undefined` = the probe never ran. */
  probeAcquired: undefined as undefined | boolean,
}));

vi.mock("@studio/contracts/src/journal.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@studio/contracts/src/journal.mjs")>();
  return {
    ...actual,
    appendJournalEvent: async (episodeDir: string, input: any) => {
      if (input.type === "approval-requested" && journalMockState.probeLockOnRequest) {
        const probe = new FileLock(`${episodeDir}/.locks`);
        const attempt = await probe.acquire(`stage:${input.data.stageId}`, 1000);
        journalMockState.probeAcquired = attempt.ok;
        if (attempt.ok) await probe.release(attempt.value);
      }
      if (input.type === journalMockState.dropReviewEvent) {
        return null;
      }
      return actual.appendJournalEvent(episodeDir, input);
    },
  };
});

afterEach(() => {
  journalMockState.dropReviewEvent = null;
  journalMockState.probeLockOnRequest = false;
  journalMockState.probeAcquired = undefined;
});

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function episode() {
  const root = await mkdtemp(join(tmpdir(), "exec-review-"));
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
const permissive = { isOutstanding: async () => ({ state: "approved" as const }) };

async function journal(dir: string) {
  return parseJournal(await readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8"), { strict: true });
}

/**
 * `upstream` (no review), then the named stage, both run for real.
 *
 * Module-scoped rather than nested in one describe: task 8's own describe
 * block below needs the exact same setup — a reviewed stage that really
 * completed through `complete()` — to see what it appends to the journal.
 */
async function completed(stage: string, operatorKey: string | null = KEY) {
  const { root, dir } = await episode();
  const pipelines = await reviewChainPipeline(roots);
  const svc = new ExecutionService({
    libraryRoot: root, builtinPipelines: pipelines,
    dispatcher: writer(dir), budget, review: permissive, operatorKey,
  });
  await svc.run(REF, "review-chain", { stage: "upstream" });
  await svc.run(REF, "review-chain", { stage });
  return { svc, dir };
}

describe("ExecutionService.review", () => {
  it("writes a signed human grant for the operator", async () => {
    const { svc, dir } = await completed("gated");
    const out = await svc.review(REF, "review-chain", "gated", { decision: "approved", principal: "operator" });
    expect(out.ok && out.value.status).toBe("approved");
    const grant = (await journal(dir)).filter((e: any) => e.type === "approval-granted").at(-1)!;
    expect(grant.actor).toBe("runtime");
    expect((grant.data as any).origin).toBe("human");
    expect((grant.data as any).binding.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyReceipt(grant.data as object, KEY)).toBe(true);
  });

  it("turns an agent's approval of a human gate into a request, and says so", async () => {
    const { svc, dir } = await completed("gated");
    const out = await svc.review(REF, "review-chain", "gated", { decision: "approved", principal: "agent" });
    expect(out.ok && out.value.status).toBe("requested");
    expect(out.ok && out.value.reason).toMatch(/operator/);
    const types = (await journal(dir)).map((e: any) => e.type);
    expect(types).not.toContain("approval-granted");
    expect(types.at(-1)).toBe("approval-requested");
  });

  it("lets an agent grant a skill review, unsigned", async () => {
    const { svc, dir } = await completed("skilled");
    const out = await svc.review(REF, "review-chain", "skilled", { decision: "approved", principal: "agent" });
    expect(out.ok && out.value.status).toBe("approved");
    const grant = (await journal(dir)).filter((e: any) => e.type === "approval-granted").at(-1)!;
    expect((grant.data as any).origin).toBe("agent");
    expect((grant.data as any).signature).toBeUndefined();
  });

  it("records an operator's rejection with its note, signed", async () => {
    const { svc, dir } = await completed("gated");
    const out = await svc.review(REF, "review-chain", "gated", { decision: "rejected", principal: "operator", note: "too dark" });
    expect(out.ok && out.value.status).toBe("rejected");
    // Not `.at(-1)`: "gated" has a real dependent in this pipeline
    // ("downstream"), so the rejection is followed by a `staleness-marked`
    // event (avg-qr4.3, task 9) — this asserts the rejection itself, not
    // whichever event the journal happens to end on.
    const rej = (await journal(dir)).filter((e) => e.type === "approval-rejected").at(-1)!;
    expect(verifyReceipt(rej.data as object, KEY)).toBe(true);
  });

  it("refuses an operator review when no key is configured to sign with", async () => {
    const { svc } = await completed("gated", null);
    const out = await svc.review(REF, "review-chain", "gated", { decision: "approved", principal: "operator" });
    expect(out.ok && out.value.status).toBe("blocked");
    expect(out.ok && out.value.reason).toMatch(/no operator key/);
  });

  it("refuses a stage that has not completed", async () => {
    const { root } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: await reviewChainPipeline(roots),
      budget, operatorKey: KEY,
    });
    const out = await svc.review(REF, "review-chain", "gated", { decision: "approved", principal: "operator" });
    expect(out.ok && out.value.status).toBe("blocked");
    expect(out.ok && out.value.reason).toMatch(/has not completed/);
  });

  it("refuses a stage that declares no review", async () => {
    const { svc } = await completed("upstream");
    const out = await svc.review(REF, "review-chain", "upstream", { decision: "approved", principal: "operator" });
    expect(out.ok && out.value.status).toBe("blocked");
    expect(out.ok && out.value.reason).toMatch(/declares no review/);
  });

  it("returns STAGE_UNKNOWN for a stage the pipeline does not declare", async () => {
    const { svc } = await completed("gated");
    const out = await svc.review(REF, "review-chain", "nope", { decision: "approved", principal: "operator" });
    expect(!out.ok && out.error.code).toBe("STAGE_UNKNOWN");
  });

  it("refuses when the journal write for the decision does not land", async () => {
    const { svc } = await completed("gated");
    journalMockState.dropReviewEvent = "approval-granted";
    const out = await svc.review(REF, "review-chain", "gated", { decision: "approved", principal: "operator" });
    expect(out.ok && out.value.status).toBe("blocked");
    expect(out.ok && out.value.reason).toMatch(/could not be written/);
  });
});

// ---------------------------------------------------------------------------
// avg-qr4.3, task 8: a completed reviewed stage asks for its review.
//
// avg-2n7 deleted the loop that used to write this record, so a stage that
// finished a `review: human` or `review: skill` gate left nothing in the
// journal saying anyone was waiting on it — the gate read `no-record` and
// fell back to the manifest rule, which names the RIGHT problem ("no accepted
// review") but never told anyone a review was actually pending. `complete()`
// now appends `approval-requested` itself, right after `stage-completed`,
// with `origin: "policy"` (the runtime decided this needs a person, nobody
// asked it to) and unsigned (a request is never signed).
// ---------------------------------------------------------------------------
describe("ExecutionService.complete's review request", () => {
  it("writes approval-requested right after a reviewed stage completes", async () => {
    const { dir } = await completed("gated");
    const tail = (await journal(dir)).slice(-2).map((e) => e.type);
    expect(tail).toEqual(["stage-completed", "approval-requested"]);
    const req = (await journal(dir)).at(-1)!;
    expect((req.data as any).origin).toBe("policy");
    expect((req.data as any).binding.outputs[0].path).toBe("artifacts/gated.md");
  });

  it("writes no request for a stage that declares no review", async () => {
    const { dir } = await completed("upstream");
    expect((await journal(dir)).map((e) => e.type)).not.toContain("approval-requested");
  });

  // Fix round 1, Important finding: the request used to land AFTER
  // `sm.complete(instance)`, which releases the `stage:${stageId}` file lock.
  // `review()` takes that same lock and needs nothing more than
  // `status === "completed"` — true the moment `stage-completed` is on disk —
  // so a concurrent operator `review()` could acquire the lock in the gap,
  // append a signed `approval-granted`, and have this policy-authored request
  // land after it. `deriveGateState` governs by the LAST review event in
  // file order, so that buried a real approval under an unsigned request
  // nobody asked for. Pinned deterministically, not by timing: the mock
  // probes the lockfile itself, synchronously, at the instant `complete()`
  // asks to append `approval-requested` — if the probe can acquire the lock,
  // `complete()` had already released it too early.
  it("holds the stage lock while it writes the request, so a concurrent review cannot land first", async () => {
    journalMockState.probeLockOnRequest = true;
    const { dir } = await completed("gated");
    journalMockState.probeLockOnRequest = false;

    expect(journalMockState.probeAcquired).toBe(false);
    const types = (await journal(dir)).map((e) => e.type);
    expect(types.slice(-2)).toEqual(["stage-completed", "approval-requested"]);
  });

  it("a failed request write is reported in the reason, and the stage is still awaiting_review", async () => {
    const { root, dir } = await episode();
    const pipelines = await reviewChainPipeline(roots);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: pipelines,
      dispatcher: writer(dir), budget, review: permissive, operatorKey: KEY,
    });
    await svc.run(REF, "review-chain", { stage: "upstream" });

    journalMockState.dropReviewEvent = "approval-requested";
    const result = await svc.run(REF, "review-chain", { stage: "gated" });
    journalMockState.dropReviewEvent = null;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("awaiting_review");
    expect(result.value.reason).toMatch(/request .* could not be written/);

    const types = (await journal(dir)).map((e: any) => e.type);
    expect(types).not.toContain("approval-requested");
    expect(types.at(-1)).toBe("stage-completed");
  });
});
