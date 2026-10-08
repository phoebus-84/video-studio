import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionService } from "../../../src/execution/service.js";
import type { StageEvidence } from "../../../src/execution/types.js";
import { ok } from "../../../src/result.js";
import { reviewChainPipeline } from "./helpers/review-chain.js";

/**
 * An episode whose stages follow its files (avg-qwc): status reads them from
 * the injected evidence. Other episodes, and claims, keep the journal.
 */

const REF = { channel: "dentro-i-versi", series: "short", episode: "san-martino" };
const OTHER = { channel: "dentro-i-versi", series: "short", episode: "explainer" };
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function setup(evidence?: StageEvidence) {
  const root = await mkdtemp(join(tmpdir(), "exec-evidence-"));
  roots.push(root);
  for (const ref of [REF, OTHER]) await mkdir(join(root, ref.channel, "series", ref.series, "episodes", ref.episode), { recursive: true });
  const svc = new ExecutionService({
    libraryRoot: root,
    builtinPipelines: await reviewChainPipeline(roots),
    budget: { maySpend: async () => ok({ reserveId: "r", estimatedCost: 0 }) },
    operatorKey: "test-operator-key",
    ...(evidence ? { stageEvidence: evidence } : {}),
  });
  return { root, svc };
}

/** The episode REF follows its files: upstream done, gated awaiting the operator, the rest not said. */
const evidence: StageEvidence = {
  appliesTo: ({ ref, stageIds }) => ref.episode === REF.episode && stageIds.includes("upstream"),
  stages: async ({ operatorKey }) => ({
    upstream: { state: "completed", reason: `made (key ${operatorKey ? "held" : "absent"})` },
    gated: { state: "awaiting_review", reason: "the operator reads it" },
  }),
};

describe("an episode whose stages follow its files", () => {
  it("reports each stage as its files stand, with the operator key passed on", async () => {
    const { svc } = await setup(evidence);
    const status = await svc.status(REF, "review-chain");
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.value.source).toBe("files");
    const by = Object.fromEntries(status.value.stages.map((s) => [s.stageId, s]));
    expect(by.upstream).toMatchObject({ state: "completed", status: "completed", stateReason: "made (key held)", dependenciesMet: true });
    expect(by.gated).toMatchObject({ state: "awaiting_review", status: "completed", stateReason: "the operator reads it" });
    expect(by.downstream).toMatchObject({ state: "pending", status: "pending", dependenciesMet: false, stateReason: "the episode's files say nothing about this stage" });
  });

  it("leaves other episodes, and a service without evidence, on the journal", async () => {
    const { svc } = await setup(evidence);
    const other = await svc.status(OTHER, "review-chain");
    expect(other.ok && other.value.source).toBeUndefined();
    expect(other.ok && other.value.stages.find((s) => s.stageId === "upstream")!.state).toBe("runnable");
    const plain = (await setup()).svc;
    const status = await plain.status(REF, "review-chain");
    expect(status.ok && status.value.stages.find((s) => s.stageId === "upstream")!.state).toBe("runnable");
  });

  it("says the files cannot be read rather than guessing", async () => {
    const { svc } = await setup({ appliesTo: () => true, stages: async () => { throw new Error("bad spec"); } });
    const status = await svc.status(REF, "review-chain");
    expect(!status.ok && status.error.code).toBe("EVIDENCE_UNREADABLE");
  });
});
