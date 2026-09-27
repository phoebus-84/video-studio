// ---------------------------------------------------------------------------
// Staleness is computed, recorded and reported (avg-qr4.3, absorbing avg-33r's
// third).
// ---------------------------------------------------------------------------
// The journal stays the only store: a decision that outruns a downstream
// stage writes a `staleness-marked` event naming what it affected, and
// `status()` reads that event back against each stage's own history to decide
// whether it still counts as `completed`. This is reporting, not a second
// gate — `JournalReviewGate`'s hash comparison still decides whether an
// approval stands; staleness only explains why a stage that IS accepted
// might no longer reflect what it depends on.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionService } from "../../../src/execution/service.js";
import type { ReviewGate, StageDispatcher } from "../../../src/execution/types.js";
import { parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { ok } from "../../../src/result.js";
import { reviewChainPipeline } from "./helpers/review-chain.js";

const REF = { channel: "childrens", series: "fairy-tales", episode: "ep" };
const KEY = "operator-key-for-staleness-tests";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function episode() {
  const root = await mkdtemp(join(tmpdir(), "exec-staleness-"));
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
/** Every dependency is accepted, as far as this gate is concerned — the same
 * fake review.test.ts uses, so a dependent can run before the operator's own
 * signed grant lands, and the test controls exactly when that grant happens. */
const permissive: ReviewGate = { isOutstanding: async () => ({ state: "approved" as const }) };

async function journal(dir: string) {
  return parseJournal(await readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8"), { strict: true });
}

/** upstream -> gated (run only, not yet reviewed) -> downstream, all completed. */
async function chainThroughDownstream(operatorKey: string | null = KEY) {
  const { root, dir } = await episode();
  const pipelines = await reviewChainPipeline(roots);
  const svc = new ExecutionService({
    libraryRoot: root, builtinPipelines: pipelines,
    dispatcher: writer(dir), budget, review: permissive, operatorKey,
  });
  await svc.run(REF, "review-chain", { stage: "upstream" });
  await svc.run(REF, "review-chain", { stage: "gated" });
  await svc.run(REF, "review-chain", { stage: "downstream" });
  return { svc, dir };
}

describe("a decision on a stage marks its dependents stale", () => {
  it("a grant marks every stage downstream of it stale", async () => {
    // downstream completed BEFORE the grant — this is what makes it stale
    // once the grant lands, not merely unreviewed.
    const { svc, dir } = await chainThroughDownstream();

    const out = await svc.review(REF, "review-chain", "gated", { decision: "approved", principal: "operator" });
    expect(out.ok && out.value.status).toBe("approved");

    const marked = (await journal(dir)).filter((e) => e.type === "staleness-marked").at(-1)!;
    expect((marked.data as any).trigger).toBe("gated");
    expect((marked.data as any).affected.map((a: any) => a.stageId)).toContain("downstream");

    const st = await svc.status(REF, "review-chain");
    expect(st.ok && st.value.stages.find((s) => s.stageId === "downstream")!.state).toBe("stale");
  });

  it("re-running the stale stage clears it", async () => {
    const { svc } = await chainThroughDownstream();
    await svc.review(REF, "review-chain", "gated", { decision: "approved", principal: "operator" });

    await svc.run(REF, "review-chain", { stage: "downstream" });

    const st = await svc.status(REF, "review-chain");
    expect(st.ok && st.value.stages.find((s) => s.stageId === "downstream")!.state).toBe("completed");
  });

  it("a rejection marks dependents stale too", async () => {
    const { svc, dir } = await chainThroughDownstream();

    const out = await svc.review(
      REF, "review-chain", "gated", { decision: "rejected", principal: "operator", note: "redo the framing" },
    );
    expect(out.ok && out.value.status).toBe("rejected");

    const marked = (await journal(dir)).filter((e) => e.type === "staleness-marked").at(-1)!;
    expect((marked.data as any).trigger).toBe("gated");
    expect((marked.data as any).affected.map((a: any) => a.stageId)).toContain("downstream");

    const st = await svc.status(REF, "review-chain");
    expect(st.ok && st.value.stages.find((s) => s.stageId === "downstream")!.state).toBe("stale");
  });

  it("re-completing an approved stage marks its dependents stale", async () => {
    const { root, dir } = await episode();
    const pipelines = await reviewChainPipeline(roots);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: pipelines,
      dispatcher: writer(dir), budget, review: permissive, operatorKey: KEY,
    });
    await svc.run(REF, "review-chain", { stage: "upstream" });
    await svc.run(REF, "review-chain", { stage: "gated" });
    await svc.review(REF, "review-chain", "gated", { decision: "approved", principal: "operator" });
    // downstream runs AFTER the grant, so it starts out genuinely accepted.
    await svc.run(REF, "review-chain", { stage: "downstream" });

    const before = await svc.status(REF, "review-chain");
    expect(before.ok && before.value.stages.find((s) => s.stageId === "downstream")!.state).toBe("completed");

    // Re-completing "gated" — already approved — is what re-triggers staleness.
    await svc.run(REF, "review-chain", { stage: "gated" });

    const after = await svc.status(REF, "review-chain");
    expect(after.ok && after.value.stages.find((s) => s.stageId === "downstream")!.state).toBe("stale");
  });

  it("a pending stage is never reported stale: it has nothing to be stale about", async () => {
    // The stale check only applies inside the `completed` branch of
    // `status()`; a stage the journal has never recorded as completed must
    // not be dragged into it just because a `staleness-marked` event names it.
    const { root, dir } = await episode();
    const pipelines = await reviewChainPipeline(roots);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: pipelines,
      dispatcher: writer(dir), budget, review: permissive, operatorKey: KEY,
    });
    await svc.run(REF, "review-chain", { stage: "upstream" });
    await svc.run(REF, "review-chain", { stage: "gated" });
    // "downstream" never runs.
    await svc.review(REF, "review-chain", "gated", { decision: "approved", principal: "operator" });

    const st = await svc.status(REF, "review-chain");
    const downstream = st.ok && st.value.stages.find((s) => s.stageId === "downstream")!;
    expect(downstream && downstream.status).toBe("pending");
    expect(downstream && downstream.state).not.toBe("stale");
  });

  it("writes no event when nothing is downstream", async () => {
    const { root, dir } = await episode();
    const pipelines = await reviewChainPipeline(roots);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: pipelines,
      dispatcher: writer(dir), budget, review: permissive, operatorKey: KEY,
    });
    await svc.run(REF, "review-chain", { stage: "upstream" });
    // "skilled" is a leaf: nothing declares it as a dependency.
    await svc.run(REF, "review-chain", { stage: "skilled" });

    const out = await svc.review(REF, "review-chain", "skilled", { decision: "approved", principal: "agent" });
    expect(out.ok && out.value.status).toBe("approved");

    const types = (await journal(dir)).map((e) => e.type);
    expect(types).not.toContain("staleness-marked");
  });
});

describe("planRerun(\"rerun-affected-downstream\")", () => {
  it("plans the stale set given the stages that changed", async () => {
    const { root } = await episode();
    const pipelines = await reviewChainPipeline(roots);
    const svc = new ExecutionService({ libraryRoot: root, builtinPipelines: pipelines });

    const plan = await svc.planRerun(REF, "review-chain", "rerun-affected-downstream", ["gated"]);

    expect(plan.ok).toBe(true);
  });
});
