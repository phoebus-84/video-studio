// ---------------------------------------------------------------------------
// A pipeline from brief to qa
// ---------------------------------------------------------------------------
// Nothing in this repository had ever run a pipeline to completion. Every
// slice tested its own layer against a fake: the CLI against a fake service,
// the gateway against a fake dispatcher, the agent against a fake gateway.
// This drives the real ExecutionService through ten stages — six claimed and
// performed out of process, four dispatched here — and then asks the journal
// it wrote whether it agrees with itself.
//
// What carries the weight is the shape of the history: one lease, one start
// and one terminal event per stage, one attempt each, every event of a stage
// naming the same lease, and thirty events in total. A journal read back from
// disk then has to derive exactly what `status()` reports, which pins that
// `status` infers nothing from files or from what this process remembers.
// ---------------------------------------------------------------------------

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

/** A budget guard that permits, because avg-91o means there is no ledger yet. */
const passThroughBudget = {
  maySpend: async () => ok({ reserveId: "e2e", estimatedCost: 0 }),
};

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

/** A library root with one empty episode in it, ready to write. */
async function newEpisode(prefix: string): Promise<{ root: string; dir: string }> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
  await mkdir(join(dir, "journal"), { recursive: true });
  await mkdir(join(dir, "artifacts"), { recursive: true });
  return { root, dir };
}

/**
 * The dependency graph of the shipped `narrated-illustrated-video` manifest,
 * stage for stage and edge for edge, in its declaration order.
 *
 * Copied deliberately rather than paraphrased: the point of the fixture is
 * that the ORDER this test asserts is the order the real graph produces.
 */
const GRAPH: [id: string, dependsOn: string[]][] = [
  ["brief", []],
  ["script", ["brief"]],
  ["art-direction", ["script"]],
  ["terminal-recordings", ["art-direction"]],
  ["illustrations", ["art-direction"]],
  ["narration", ["script"]],
  ["captions", ["narration"]],
  ["timing", ["script", "narration"]],
  ["compose", ["illustrations", "terminal-recordings", "narration", "captions", "timing"]],
  ["qa", ["compose"]],
];

/**
 * The shipped pipeline's graph, with every gate open.
 *
 * Two gates in the real manifest make an end-to-end assertion impossible, and
 * both are the same missing concept:
 *
 * - `script` and `compose` declare `autopilot: false`. The service has no way
 *   to express that a person is at the controls, so the only honest answer it
 *   can give is to refuse. That refusal is asserted against the real manifest
 *   in the second test below.
 * - `script`, `terminal-recordings`, `illustrations`, `compose` and `qa` —
 *   five stages — declare `review: human`. With no accepted review
 *   recordable, every dependent of one of them is refused too. `script` is
 *   the first, so lifting autopilot alone would not carry the shipped
 *   manifest further: it would complete `brief`, return `awaiting_review`
 *   for `script`, and stop one stage later at `art-direction`, on `script`'s
 *   unrecorded review. The review wall stands immediately behind the
 *   attendance one, not eight stages downstream.
 *
 * Both wait on avg-qr4.3, which is what attendance and approval mean. The
 * fixture keeps the graph and opens the gates; nothing else differs.
 */
async function runnablePipeline(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "e2e-pipeline-"));
  roots.push(dir);
  const stage = (id: string, dependsOn: string[]) => [
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
    `        review: none`,
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
    ...GRAPH.map(([id, deps]) => stage(id, deps)),
  ].join("\n"));
  return dir;
}

/** The four stages the gateway has handlers for, and no others. */
function handlerDispatcher(): StageDispatcher {
  const handled = new Set(["illustrations", "captions", "timing", "qa"]);
  return {
    canDispatch: (stage) => handled.has(stage.definition.id),
    dispatch: async (stage, ctx) => {
      const rel = `artifacts/${stage.definition.id}.md`;
      await mkdir(dirname(join(ctx.episodeDir, rel)), { recursive: true });
      await writeFile(join(ctx.episodeDir, rel), `${stage.definition.id} by handler`);
      return [rel];
    },
  };
}

