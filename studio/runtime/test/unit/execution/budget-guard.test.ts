// ---------------------------------------------------------------------------
// The budget guard on the journal's spend ledger (avg-91o)
// ---------------------------------------------------------------------------
// The guard used to be `{ maySpend: async () => ok(...) }` in both the CLI and
// the gateway. These pin what replaced it: a stage that declares a paid
// capability is refused once the episode's budget is used up, every other
// stage passes, and `status` and a claim say the same sentence about it.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ExecutionService } from "../../../src/execution/service.js";
import { JournalBudgetGuard, readEpisodeBudget } from "../../../src/execution/budget.js";
import { JournalReviewGate } from "../../../src/execution/journal-review-gate.js";
import { appendJournalEvent, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { reserveSpend, settleSpend } from "@studio/contracts/src/budget.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINES = resolve(__dirname, "../../../../pipelines/pipelines");
const PIPELINE = "narrated-illustrated-video";
const REF = { channel: "childrens", series: "fairy-tales", episode: "ep" };
const USD = (micros: number) => ({ currency: "USD", micros });

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function episode(budget?: { limitMicros: number }) {
  const root = await mkdtemp(join(tmpdir(), "exec-budget-"));
  roots.push(root);
  const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
  await mkdir(join(dir, "journal"), { recursive: true });
  if (budget) {
    await writeFile(join(root, REF.channel, "series", REF.series, "settings.yaml"),
      `budget:\n  currency: USD\n  limitMicros: ${budget.limitMicros}\n`);
  }
  let n = 0;
  for (const stageId of ["brief", "script", "art-direction"]) {
    const leaseId = `seed-${n++}`;
    const common = { episode: REF, actor: "runtime" as const };
    await appendJournalEvent(dir, { type: "stage-leased", ...common, data: {
      stageId, leaseId, attemptNumber: 1, ttlMs: 60_000, expiresAt: new Date(Date.now() + 60_000).toISOString(), holder: "seed",
    } });
    await appendJournalEvent(dir, { type: "stage-started", ...common, data: { stageId, leaseId, attemptNumber: 1 } });
    await appendJournalEvent(dir, { type: "stage-completed", ...common, data: { stageId, leaseId, attemptNumber: 1, outputs: [] } });
  }
  const service = new ExecutionService({
    libraryRoot: root, builtinPipelines: PIPELINES,
    budget: new JournalBudgetGuard(root), review: new JournalReviewGate(null),
  });
  return { root, dir, service };
}

/** Spend `micros` the way a paid tool does: reserve, then settle. */
async function spend(dir: string, micros: number) {
  const reserved = await reserveSpend(dir, {
    episode: REF, capability: "image.generate", provider: "fal", estimate: USD(micros),
  });
  if (!reserved.ok) throw new Error(reserved.reason);
  await settleSpend(dir, { episode: REF, reserveId: reserved.reserveId, cost: USD(micros), basis: "estimate" });
}

async function stateOf(service: ExecutionService, stageId: string) {
  const status = await service.status(REF, PIPELINE);
  if (!status.ok) throw new Error(status.error.message);
  return status.value.stages.find((s) => s.stageId === stageId)!;
}

describe("JournalBudgetGuard", () => {
  it("lets a paid stage start while the budget has room", async () => {
    const { dir, service } = await episode({ limitMicros: 1_000_000 });
    await spend(dir, 400_000);
    expect((await stateOf(service, "illustrations")).state).toBe("runnable");
    const claim = await service.claim(REF, PIPELINE, { stage: "illustrations" });
    expect(claim.ok && claim.value.status).toBe("claimed");
  });

  it("refuses a paid stage once the budget is used up, in status and in a claim alike", async () => {
    const { dir, service } = await episode({ limitMicros: 1_000_000 });
    await spend(dir, 1_000_000);

    const report = await stateOf(service, "illustrations");
    expect(report.state).toBe("blocked");
    expect(report.stateReason).toMatch(/budget refused "illustrations": the episode's \$1\.00 budget is used up/);
    expect(report.stateReason).toMatch(/series\/settings\.yaml/);

    const claim = await service.claim(REF, PIPELINE, { stage: "illustrations" });
    expect(claim.ok && claim.value.status).toBe("blocked");
    expect(claim.ok && claim.value.reason).toBe(report.stateReason);
  });

  it("counts an open reservation, and says it can be released", async () => {
    const { dir, service } = await episode({ limitMicros: 500_000 });
    const reserved = await reserveSpend(dir, {
      episode: REF, capability: "image.generate", provider: "fal", estimate: USD(500_000),
    });
    expect(reserved.ok).toBe(true);
    expect((await stateOf(service, "illustrations")).stateReason).toMatch(/\$0\.50 reserved.*release a reservation/);
  });

  it("never refuses a stage that spends nothing", async () => {
    const { dir, service } = await episode({ limitMicros: 100 });
    await spend(dir, 100);
    const guard = new JournalBudgetGuard(dirname(dirname(dirname(dirname(dirname(dir))))));
    const free = { definition: { id: "timing", capabilities: [] } } as never;
    const verdict = await guard.maySpend(free, { episodeDir: dir, ref: REF, attemptNumber: 1, log: () => {} });
    expect(verdict.ok).toBe(true);
    expect((await stateOf(service, "illustrations")).state).toBe("blocked");
  });

  it("does not cap an episode no settings.yaml gives a budget", async () => {
    const { dir, service } = await episode();
    await spend(dir, 50_000_000);
    expect((await stateOf(service, "illustrations")).state).toBe("runnable");
    const budget = await readEpisodeBudget(dirname(dirname(dirname(dirname(dirname(dir))))), REF);
    expect(budget.limitMicros).toBeNull();
    expect(budget.spentMicros).toBe(50_000_000);
  });

  it("refuses a paid stage when the ledger cannot be read", async () => {
    const { dir, service } = await episode({ limitMicros: 1_000_000 });
    await writeFile(join(dir, JOURNAL_RELATIVE_PATH), "{broken\n", { flag: "a" });
    const status = await service.status(REF, PIPELINE);
    // The journal is the execution state too, so status refuses outright —
    // either way, nothing paid starts on a ledger nobody can read.
    if (status.ok) {
      expect(status.value.stages.find((s) => s.stageId === "illustrations")!.state).toBe("blocked");
    } else {
      expect(status.error.code).toMatch(/JOURNAL|REPLAY/);
    }
  });
});
