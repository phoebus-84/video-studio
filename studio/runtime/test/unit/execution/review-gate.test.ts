import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ExecutionService } from "../../../src/execution/service.js";
import type { ReviewGate, ReviewGateState, StageDispatcher } from "../../../src/execution/types.js";
import { ok } from "../../../src/result.js";
import { reviewChainPipeline } from "./helpers/review-chain.js";

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
/** Every stage is accepted, as far as this gate is concerned. */
const permissive: ReviewGate = { isOutstanding: async () => ({ state: "approved" }) };

/** A gate that holds nothing at all — the state a fresh episode is in. */
const knowsNothing: ReviewGate = { isOutstanding: async () => ({ state: "no-record" }) };

/** A gate that answers `state` for `stageId` and knows nothing else. */
function gateFor(stageId: string, state: ReviewGateState, reason?: string): ReviewGate {
  return {
    isOutstanding: async (id) =>
      id === stageId ? { state, reason } : { state: "no-record" },
  };
}

describe("a stage that needs acceptance", () => {
  it("reports awaiting_review rather than completed", async () => {
    // `gated` declares review: human. Under avg-qr4.1 such a stage never
    // reads as completed, because completed is what dependents test.
    const { root, dir } = await episode();
    const pipelines = await reviewChainPipeline(roots);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: pipelines,
      dispatcher: writer(dir), budget, review: permissive,
    });

    await svc.run(REF, "review-chain", { stage: "upstream" });
    const result = await svc.run(REF, "review-chain", { stage: "gated" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("awaiting_review");
  });

  it("still records stage-completed, because it did run", async () => {
    // Completion is what happened; acceptance is whether it counts. The
    // journal records the first and must not be bent to express the second.
    const { root, dir } = await episode();
    const pipelines = await reviewChainPipeline(roots);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: pipelines,
      dispatcher: writer(dir), budget, review: permissive,
    });

    await svc.run(REF, "review-chain", { stage: "upstream" });
    await svc.run(REF, "review-chain", { stage: "gated" });

    const status = await svc.status(REF, "review-chain");
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.value.stages.find((s) => s.stageId === "gated")!.status).toBe("completed");
  });
});

