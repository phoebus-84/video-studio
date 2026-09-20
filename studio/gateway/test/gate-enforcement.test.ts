// ── Gate enforcement ────────────────────────────────────────────────────────
//
// These tests were bought by avg-qr4.1, which deleted two handlers that
// fabricated their findings and made the gateway honour the gates its
// manifests declare. They used to drive `runAutopilot` with a fake runtime
// that fed it a stage sequence. The gateway no longer owns that loop, so they
// now drive the composition that replaced it: @studio/runtime's
// ExecutionService with the gateway's own dispatcher and review gate.
//
// Two things changed wording rather than substance: `awaiting_approval` is
// now `awaiting_review`, and `ExecutionReport.stages[].status` is now
// `StageOutcome.status`.
//
// Three properties could NOT be carried across, and are marked in place
// rather than quietly dropped — see the `it.fails` tests below and
// .superpowers/sdd/2026-09-20-gateway-as-transport/task-4-report.md.

import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ExecutionService } from "@studio/runtime";
import type { StageDispatcher } from "@studio/runtime";
import { GatewayDispatcher } from "../src/runtime/dispatcher.js";
import { GatewayReviewGate } from "../src/runtime/review-gate.js";
import { registerProductionRoutes } from "../src/routes/production.js";
import type { RuntimeClient } from "../src/runtime/client.js";
import type { WorkspaceService } from "../src/workspace/service.js";
import { appendJournalEvent, parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { buildGateReview, hashArtifacts } from "@studio/contracts/src/gate-review.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINES = resolve(__dirname, "../../pipelines/pipelines");

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.unstubAllEnvs();
});

const REF = { channel: "childrens", series: "fairy-tales", episode: "the-run-up" };

async function episode() {
  const root = await mkdtemp(join(tmpdir(), "gw-gates-"));
  roots.push(root);
  const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
  await mkdir(join(dir, "artifacts"), { recursive: true });
  await mkdir(join(dir, "assets", "images"), { recursive: true });
  return { root, dir };
}

