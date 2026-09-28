// ---------------------------------------------------------------------------
// Attended claims (avg-qr4.3)
// ---------------------------------------------------------------------------
// `gates.autopilot: false` reserves a stage for a person. Task 7 gives the
// service a way to know one is at the controls: the operator principal,
// resolved from a credential Pi is never given. An agent is still refused;
// the operator may take the stage, and the lease says so.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionService } from "../../../src/execution/service.js";
import type { StageDispatcher } from "../../../src/execution/types.js";
import { parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { ok } from "../../../src/result.js";
import { reviewChainPipeline } from "./helpers/review-chain.js";

const REF = { channel: "childrens", series: "fairy-tales", episode: "ep" };

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function episode() {
  const root = await mkdtemp(join(tmpdir(), "attended-"));
  roots.push(root);
  const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
  await mkdir(join(dir, "artifacts"), { recursive: true });
  return { root, dir };
}

async function journal(dir: string) {
  return parseJournal(await readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8"));
}

const budget = { maySpend: async () => ok({ reserveId: "r", estimatedCost: 0 }) };

function writer(dir: string): StageDispatcher {
  return {
    dispatch: async (stage) => {
      const file = join(dir, "artifacts", `${stage.definition.id}.md`);
      await writeFile(file, "output");
      return [file];
    },
  };
}

/**
 * `attended` depends on `upstream` (see the review-chain helper), so every
 * case here has to clear that dependency first — otherwise the refusal
 * reported is the unmet dependency's, and the attendance gate this file
 * exercises is never reached.
 */
async function withUpstreamDone(svc: ExecutionService): Promise<void> {
  const done = await svc.run(REF, "review-chain", { stage: "upstream" });
  if (!done.ok || done.value.status !== "completed") {
    throw new Error(`setup failed: expected "upstream" to complete, got ${JSON.stringify(done)}`);
  }
}

describe("attended claims", () => {
  it("refuses an agent the stage that autopilot: false reserves for a person", async () => {
    const { root, dir } = await episode();
    const pipelines = await reviewChainPipeline(roots);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: pipelines, budget, dispatcher: writer(dir),
    });
    await withUpstreamDone(svc);

    const out = await svc.claim(REF, "review-chain", { stage: "attended" });

    expect(out.ok && out.value.status).toBe("blocked");
    expect(out.ok && out.value.reason).toMatch(/autopilot: false.*operator/);
  });

  it("lets the operator take it, and the journal says a person did", async () => {
    const { root, dir } = await episode();
    const pipelines = await reviewChainPipeline(roots);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: pipelines, budget, dispatcher: writer(dir),
    });
    await withUpstreamDone(svc);

    const out = await svc.claim(REF, "review-chain", { stage: "attended", principal: "operator" });

    expect(out.ok && out.value.status).toBe("claimed");
    const leased = (await journal(dir)).filter((e) => e.type === "stage-leased").at(-1)!;
    expect((leased.data as any).attended).toBe(true);
  });

  it("does not mark an agent's lease as attended", async () => {
    const { root, dir } = await episode();
    const pipelines = await reviewChainPipeline(roots);
    const svc = new ExecutionService({ libraryRoot: root, builtinPipelines: pipelines, budget });

    await svc.claim(REF, "review-chain", { stage: "upstream" });

    const leased = (await journal(dir)).filter((e) => e.type === "stage-leased").at(-1)!;
    expect((leased.data as any).attended).toBeUndefined();
  });

  it("run honours the principal the same way", async () => {
    const { root, dir } = await episode();
    const pipelines = await reviewChainPipeline(roots);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: pipelines, budget, dispatcher: writer(dir),
    });
    await withUpstreamDone(svc);

    const out = await svc.run(REF, "review-chain", { stage: "attended", principal: "operator" });

    expect(out.ok && out.value.status).toBe("completed");
  });
});