// The gate answers one of three things, and each has its own consequence.
// While it answered a boolean, "approved" and "no record" were the same
// answer — which is how an injected gate came to be WEAKER than no gate at
// all: the service treated the gate as authoritative and skipped the manifest
// rule below, so a stage nobody had ever reviewed read as accepted.
describe("the review gate on dependencies", () => {
  it("outstanding: blocks, and names the gate's reason", async () => {
    const { root, dir } = await episode();
    const pipelines = await reviewChainPipeline(roots);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: pipelines, dispatcher: writer(dir), budget,
      review: gateFor("upstream", "outstanding", "awaiting review"),
    });

    await svc.run(REF, "review-chain", { stage: "upstream" });
    const result = await svc.run(REF, "review-chain", { stage: "gated" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/upstream/);
    expect(result.value.reason).toMatch(/awaiting review/);
  });

  it("approved: satisfies the dependency, even one the manifest gates", async () => {
    // `downstream` depends on `gated`, which declares review: human. A current
    // record beats the manifest's default — that is what a gate is for.
    const { root, dir } = await episode();
    const pipelines = await reviewChainPipeline(roots);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: pipelines, dispatcher: writer(dir), budget,
      review: gateFor("gated", "approved"),
    });

    await svc.run(REF, "review-chain", { stage: "upstream" });
    await svc.run(REF, "review-chain", { stage: "gated" });
    const result = await svc.run(REF, "review-chain", { stage: "downstream" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("completed");
  });

  it("no record: falls through to the manifest, which refuses a gated dependency", async () => {
    const { root, dir } = await episode();
    const pipelines = await reviewChainPipeline(roots);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: pipelines, dispatcher: writer(dir), budget,
      review: knowsNothing,
    });

    await svc.run(REF, "review-chain", { stage: "upstream" });
    await svc.run(REF, "review-chain", { stage: "gated" });
    const result = await svc.run(REF, "review-chain", { stage: "downstream" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/gated/);
    expect(result.value.reason).toMatch(/no accepted review is recorded/);
  });

  it("no record: proceeds where the manifest declares no review", async () => {
    // Silence is not refusal either. `upstream` declares review: none, so
    // nothing needs a record and `gated` runs.
    const { root, dir } = await episode();
    const pipelines = await reviewChainPipeline(roots);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: pipelines, dispatcher: writer(dir), budget,
      review: knowsNothing,
    });

    await svc.run(REF, "review-chain", { stage: "upstream" });
    const result = await svc.run(REF, "review-chain", { stage: "gated" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // `gated` itself declares review: human, so it awaits rather than completes.
    expect(result.value.status).toBe("awaiting_review");
  });

  it("an injected gate is never weaker than no gate at all", async () => {
    // The property the tri-state exists for. A gate that knows nothing must
    // refuse exactly where a service with no gate refuses — the regression was
    // that injecting one turned that refusal off.
    const uninjected = await episode();
    const injected = await episode();
    const pipelines = await reviewChainPipeline(roots);

    async function upTo(root: string, dir: string, review?: ReviewGate) {
      const svc = new ExecutionService({
        libraryRoot: root, builtinPipelines: pipelines, dispatcher: writer(dir), budget, review,
      });
      await svc.run(REF, "review-chain", { stage: "upstream" });
      await svc.run(REF, "review-chain", { stage: "gated" });
      return svc.run(REF, "review-chain", { stage: "downstream" });
    }

    const withoutGate = await upTo(uninjected.root, uninjected.dir);
    const withGate = await upTo(injected.root, injected.dir, knowsNothing);

    expect(withoutGate.ok && withGate.ok).toBe(true);
    if (!withoutGate.ok || !withGate.ok) return;
    expect(withoutGate.value.status).toBe("blocked");
    expect(withGate.value.status).toBe(withoutGate.value.status);
    expect(withGate.value.reason).toBe(withoutGate.value.reason);
  });
});

describe("an absent review gate", () => {
  it("refuses when a stage in the dependency chain declares a review", async () => {
    // The service cannot know whether a required review happened, so it does
    // not guess. Absence is refusal exactly where something is protected —
    // here, two levels down: `downstream` depends on `gated`, which declares
    // review: human, and no gate is configured to say whether it was ever
    // accepted.
    const { root, dir } = await episode();
    const pipelines = await reviewChainPipeline(roots);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: pipelines, dispatcher: writer(dir), budget,
    });

    await svc.run(REF, "review-chain", { stage: "upstream" });
    await svc.run(REF, "review-chain", { stage: "gated" });
    const result = await svc.run(REF, "review-chain", { stage: "downstream" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/review/i);
  });

  it("proceeds when nothing in the chain declares a review", async () => {
    // brief declares review: none, so no gate is needed to run it. This is
    // the one test in this file kept against the real
    // narrated-illustrated-video manifest, so real-manifest wiring is still
    // proven end to end.
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
    const pipelines = await reviewChainPipeline(roots);
    const dispatcher: StageDispatcher = {
      ...writer(dir),
      canDispatch: (stage) => stage.definition.id !== "upstream",
    };
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: pipelines, dispatcher, budget, review: permissive,
    });

    const result = await svc.run(REF, "review-chain", { stage: "upstream" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/does not handle/i);
  });

  it("dispatches normally when canDispatch is absent", async () => {
    const { root, dir } = await episode();
    const pipelines = await reviewChainPipeline(roots);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: pipelines,
      dispatcher: writer(dir), budget, review: permissive,
    });

    const result = await svc.run(REF, "review-chain", { stage: "upstream" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("completed");
  });
});