/** The gateway's real composition, with a permissive budget. */
function gatewayService(
  root: string,
  over?: Partial<ConstructorParameters<typeof ExecutionService>[0]>,
) {
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

/**
 * Record a stage as having completed, the way a real run would.
 *
 * The old fake runtime chose which stage ran by offering it. The service
 * chooses for itself, from the pipeline and the journal, and a stage whose
 * dependencies have not completed is blocked before any gate is reached — so
 * a test that wants to exercise a gate deep in the chain has to put the
 * history there. Three events, because replay identifies an attempt by its
 * lease: a terminal event with no lease cannot be placed in the history.
 */
let seedCounter = 0;
async function seedCompleted(dir: string, stageId: string, outputs: string[] = []) {
  const leaseId = `seeded-${stageId}-${seedCounter++}`;
  const common = { episode: REF, actor: "runtime" as const };
  await appendJournalEvent(dir, {
    type: "stage-leased", ...common,
    data: {
      stageId, leaseId, attemptNumber: 1, ttlMs: 600_000,
      expiresAt: new Date(Date.now() + 600_000).toISOString(), holder: "seed",
    },
  });
  await appendJournalEvent(dir, {
    type: "stage-started", ...common, data: { stageId, leaseId, attemptNumber: 1 },
  });
  await appendJournalEvent(dir, {
    type: "stage-completed", ...common, data: { stageId, leaseId, attemptNumber: 1, outputs },
  });
}

/** Seed a run of stages as completed, in the order given. */
async function seedUpTo(dir: string, ...stageIds: string[]) {
  for (const id of stageIds) await seedCompleted(dir, id);
}

/**
 * Seed a stage as completed AND accepted, with a real hash-bound approval.
 *
 * Completing a `review: human` stage is no longer enough to reach past it: the
 * service falls back to the manifest when the gate holds no record, so a test
 * that wants to exercise something BEHIND such a stage has to put a genuine
 * approval in the journal. Written with `buildGateReview`/`hashArtifacts` over
 * bytes that really exist, because a hand-shaped record would derive as
 * `invalidated` and prove the opposite of what the test claims.
 */
async function seedAccepted(dir: string, stageId: string, relatives: string[]) {
  for (const relative of relatives) {
    await mkdir(dirname(join(dir, relative)), { recursive: true });
    await writeFile(join(dir, relative), `bytes of ${relative}`);
  }
  await seedCompleted(dir, stageId, relatives);
  await appendJournalEvent(dir, {
    type: "approval-granted",
    actor: "human",
    episode: REF,
    data: buildGateReview({
      stageId,
      decision: "approved",
      actor: "human",
      outputs: await hashArtifacts(dir, relatives),
    }),
  });
}

async function journal(dir: string) {
  return parseJournal(await readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8"));
}

/** A real, readable WAV — the captions handler measures durations from headers. */
async function writeWav(file: string, seconds = 0.1) {
  const sampleRate = 24000;
  const dataBytes = Math.round(sampleRate * 2 * seconds);
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);            // PCM
  buffer.writeUInt16LE(1, 22);            // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, buffer);
}

/** A directory with no pipeline manifests in it at all. */
async function emptyPipelineDir() {
  const dir = await mkdtemp(join(tmpdir(), "gw-no-pipelines-"));
  roots.push(dir);
  return dir;
}

/**
 * The real `/execute` route, over the real Fastify stack.
 *
 * The 17 tests below look like route coverage and never were: they called
 * `runAutopilot`, which the route stopped using. This is what actually
 * answers a POST.
 */
async function executeRoute(root: string, over: { maxStagesPerExecute?: number } = {}) {
  vi.stubEnv("AVG_LIBRARY_ROOT", root);
  const app = Fastify();
  const workspace = { getEpisode: async () => null } as unknown as WorkspaceService;
  registerProductionRoutes(app, {} as unknown as RuntimeClient, workspace, over);
  await app.ready();
  return {
    app,
    async post(pipeline: string, body: Record<string, unknown> = {}) {
      const res = await app.inject({
        method: "POST",
        url: `/api/channels/${REF.channel}/series/${REF.series}/episodes/${REF.episode}/execute`,
        payload: { pipeline, ...body },
      });
      return res.json();
    },
  };
}

describe("execution gates", () => {
  it("blocks a stage the manifest says may not run unattended", async () => {
    const { root, dir } = await episode();
    await seedUpTo(dir, "brief", "script");

    // safety-review declares autopilot: false. It used to run anyway and write
    // a report about a wolf.
    //
    // The reason is pinned, not just the status: for a while this stage was
    // blocked at `canDispatch` — it has no handler — which is a coincidence of
    // this stage rather than the rule the test claims. The service reads
    // `gates.autopilot` now, so the refusal is the one the title names.
    const result = await gatewayService(root).run(REF, "fairy-tale-adaptation", { stage: "safety-review" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/autopilot: false/);
    expect(result.value.reason).toMatch(/unattended/);
    expect(result.value.outputs).toEqual([]);
  });

  // The assertion avg-qr4.1 bought, stated at full strength. It was `it.fails`
  // while ExecutionService never read `stage.definition.gates.autopilot`: the
  // manifest's "may not run unattended" was enforced by nothing, and only
  // looked enforced because every autopilot: false stage in the shipped
  // manifests (script, compose, safety-review) also has no gateway handler.
  // The synthetic pipeline removes that mask by giving a handler — the real
  // `captions` one — to a stage that declares autopilot: false.
  it("honours autopilot: false for a stage it CAN dispatch", async () => {
    const { root, dir } = await episode();
    await writeWav(join(dir, "artifacts", "narration", "s1.wav"), 0.2);

    const pipelines = await emptyPipelineDir();
    await writeFile(join(pipelines, "unattended.yaml"), [
      "pipeline:",
      "  id: unattended",
      '  version: "1.0.0"',
      "  stages:",
      "    - id: captions",
      '      name: "Captions"',
      "      type: editorial",
      "      outputs:",
      "        - contract: captions.srt",
      '          version: "1.0.0"',
      "      gates:",
      "        autopilot: false",
      "        review: none",
      "        retry_on_failure: 0",
      "      depends_on: []",
      "",
    ].join("\n"));

    const result = await gatewayService(root, { builtinPipelines: pipelines })
      .run(REF, "unattended", { stage: "captions" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/autopilot: false/);
    // Refused for the flag, not for a missing handler: this dispatcher has one.
    expect(result.value.reason).not.toMatch(/does not handle/);
    await expect(readFile(join(dir, "artifacts", "captions.srt"), "utf-8")).rejects.toThrow();
  });

  it("never writes a safety report for an episode it did not read", async () => {
    const { root, dir } = await episode();
    await seedUpTo(dir, "brief", "script");

    await gatewayService(root).run(REF, "fairy-tale-adaptation", { stage: "safety-review" });

    await expect(readFile(join(dir, "artifacts", "safety-report.json"), "utf-8")).rejects.toThrow();
  });

  it("blocks a gated stage that has no checker behind it", async () => {
    const { root, dir } = await episode();
    await seedUpTo(dir, "brief", "script", "art-direction");
    // illustrations declares review: human, and continuity-check depends on
    // it — so it has to be genuinely accepted, or the block below would land
    // on the dependency rather than on the missing checker.
    await seedAccepted(dir, "illustrations", ["artifacts/frames/s1.png"]);

    // continuity-check declares autopilot: true but review: human, and nothing
    // actually checks continuity. Blocked, not a fabricated pass. This is the
    // test `GatewayDispatcher.canDispatch` exists for: without it the service
    // would dispatch, the dispatcher would throw, and the outcome would be
    // `failed` — an attempt that broke — rather than a refusal to clear.
    const result = await gatewayService(root).run(REF, "fairy-tale-adaptation", { stage: "continuity-check" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/does not handle/);
    expect(result.value.reason).toMatch(/continuity-check/);
  });
});

describe("acceptance gates", () => {
  it("leaves a human-reviewed stage awaiting review, not completed", async () => {
    const { root, dir } = await episode();
    await seedUpTo(dir, "brief", "script", "art-direction");
    await writeFile(join(dir, "assets", "images", "s1.png"), "not really a png, but bytes");

    // illustrations declares review: human. It does real work, so it runs — but
    // its result is a candidate, not an accepted one.
    const result = await gatewayService(root).run(REF, "narrated-illustrated-video", { stage: "illustrations" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("awaiting_review");
    expect(result.value.outputs.length).toBeGreaterThan(0);

    // The original asserted that the approval-requested record named what it
    // wanted reviewed, by hash. Nothing writes that record any more (F2). What
    // survives is that the outcome names artifacts that are really there and
    // really hashable — a weaker statement about a different object, kept so
    // the outputs cannot become a list of names nobody can check.
    const hashed = await hashArtifacts(dir, result.value.outputs);
    expect(hashed[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never emits an approval of its own", async () => {
    const { root, dir } = await episode();
    await seedUpTo(dir, "brief", "script", "art-direction");
    await writeFile(join(dir, "assets", "images", "s1.png"), "bytes");

    await gatewayService(root).run(REF, "narrated-illustrated-video", { stage: "illustrations" });

    // Minting a human approval is avg-qr4.3's problem, and never the gateway's.
    expect((await journal(dir)).filter((e) => e.type === "approval-granted")).toHaveLength(0);
  });

  it("stops the run at the first unaccepted stage", async () => {
    const { root, dir } = await episode();
    await seedUpTo(dir, "brief", "script", "art-direction", "narration", "terminal-recordings");
    await writeFile(join(dir, "assets", "images", "s1.png"), "bytes");

    // Driven through the loop the route actually runs, rather than a fake
    // runtime handing over a stage list. `illustrations` is the first stage
    // the service can select; `captions` is selectable right behind it and
    // would consume illustrations nobody accepted.
    const { app, post } = await executeRoute(root);
    const body = await post("narrated-illustrated-video");
    await app.close();

    expect(body.report.stages).toHaveLength(1);
    expect(body.report.stages[0]!.stageId).toBe("illustrations");
    expect(body.report.stages[0]!.status).toBe("awaiting_review");
  });
});

describe("gates that cannot be read", () => {
  it("blocks rather than guessing a stage has no gates", async () => {
    const { root, dir } = await episode();
    await writeFile(join(dir, "assets", "images", "s1.png"), "bytes");

    // No such pipeline: resolution fails. Not knowing a stage's gates is not
    // the same as a stage having none, so the call errors rather than
    // proceeding. The old code expressed that as a `blocked` stage plus an
    // approval-requested; the service expresses it as a refusal to produce any
    // outcome at all, which is at least as closed.
    const result = await gatewayService(root, { builtinPipelines: await emptyPipelineDir() })
      .run(REF, "no-such-pipeline");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PIPELINE_UNRESOLVED");
    expect(result.error.message).toMatch(/no-such-pipeline/);
  });

  it("does not run the handler of a stage whose gates it could not read", async () => {
    const { root, dir } = await episode();
    await writeFile(join(dir, "assets", "images", "s1.png"), "bytes");

    // A gate you cannot read covers execution, not only acceptance: an unknown
    // stage might be the one declaring autopilot: false. So the block lands
    // before the handler, and nothing is written.
    const result = await gatewayService(root, { builtinPipelines: await emptyPipelineDir() })
      .run(REF, "no-such-pipeline");

    // The no-trace assertions come first, and deliberately. Vitest stops at the
    // first failed expect, so leading with the status would let a status-only
    // regression shadow the two checks that actually distinguish "blocked
    // before the handler" from "blocked after it ran".
    //
    // handleIllustrations copies assets/images into artifacts/frames. If it had
    // run, that directory would exist and hold s1.png.
    await expect(readdir(join(dir, "artifacts", "frames"))).rejects.toThrow();
    await expect(readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8")).rejects.toThrow();
    expect(result.ok).toBe(false);
  });
});

describe("output validation", () => {
  it("fails a stage that produced nothing", async () => {
    const { root, dir } = await episode();
    await seedUpTo(dir, "brief", "script", "art-direction");

    // illustrations with no source images returns an empty output list. That
    // used to be reported as completed. The real handler is kept rather than
    // an injected stub: the empty list has to come from the code that ships.
    const result = await gatewayService(root).run(REF, "narrated-illustrated-video", { stage: "illustrations" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("failed");
    expect(result.value.reason).toMatch(/no outputs/i);
  });

  it("fails a stage whose output is an empty file", async () => {
    const { root, dir } = await episode();
    await seedUpTo(dir, "brief", "script", "art-direction");
    await writeFile(join(dir, "assets", "images", "s1.png"), "");

    const result = await gatewayService(root).run(REF, "narrated-illustrated-video", { stage: "illustrations" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("failed");
    expect(result.value.reason).toMatch(/empty/);
  });

  it("refuses a dispatcher that produces nothing, whatever the dispatcher is", async () => {
    // The same rule stated against an injected dispatcher, so it is not
    // hostage to handleIllustrations happening to return [].
    const { root, dir } = await episode();
    await seedUpTo(dir, "brief", "script", "art-direction");
    const nothing: StageDispatcher = { dispatch: async () => [] };

    const result = await gatewayService(root, { dispatcher: nothing })
      .run(REF, "narrated-illustrated-video", { stage: "illustrations" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("failed");
    expect(result.value.reason).toMatch(/no outputs/i);
  });
});

describe("the run summary", () => {
  it("counts blocked and awaiting stages so a halt cannot read as a finish", async () => {
    const blockedRun = await episode();
    // Nothing seeded: `brief` is the first selectable stage, the gateway has no
    // handler for it, and the run halts there.
    {
      const { app, post } = await executeRoute(blockedRun.root);
      const body = await post("fairy-tale-adaptation");
      await app.close();
      expect(body.report.summary).toMatch(/1 blocked/);
      expect(body.report.summary).not.toMatch(/^All stages already complete/);
      expect(body.report.summary).not.toMatch(/^Nothing to do/);
    }

    const awaitingRun = await episode();
    await seedUpTo(awaitingRun.dir, "brief", "script", "art-direction", "narration", "terminal-recordings");
    await writeFile(join(awaitingRun.dir, "assets", "images", "s1.png"), "bytes");
    {
      const { app, post } = await executeRoute(awaitingRun.root);
      const body = await post("narrated-illustrated-video");
      await app.close();
      expect(body.report.summary).toMatch(/1 awaiting review/);
      expect(body.report.summary).not.toMatch(/^All stages already complete/);
    }
  });

  it("does not report completion when the pipeline never resolved", async () => {
    const { root } = await episode();

    // The service could not even select a stage — no pipeline, no stages, just
    // an error. Before `sawCompletion` this fell through the same empty-results
    // branch as a genuinely finished episode, and the summary claimed "All
    // stages already complete" for a run that never touched a stage. The
    // route's equivalent branch said "Nothing to do", which is the same lie in
    // the current vocabulary; it now names the halt instead.
    const { app, post } = await executeRoute(root);
    const body = await post("no-such-pipeline");
    await app.close();

    expect(body.ok).toBe(false);
    expect(body.report.stages).toHaveLength(0);
    expect(body.report.summary).not.toMatch(/All stages already complete/);
    expect(body.report.summary).not.toMatch(/^Nothing to do/);
    expect(body.report.summary).toMatch(/no-such-pipeline/);
    expect(body.report.summary).toMatch(/could not be resolved|resolved to no stages/);
  });

  it("says so when it stopped at the per-call stage limit", async () => {
    // A cap reached with every stage completing exits the loop exactly as a
    // finished pipeline does: same statuses, same counts. "1 completed, 0
    // failed, 1 total" would be indistinguishable from a finish.
    const { root, dir } = await episode();
    await seedUpTo(dir, "brief", "script", "art-direction", "terminal-recordings", "illustrations");
    await writeWav(join(dir, "artifacts", "narration", "s1.wav"), 0.2);
    await seedCompleted(dir, "narration", ["artifacts/narration/s1.wav"]);

    const { app, post } = await executeRoute(root, { maxStagesPerExecute: 1 });
    const body = await post("narrated-illustrated-video");
    await app.close();

    expect(body.report.stages).toHaveLength(1);
    expect(body.report.stages[0]!.status).toBe("completed");
    expect(body.report.summary).toMatch(/limit of 1 stages/);
    expect(body.report.summary).toMatch(/may have more/);
  });

  it("does not claim truncation when the run stopped for its own reasons", async () => {
    const { root } = await episode();

    const { app, post } = await executeRoute(root, { maxStagesPerExecute: 1 });
    const body = await post("fairy-tale-adaptation");
    await app.close();

    // One stage was recorded and the cap is one — but the loop broke on a
    // blocked stage rather than exhausting the cap, and the summary must not
    // suggest otherwise.
    expect(body.report.stages).toHaveLength(1);
    expect(body.report.stages[0]!.status).toBe("blocked");
    expect(body.report.summary).not.toMatch(/limit of/);
  });
});

describe("dependency gates", () => {
  // The halt has to survive the next POST /execute, and nothing but this gate
  // makes it. The service selects the next stage from the journal's execution
  // state, in which a stage awaiting review is recorded as `completed` —
  // because it did complete; acceptance is a separate fact. So the second
  // invocation is offered the stage after the one that stopped, and would
  // build on an artifact nobody accepted unless the review gate says so.
  //
  // `captions` depends on `narration`, not on `illustrations` — the two stages
  // in the spec's narrative are not actually adjacent in
  // narrated-illustrated-video.yaml. The edge exercised below is the real one,
  // and `captions` is still the stage that would silently complete: it has a
  // handler and declares `review: none`, so nothing else would stop it.

  /** An episode with one narration segment, hashed as `relative`. */
  async function narrated() {
    const { root, dir } = await episode();
    const relative = join("artifacts", "narration", "s1.wav");
    await writeWav(join(dir, relative), 0.2);
    // `captions` is reachable only once `narration` has completed. The WAV is
    // what it consumes; the journal line is what makes it selectable.
    await seedCompleted(dir, "narration", [relative]);
    return { root, dir, relative };
  }

  async function record(
    dir: string,
    type: "approval-requested" | "approval-granted",
    review: Record<string, unknown>,
  ) {
    await appendJournalEvent(dir, {
      type,
      actor: type === "approval-granted" ? "human" : "gateway",
      episode: REF,
      data: review,
    });
  }

  it("blocks a stage whose dependency is still awaiting review", async () => {
    const { root, dir, relative } = await narrated();

    await record(dir, "approval-requested", buildGateReview({
      stageId: "narration",
      decision: "requested",
      actor: "gateway",
      outputs: await hashArtifacts(dir, [relative]),
    }));

    const result = await gatewayService(root).run(REF, "narrated-illustrated-video", { stage: "captions" });

    // Assert the absence of work before the status: a status-only regression
    // must not hide the fact that the handler ran anyway.
    await expect(readFile(join(dir, "artifacts", "captions.srt"), "utf-8")).rejects.toThrow();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/narration/);
    expect(result.value.reason).toMatch(/awaiting review/);
  });

  it("lets the stage run once that dependency is approved", async () => {
    const { root, dir, relative } = await narrated();

    // A real approval: the hashes are of the bytes actually on disk. Recording
    // anything else would make deriveGateState answer `invalidated`, and this
    // test would prove the opposite of what it claims.
    await record(dir, "approval-granted", buildGateReview({
      stageId: "narration",
      decision: "approved",
      actor: "human",
      outputs: await hashArtifacts(dir, [relative]),
    }));

    const result = await gatewayService(root).run(REF, "narrated-illustrated-video", { stage: "captions" });

    // Not merely unblocked — through to completion, with the artifact on disk.
    expect(await readFile(join(dir, "artifacts", "captions.srt"), "utf-8")).toMatch(/-->/);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stageId).toBe("captions");
    expect(result.value.status).toBe("completed");
  });

  it("blocks when the dependency's approval no longer matches what is on disk", async () => {
    const { root, dir, relative } = await narrated();

    await record(dir, "approval-granted", buildGateReview({
      stageId: "narration",
      decision: "approved",
      actor: "human",
      outputs: await hashArtifacts(dir, [relative]),
    }));

    // Re-rendered after the approval. The approval described bytes that are
    // gone, so it is not an approval of what would now be consumed.
    await writeWav(join(dir, relative), 0.9);

    const result = await gatewayService(root).run(REF, "narrated-illustrated-video", { stage: "captions" });

    await expect(readFile(join(dir, "artifacts", "captions.srt"), "utf-8")).rejects.toThrow();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/invalidated review/);
    expect(result.value.reason).toMatch(/changed since it was approved/);
  });

  it("keeps a recorded halt at a review gate across the next execute", async () => {
    // The half of the original that survives: given the record a halt is
    // supposed to leave, the refusal is repeated on a fresh service — the gate
    // is consulted every time and nothing caches its answer.
    const { root, dir, relative } = await narrated();
    await record(dir, "approval-requested", buildGateReview({
      stageId: "narration",
      decision: "requested",
      actor: "gateway",
      outputs: await hashArtifacts(dir, [relative]),
    }));

    const first = await gatewayService(root).run(REF, "narrated-illustrated-video", { stage: "captions" });
    const second = await gatewayService(root).run(REF, "narrated-illustrated-video", { stage: "captions" });

    for (const result of [first, second]) {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("blocked");
      expect(result.value.reason).toMatch(/narration/);
      expect(result.value.reason).toMatch(/awaiting review/);
    }
    await expect(readFile(join(dir, "artifacts", "captions.srt"), "utf-8")).rejects.toThrow();
  });

  // The load-bearing one, asserted with NOTHING hand-authored — "this is the
  // state a real halt leaves" — because that is the only version of the
  // property worth having.
  //
  // It was `it.fails` until the review gate went tri-state. Nothing in this
  // composition writes an `approval-requested` record, so `deriveGateState`
  // answers `none` for a stage that completed while declaring `review: human`.
  // While `isOutstanding` returned a boolean that came back as "not
  // outstanding", the injected gate was authoritative, the manifest fallback
  // was skipped, and the dependent was refused only for having no handler —
  // the "coincidence of this stage, not a rule" ruled out below. `no-record`
  // now falls through to the manifest, so the refusal is about the dependency.
  it("keeps a halt at a review gate across the next execute, with no record written", async () => {
    const { root, dir } = await episode();
    await seedUpTo(dir, "brief", "script", "art-direction");
    await writeFile(join(dir, "assets", "images", "s1.png"), "bytes");

    // Run 1: the gateway itself halts illustrations. Nothing here is
    // hand-authored — this is the state a real halt leaves.
    const first = await gatewayService(root).run(REF, "fairy-tale-adaptation", { stage: "illustrations" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.status).toBe("awaiting_review");

    // Run 2: continuity-check depends on illustrations. Without the gate it
    // would be refused for having no checker — a coincidence of this stage,
    // not a rule. It must be refused for its dependency.
    const second = await gatewayService(root).run(REF, "fairy-tale-adaptation", { stage: "continuity-check" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.status).toBe("blocked");
    expect(second.value.reason).toMatch(/illustrations/);
    expect(second.value.reason).toMatch(/no accepted review is recorded/);
    // Refused for the dependency, not for the missing checker.
    expect(second.value.reason).not.toMatch(/does not handle/);
  });
});

describe("quality assurance", () => {
  it("cannot produce a pass with no render present", async () => {
    const { root, dir } = await episode();
    await seedUpTo(
      dir, "brief", "script", "art-direction", "terminal-recordings",
      "illustrations", "narration", "captions", "timing",
    );
    // qa depends on compose, which declares review: human. Accepted here so
    // that qa is reached at all — the property under test is what qa writes,
    // not whether the review gate holds.
    await seedAccepted(dir, "compose", ["artifacts/compose-log.txt"]);

    // Nothing wrote output/*.mp4 or artifacts/final.mp4. QA runs — it has a
    // handler — but it declares review: human, so it is structurally unable to
    // reach `completed`, and its report must not claim a verdict it could not
    // have reached.
    const result = await gatewayService(root).run(REF, "narrated-illustrated-video", { stage: "qa" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stageId).toBe("qa");
    expect(result.value.status).not.toBe("completed");

    const written = JSON.parse(await readFile(join(dir, "artifacts", "qa-report.json"), "utf-8"));
    expect(written.verdict).not.toBe("pass");
    expect(written.checks).toEqual([]);
    expect(written.summary).toMatch(/No render found/);
  });
});

describe("the /execute route", () => {
  // Rider 3: the 17 above never touched the route. These do.
  it("answers a POST with a report naming what ran and what it produced", async () => {
    const { root, dir } = await episode();
    await seedUpTo(dir, "brief", "script", "art-direction", "terminal-recordings", "illustrations");
    await writeWav(join(dir, "artifacts", "narration", "s1.wav"), 0.2);
    await seedCompleted(dir, "narration", ["artifacts/narration/s1.wav"]);

    const { app, post } = await executeRoute(root);
    const body = await post("narrated-illustrated-video");
    await app.close();

    expect(body.ok).toBe(true);
    expect(body.report.episodeSlug).toBe(`${REF.channel}/${REF.series}/${REF.episode}`);
    expect(body.report.pipeline).toBe("narrated-illustrated-video");
    expect(typeof body.report.totalDurationMs).toBe("number");

    // captions and timing both declare review: none and both have handlers, so
    // the loop advances through them and stops at compose, which has neither.
    const byId = Object.fromEntries(body.report.stages.map((s: any) => [s.stageId, s]));
    expect(byId["captions"]!.status).toBe("completed");
    expect(byId["captions"]!.outputs).toContain("artifacts/captions.srt");
    expect(await readFile(join(dir, "artifacts", "captions.srt"), "utf-8")).toMatch(/-->/);
    expect(body.report.summary).toMatch(/completed/);
  });

  it("reports a dry run without leasing, dispatching or writing", async () => {
    const { root, dir } = await episode();
    await seedUpTo(dir, "brief", "script", "art-direction", "terminal-recordings", "illustrations");
    await writeWav(join(dir, "artifacts", "narration", "s1.wav"), 0.2);
    await seedCompleted(dir, "narration", ["artifacts/narration/s1.wav"]);
    const before = (await journal(dir)).length;

    const { app, post } = await executeRoute(root);
    const body = await post("narrated-illustrated-video", { dryRun: true });
    await app.close();

    expect(body.ok).toBe(true);
    expect(body.dryRun).toBe(true);
    expect(body.outcome.status).toBe("would-run");
    await expect(readFile(join(dir, "artifacts", "captions.srt"), "utf-8")).rejects.toThrow();
    expect((await journal(dir)).length).toBe(before);
  });

  it("reports a fully materialized pipeline without invoking handlers", async () => {
    // Moved here from runtime-executor.test.ts, where it drove runAutopilot
    // and the fake runtime said "All stages complete". The service derives
    // that for itself: every stage completed in the journal means nothing is
    // selectable, which is `idle`, which is an empty report.
    const { root, dir } = await episode();
    await seedUpTo(
      dir, "brief", "script", "art-direction", "terminal-recordings", "illustrations",
      "narration", "captions", "timing", "compose", "qa",
    );

    const { app, post } = await executeRoute(root);
    const body = await post("narrated-illustrated-video");
    await app.close();

    expect(body.ok).toBe(true);
    expect(body.report.stages).toEqual([]);
    expect(body.report.summary).toMatch(/^Nothing to do/);
    // No handler ran: captions and qa both write into artifacts/.
    await expect(readFile(join(dir, "artifacts", "captions.srt"), "utf-8")).rejects.toThrow();
    await expect(readFile(join(dir, "artifacts", "qa-report.json"), "utf-8")).rejects.toThrow();
  });

  it("resolves the built-in pipelines without an environment variable", async () => {
    // The route builds its own ExecutionService. If it does not tell the
    // loader where the built-in manifests live, every shipped pipeline
    // resolves to nothing on an ordinary install and /execute answers
    // PIPELINE_UNRESOLVED for all of them.
    const { root } = await episode();
    vi.stubEnv("AVG_BUILTIN_PIPELINES", "");

    const { app, post } = await executeRoute(root);
    const body = await post("narrated-illustrated-video");
    await app.close();

    expect(body.report.stages[0]!.stageId).toBe("brief");
    expect(body.report.summary).not.toMatch(/could not be resolved/);
  });
});