describe("a pipeline from brief to qa", () => {
  it("runs to completion, alternating claimed stages with dispatched ones", async () => {
    const { root, dir } = await newEpisode("e2e-");
    const pipelineDir = await runnablePipeline();
    const svc = new ExecutionService({
      libraryRoot: root,
      builtinPipelines: pipelineDir,
      budget: passThroughBudget,
      dispatcher: handlerDispatcher(),
      holder: "e2e-test",
    });

    const order: string[] = [];
    for (let i = 0; i < 20; i++) {
      // A dispatcher-backed stage runs here and now.
      const ran = await svc.run(REF, "e2e");
      expect(ran.ok, JSON.stringify(ran)).toBe(true);
      if (!ran.ok) return;
      if (ran.value.status === "idle") break;
      if (ran.value.status === "completed") {
        order.push(`ran:${ran.value.stageId}`);
        continue;
      }

      // Anything else is a stage this process cannot perform. Claim it, do
      // the work the way a performer would, and close the claim.
      expect(ran.value.status, ran.value.stageId ?? "?").toBe("blocked");
      expect(ran.value.reason).toMatch(/does not handle/);
      const stageId = ran.value.stageId!;

      const claimed = await svc.claim(REF, "e2e", { stage: stageId });
      expect(claimed.ok).toBe(true);
      if (!claimed.ok) return;
      // The refusal, not just the status: this is the assertion a broken
      // seam trips first, and the service's own sentence explains it better
      // than "expected 'blocked' to be 'claimed'" can.
      expect(claimed.value.status, claimed.value.reason).toBe("claimed");
      expect(claimed.value.attemptNumber).toBe(1);
      expect(claimed.value.leaseId).toBeTruthy();

      const rel = `artifacts/${stageId}.md`;
      await writeFile(join(dir, rel), `${stageId} by hand`);
      // Closed by lease id, from a caller that only knows what `claim`
      // returned — the out-of-process performer's whole contract.
      const done = await svc.complete(REF, "e2e", stageId, {
        outputs: [rel],
        leaseId: claimed.value.leaseId,
      });
      expect(done.ok).toBe(true);
      if (!done.ok) return;
      expect(done.value.status, done.value.reason).toBe("completed");
      order.push(`claimed:${stageId}`);
    }

    // Kahn's algorithm over the graph above, seeded in declaration order:
    // `narration` (in-degree 0 the moment `script` completes) is dequeued
    // before `art-direction`'s children, so it precedes `terminal-recordings`
    // here even though it is declared after it. The service selects the first
    // stage in TOPOLOGICAL order whose dependencies are met, not the first in
    // declaration order — `resolvePipeline` sorts before the service ever
    // sees the stages.
    expect(order).toEqual([
      "claimed:brief",
      "claimed:script",
      "claimed:art-direction",
      "claimed:narration",
      "claimed:terminal-recordings",
      "ran:illustrations",
      "ran:captions",
      "ran:timing",
      "claimed:compose",
      "ran:qa",
    ]);
    // Ten stages, ten entries: no stage ran twice, and the loop did not run
    // out of iterations part-way through.
    expect(new Set(order).size).toBe(10);

    // ── The journal agrees with itself ──────────────────────────────────
    // Read by a service that shares nothing with the one that wrote it: state
    // comes from replaying the journal, never from what this process happens
    // to remember or from which files exist.
    const reader = new ExecutionService({
      libraryRoot: root,
      builtinPipelines: pipelineDir,
      budget: passThroughBudget,
    });
    const status = await reader.status(REF, "e2e");
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.value.stages.map((s) => s.state)).toEqual(Array(10).fill("completed"));
    expect(status.value.stages.every((s) => s.lease.state === "none")).toBe(true);

    const events = parseJournal(await readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8"), { strict: true });
    const stageIds = status.value.stages.map((s) => s.stageId);
    const derived = deriveExecutionState(events, stageIds, new Date());

    for (const [stageId, instance] of derived) {
      expect(instance.status, stageId).toBe("completed");
      expect(instance.attempts.length, stageId).toBe(1);
      expect(instance.attempts[0]!.outcome, stageId).toBe("success");
      expect(instance.attempts[0]!.number, stageId).toBe(1);
      expect(instance.attempts[0]!.holder, stageId).toBe("e2e-test");
      expect(instance.outputArtifacts, stageId).toEqual([`artifacts/${stageId}.md`]);
    }

    // One lease per stage, one start per stage, one terminal event per stage,
    // and nothing else: a retry, a lapse or a double-claim would show here.
    const counts = new Map<string, number>();
    for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    expect(counts.get("stage-leased")).toBe(10);
    expect(counts.get("stage-started")).toBe(10);
    expect(counts.get("stage-completed")).toBe(10);
    expect(counts.get("stage-failed")).toBeUndefined();
    expect(events.length).toBe(30);

    // Every event of a stage carries that stage's single lease id and attempt
    // number, and no two stages share a lease. `claim`/`complete` split across
    // two calls and `run`'s single call must produce the same three lines.
    const leases = new Map<string, string>();
    for (const e of events) {
      const data = e.data as { stageId: string; leaseId: string; attemptNumber: number };
      expect(data.attemptNumber, `${e.type} ${data.stageId}`).toBe(1);
      const seen = leases.get(data.stageId);
      if (seen === undefined) leases.set(data.stageId, data.leaseId);
      else expect(data.leaseId, `${e.type} ${data.stageId}`).toBe(seen);
    }
    expect(new Set(leases.values()).size).toBe(10);

    // ── Replay reproduces the final state ───────────────────────────────
    // A reader holding nothing but the journal bytes arrives at exactly what
    // the service reports. Both sides call `deriveExecutionState`, so this
    // cannot catch a bug inside the derivation itself — what it establishes
    // is that `status` adds nothing of its own on top of it: no state carried
    // in the process that ran the stages, nothing inferred from which files
    // happen to exist, and a journal that parses under `strict`. The attempt,
    // holder, lease and output assertions above are what check the history
    // the seam actually wrote.
    expect(
      stageIds.map((id) => {
        const i = derived.get(id)!;
        return { stageId: id, status: i.status, attempts: i.attempts.length, outputArtifacts: i.outputArtifacts };
      }),
    ).toEqual(
      status.value.stages.map((s) => ({
        stageId: s.stageId,
        status: s.status,
        attempts: s.attempts,
        outputArtifacts: s.outputArtifacts,
      })),
    );
  });

  it("stops the shipped pipeline at script, and says why", async () => {
    // The one thing standing between this machinery and the real manifest.
    const { root, dir } = await newEpisode("e2e-real-");
    const svc = new ExecutionService({
      libraryRoot: root,
      builtinPipelines: REAL_PIPELINES,
      budget: passThroughBudget,
      holder: "e2e-test",
    });

    // `brief` is the only stage the shipped manifest lets through unattended:
    // it declares `autopilot: true` and `review: none`, and `script` — its
    // only dependent — therefore reaches the attendance gate rather than
    // stopping on an unmet dependency or an unrecorded review.
    const first = await svc.claim(REF, "narrated-illustrated-video");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.stageId).toBe("brief");
    expect(first.value.status).toBe("claimed");

    await writeFile(join(dir, "artifacts/brief.md"), "a brief");
    const done = await svc.complete(REF, "narrated-illustrated-video", "brief", {
      outputs: ["artifacts/brief.md"],
      leaseId: first.value.leaseId,
    });
    expect(done.ok && done.value.status).toBe("completed");

    const next = await svc.claim(REF, "narrated-illustrated-video");
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.value.stageId).toBe("script");
    expect(next.value.status).toBe("blocked");
    expect(next.value.reason).toMatch(/autopilot: false/);

    // And `status` says the same sentence about the same stage, so a caller
    // polling the read path is not told a stage is ready that a claim refuses.
    const status = await svc.status(REF, "narrated-illustrated-video");
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    const script = status.value.stages.find((s) => s.stageId === "script")!;
    expect(script.state).toBe("blocked");
    expect(script.stateReason).toBe(next.value.reason);
  });
});
