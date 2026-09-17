import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAutopilot } from "../src/runtime/executor.js";
import type { RuntimeClient } from "../src/runtime/client.js";
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
  vi.stubEnv("AVG_BUILTIN_PIPELINES", PIPELINES);
  return { root, dir };
}

/** A runtime that offers `stageIds` in order, then reports completion. */
function runtimeOffering(...stageIds: string[]): RuntimeClient {
  const queue = [...stageIds];
  return {
    run: vi.fn().mockImplementation(async () => {
      const id = queue.shift();
      return id
        ? { ok: true, data: { stage: { id } } }
        : { ok: true, data: { message: "All stages complete", completed: true } };
    }),
  } as unknown as RuntimeClient;
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

describe("execution gates", () => {
  it("blocks a stage the manifest says may not run unattended", async () => {
    const { root, dir } = await episode();

    // safety-review declares autopilot: false. It used to run anyway and write
    // a report about a wolf.
    const report = await runAutopilot(
      runtimeOffering("safety-review"), REF, "fairy-tale-adaptation", root, () => {},
    );

    expect(report.stages[0]!.status).toBe("blocked");
    expect(report.stages[0]!.outputs).toEqual([]);

    const events = await journal(dir);
    const requested = events.filter((e) => e.type === "approval-requested");
    expect(requested).toHaveLength(1);
    expect(requested[0]!.data.stageId).toBe("safety-review");
    expect(requested[0]!.data.decision).toBe("requested");
  });

  it("never writes a safety report for an episode it did not read", async () => {
    const { root, dir } = await episode();

    await runAutopilot(
      runtimeOffering("safety-review"), REF, "fairy-tale-adaptation", root, () => {},
    );

    await expect(readFile(join(dir, "artifacts", "safety-report.json"), "utf-8")).rejects.toThrow();
  });

  it("blocks a gated stage that has no checker behind it", async () => {
    const { root } = await episode();

    // continuity-check declares autopilot: true but review: human, and nothing
    // actually checks continuity. Blocked, not a fabricated pass.
    const report = await runAutopilot(
      runtimeOffering("continuity-check"), REF, "fairy-tale-adaptation", root, () => {},
    );

    expect(report.stages[0]!.status).toBe("blocked");
  });
});

describe("acceptance gates", () => {
  it("leaves a human-reviewed stage awaiting approval, not completed", async () => {
    const { root, dir } = await episode();
    await writeFile(join(dir, "assets", "images", "s1.png"), "not really a png, but bytes");

    // illustrations declares review: human. It does real work, so it runs — but
    // its result is a candidate, not an accepted one.
    const report = await runAutopilot(
      runtimeOffering("illustrations"), REF, "fairy-tale-adaptation", root, () => {},
    );

    expect(report.stages[0]!.status).toBe("awaiting_approval");
    expect(report.stages[0]!.outputs.length).toBeGreaterThan(0);

    const requested = (await journal(dir)).filter((e) => e.type === "approval-requested");
    expect(requested).toHaveLength(1);
    // The request names what it wants reviewed, by hash.
    expect(requested[0]!.data.outputs[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never emits an approval of its own", async () => {
    const { root, dir } = await episode();
    await writeFile(join(dir, "assets", "images", "s1.png"), "bytes");

    await runAutopilot(runtimeOffering("illustrations"), REF, "fairy-tale-adaptation", root, () => {});

    // Minting a human approval is avg-qr4.3's problem, and never the gateway's.
    expect((await journal(dir)).filter((e) => e.type === "approval-granted")).toHaveLength(0);
  });

  it("stops the run at the first unaccepted stage", async () => {
    const { root, dir } = await episode();
    await writeFile(join(dir, "assets", "images", "s1.png"), "bytes");

    const report = await runAutopilot(
      runtimeOffering("illustrations", "captions"), REF, "fairy-tale-adaptation", root, () => {},
    );

    // captions would consume illustrations nobody accepted.
    expect(report.stages).toHaveLength(1);
    expect(report.stages[0]!.stageId).toBe("illustrations");
  });
});

describe("gates that cannot be read", () => {
  it("blocks rather than guessing a stage has no gates", async () => {
    const { root, dir } = await episode();
    await writeFile(join(dir, "assets", "images", "s1.png"), "bytes");

    // No such pipeline: resolution throws and the gate map is null. Not knowing
    // a stage's gates is not the same as a stage having none.
    const report = await runAutopilot(
      runtimeOffering("illustrations"), REF, "no-such-pipeline", root, () => {},
    );

    expect(report.stages[0]!.status).toBe("blocked");
    expect(report.summary).toMatch(/1 blocked/);
    expect((await journal(dir)).filter((e) => e.type === "approval-requested")).toHaveLength(1);
  });

  it("does not run the handler of a stage whose gates it could not read", async () => {
    const { root, dir } = await episode();
    await writeFile(join(dir, "assets", "images", "s1.png"), "bytes");

    // A gate you cannot read covers execution, not only acceptance: an unknown
    // stage might be the one declaring autopilot: false. So the block lands
    // before the handler, and nothing is written.
    const report = await runAutopilot(
      runtimeOffering("illustrations"), REF, "no-such-pipeline", root, () => {},
    );

    // The no-trace assertions come first, and deliberately. Vitest stops at the
    // first failed expect, so leading with the status would let a status-only
    // regression shadow the two checks that actually distinguish "blocked
    // before the handler" from "blocked after it ran".
    //
    // There is no "the journal has no stage-started" check here any more: the
    // gateway no longer writes stage-started at all — it takes no leases, so
    // it cannot write a replayable execution event — which would make that
    // assertion pass no matter what the handler did.
    //
    // handleIllustrations copies assets/images into artifacts/frames. If it had
    // run, that directory would exist and hold s1.png.
    await expect(readdir(join(dir, "artifacts", "frames"))).rejects.toThrow();
    expect(report.stages[0]!.outputs).toEqual([]);
    expect(report.stages[0]!.status).toBe("blocked");
  });
});

describe("output validation", () => {
  it("fails a stage that produced nothing", async () => {
    const { root } = await episode();

    // illustrations with no source images returns an empty output list. That
    // used to be reported as completed.
    const report = await runAutopilot(
      runtimeOffering("illustrations"), REF, "fairy-tale-adaptation", root, () => {},
    );

    expect(report.stages[0]!.status).toBe("failed");
    expect(report.stages[0]!.error).toMatch(/no outputs/i);
  });

  it("fails a stage whose output is an empty file", async () => {
    const { root, dir } = await episode();
    await writeFile(join(dir, "assets", "images", "s1.png"), "");

    const report = await runAutopilot(
      runtimeOffering("illustrations"), REF, "fairy-tale-adaptation", root, () => {},
    );

    expect(report.stages[0]!.status).toBe("failed");
  });
});

describe("the run summary", () => {
  it("counts blocked and awaiting stages so a halt cannot read as a finish", async () => {
    const { root } = await episode();

    const report = await runAutopilot(
      runtimeOffering("safety-review"), REF, "fairy-tale-adaptation", root, () => {},
    );

    expect(report.summary).toMatch(/1 blocked/);
    expect(report.summary).not.toMatch(/^All stages already complete/);
  });

  it("does not report completion when the runtime never resolved a stage", async () => {
    const { root } = await episode();

    // The runtime itself is unreachable — no stage, no data, just an error.
    // Before sawCompletion, this fell through the same `results.length === 0`
    // branch as a genuinely finished episode: the loop broke on the first
    // iteration with nothing in `results`, and the summary claimed "All stages
    // already complete" for a run that never touched a single stage.
    const runtime: RuntimeClient = {
      run: vi.fn().mockResolvedValue({ ok: false, error: "vpr not found" }),
    } as unknown as RuntimeClient;

    const report = await runAutopilot(runtime, REF, "fairy-tale-adaptation", root, () => {});

    expect(report.stages).toHaveLength(0);
    expect(report.summary).not.toMatch(/All stages already complete/);
    expect(report.summary).toMatch(/vpr not found/);
  });

});

describe("dependency gates", () => {
  // The halt has to survive the next POST /execute, and nothing but this gate
  // makes it. `studio/runtime/src/cli.ts` picks the pending stage purely from
  // which output files exist; the gateway leaves a halted stage's outputs on
  // disk and records the review request only in the journal, which the runtime
  // never reads. So the second invocation is offered the stage after the one
  // that stopped, and would build on an artifact nobody accepted.
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

    const report = await runAutopilot(
      runtimeOffering("captions"), REF, "fairy-tale-adaptation", root, () => {},
    );

    // Assert the absence of work before the status: a status-only regression
    // must not hide the fact that the handler ran anyway.
    await expect(readFile(join(dir, "artifacts", "captions.srt"), "utf-8")).rejects.toThrow();
    expect(report.stages[0]!.status).toBe("blocked");
    expect(report.stages[0]!.error).toMatch(/narration/);
    expect(report.stages[0]!.error).toMatch(/awaiting review/);
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

    const report = await runAutopilot(
      runtimeOffering("captions"), REF, "fairy-tale-adaptation", root, () => {},
    );

    // Not merely unblocked — through to completion, with the artifact on disk.
    expect(await readFile(join(dir, "artifacts", "captions.srt"), "utf-8")).toMatch(/-->/);
    expect(report.stages[0]!.stageId).toBe("captions");
    expect(report.stages[0]!.status).toBe("completed");
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

    const report = await runAutopilot(
      runtimeOffering("captions"), REF, "fairy-tale-adaptation", root, () => {},
    );

    await expect(readFile(join(dir, "artifacts", "captions.srt"), "utf-8")).rejects.toThrow();
    expect(report.stages[0]!.status).toBe("blocked");
    expect(report.stages[0]!.error).toMatch(/invalidated review/);
    expect(report.stages[0]!.error).toMatch(/changed since it was approved/);
  });

  it("keeps a halt at a review gate across the next execute", async () => {
    const { root, dir } = await episode();
    await writeFile(join(dir, "assets", "images", "s1.png"), "bytes");

    // Run 1: the gateway itself halts illustrations and writes the request.
    // Nothing here is hand-authored — this is the state a real halt leaves.
    const first = await runAutopilot(
      runtimeOffering("illustrations"), REF, "fairy-tale-adaptation", root, () => {},
    );
    expect(first.stages[0]!.status).toBe("awaiting_approval");

    // Run 2: discovery sees artifacts/frames on disk and moves on. Without the
    // gate, continuity-check would be refused for having no checker — a
    // coincidence of this stage, not a rule. It is refused for its dependency.
    const second = await runAutopilot(
      runtimeOffering("continuity-check"), REF, "fairy-tale-adaptation", root, () => {},
    );

    expect(second.stages[0]!.status).toBe("blocked");
    expect(second.stages[0]!.error).toMatch(/illustrations/);
    expect(second.stages[0]!.error).toMatch(/awaiting review/);
  });
});

describe("quality assurance", () => {
  it("cannot produce a pass with no render present", async () => {
    const { root, dir } = await episode();

    // Nothing wrote output/*.mp4 or artifacts/final.mp4. QA runs — it has a
    // handler — but it declares review: human, so it is structurally unable to
    // reach `completed`, and its report must not claim a verdict it could not
    // have reached.
    const report = await runAutopilot(
      runtimeOffering("qa"), REF, "fairy-tale-adaptation", root, () => {},
    );

    expect(report.stages[0]!.stageId).toBe("qa");
    expect(report.stages[0]!.status).not.toBe("completed");

    const written = JSON.parse(await readFile(join(dir, "artifacts", "qa-report.json"), "utf-8"));
    expect(written.verdict).not.toBe("pass");
    expect(written.checks).toEqual([]);
    expect(written.summary).toMatch(/No render found/);
  });
});
