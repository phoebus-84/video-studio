import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAutopilot } from "../src/runtime/executor.js";
import type { RuntimeClient } from "../src/runtime/client.js";
import { parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";

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
    expect(requested[0]!.detail.stageId).toBe("safety-review");
    expect(requested[0]!.detail.decision).toBe("requested");
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
    expect(requested[0]!.detail.outputs[0].sha256).toMatch(/^[0-9a-f]{64}$/);
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

    expect(report.stages[0]!.status).toBe("blocked");
    expect(report.stages[0]!.outputs).toEqual([]);
    // handleIllustrations copies assets/images into artifacts/frames. If it had
    // run, that directory would exist and hold s1.png.
    await expect(readdir(join(dir, "artifacts", "frames"))).rejects.toThrow();
    expect((await journal(dir)).filter((e) => e.type === "stage-started")).toHaveLength(0);
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
});
