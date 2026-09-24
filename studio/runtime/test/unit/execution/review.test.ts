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
}));

vi.mock("@studio/contracts/src/journal.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@studio/contracts/src/journal.mjs")>();
  return {
    ...actual,
    appendJournalEvent: async (episodeDir: string, input: any) => {
      if (input.type === journalMockState.dropReviewEvent) {
        return null;
      }
      return actual.appendJournalEvent(episodeDir, input);
    },
  };
});

afterEach(() => {
  journalMockState.dropReviewEvent = null;
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

describe("ExecutionService.review", () => {
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
    const rej = (await journal(dir)).at(-1)!;
    expect(rej.type).toBe("approval-rejected");
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
