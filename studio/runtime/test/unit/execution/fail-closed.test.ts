import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ExecutionService } from "../../../src/execution/service.js";
import type { StageDispatcher, BudgetGuard } from "../../../src/execution/types.js";
import { parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { ok, err } from "../../../src/result.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINES = resolve(__dirname, "../../../../pipelines/pipelines");
const REF = { channel: "childrens", series: "fairy-tales", episode: "ep" };

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function episode() {
  const root = await mkdtemp(join(tmpdir(), "exec-fail-closed-"));
  roots.push(root);
  const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
  await mkdir(join(dir, "journal"), { recursive: true });
  await mkdir(join(dir, "artifacts"), { recursive: true });
  return { root, dir };
}

async function journal(dir: string) {
  return parseJournal(await readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8"));
}

/** A dispatcher that writes the file it claims to have written. */
function writingDispatcher(dir: string, relative = "artifacts/brief.md"): StageDispatcher {
  return {
    dispatch: async () => {
      const file = join(dir, relative);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, "real content");
      return [file];
    },
  };
}

const permissiveBudget: BudgetGuard = {
  maySpend: async () => ok({ reserveId: "r1", estimatedCost: 0 }),
};

describe("failing closed", () => {
  it("refuses a stage the pipeline does not declare", async () => {
    const { root } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: { dispatch: async () => [] }, budget: permissiveBudget,
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "no-such-stage" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STAGE_UNKNOWN");
  });

  it("blocks when no dispatcher is configured", async () => {
    const { root } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES, budget: permissiveBudget,
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/no dispatcher/);
  });

  it("blocks when no budget guard is configured", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES, dispatcher: writingDispatcher(dir),
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/budget/);
  });

  it("blocks when the budget guard refuses", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES, dispatcher: writingDispatcher(dir),
      budget: { maySpend: async () => err({ code: "OVER_LIMIT", message: "no funds remain" }) },
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/no funds remain/);
  });

  it("fails a stage whose dispatcher returned nothing", async () => {
    const { root } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: { dispatch: async () => [] }, budget: permissiveBudget,
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("failed");
    expect(result.value.reason).toMatch(/no outputs/);
  });

  it("fails a stage whose declared output was never written", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: { dispatch: async () => [join(dir, "artifacts", "ghost.md")] },
      budget: permissiveBudget,
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("failed");
    expect(result.value.reason).toMatch(/was not written/);
  });

  it("fails a stage whose output is empty", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: {
        dispatch: async () => {
          const file = join(dir, "artifacts", "empty.md");
          await writeFile(file, "");
          return [file];
        },
      },
      budget: permissiveBudget,
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("failed");
    expect(result.value.reason).toMatch(/is empty/);
  });

  it("fails, and records the failure, when the dispatcher throws", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: { dispatch: async () => { throw new Error("the renderer died"); } },
      budget: permissiveBudget,
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("failed");
    expect(result.value.reason).toMatch(/the renderer died/);

    const types = (await journal(dir)).map((e: any) => e.type);
    expect(types).toContain("stage-failed");
  });

  it("blocks a stage whose dependency has not completed", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: writingDispatcher(dir), budget: permissiveBudget,
    });

    // script depends on brief, which has never run.
    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "script" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/brief/);
  });

  it("fails a stage whose lease expired while it was dispatching", async () => {
    // The holder took too long. Something else may have taken the stage, so
    // this attempt's result cannot be trusted and must not be recorded as
    // a completion.
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      leaseTtlMs: 20,
      dispatcher: {
        dispatch: async () => {
          await new Promise((r) => setTimeout(r, 60));
          const file = join(dir, "artifacts", "brief.md");
          await writeFile(file, "content");
          return [file];
        },
      },
      budget: permissiveBudget,
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("failed");
    expect(result.value.reason).toMatch(/lease/i);

    // The property that actually matters: an attempt whose lease lapsed
    // writes NOTHING. Not a completion — something else may already hold the
    // stage, so its outputs cannot be trusted — and not a terminal event
    // either, because by now another holder may have leased, started and
    // finished the stage, and a stale terminal event landing after that is
    // what makes replay throw for good.
    const events = await journal(dir);
    expect(events.map((e: any) => e.type)).toEqual(["stage-leased", "stage-started"]);

    // Nothing is lost by the silence: the timeout is derived from the
    // lease's own expiresAt, which the stage-leased event already carries.
    const status = await svc.status(REF, "narrated-illustrated-video");
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    const brief = status.value.stages.find((s) => s.stageId === "brief")!;
    expect(brief.status).toBe("failed");
    expect(brief.lease.state).toBe("expired");
  });
});

// ── the autopilot gate ──────────────────────────────────────────────────────
//
// `gates.autopilot: false` was enforced by nothing: "autopilot" appeared
// nowhere in service.ts. It looked enforced only because every such stage in
// the shipped manifests also lacks a gateway handler and stopped one gate
// later, at `canDispatch`. These tests remove that coincidence.
describe("a stage that may not run unattended", () => {
  /** One stage with a handler behind it, gated by `autopilot`. */
  async function unattendedPipeline(autopilot: boolean): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "exec-autopilot-"));
    roots.push(dir);
    await writeFile(join(dir, "unattended.yaml"), [
      "pipeline:",
      "  id: unattended",
      '  version: "1.0.0"',
      "  stages:",
      "    - id: brief",
      '      name: "Brief"',
      "      type: editorial",
      "      outputs:",
      "        - contract: brief.md",
      '          version: "1.0.0"',
      "      gates:",
      `        autopilot: ${autopilot}`,
      "        review: none",
      "        retry_on_failure: 0",
      "      depends_on: []",
      "",
    ].join("\n"));
    return dir;
  }

  it("is blocked even when the dispatcher can perform it", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: await unattendedPipeline(false),
      dispatcher: writingDispatcher(dir), budget: permissiveBudget,
    });

    const result = await svc.run(REF, "unattended", { stage: "brief" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/autopilot: false/);
    expect(result.value.reason).toMatch(/unattended/);
  });

  it("leases nothing, dispatches nothing and writes nothing", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: await unattendedPipeline(false),
      dispatcher: writingDispatcher(dir), budget: permissiveBudget,
    });

    await svc.run(REF, "unattended", { stage: "brief" });

    await expect(readFile(join(dir, "artifacts", "brief.md"), "utf-8")).rejects.toThrow();
    await expect(readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8")).rejects.toThrow();
  });

  it("runs the same stage once the manifest permits it", async () => {
    // The control: nothing but the flag separates this from the refusal above.
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: await unattendedPipeline(true),
      dispatcher: writingDispatcher(dir), budget: permissiveBudget,
    });

    const result = await svc.run(REF, "unattended", { stage: "brief" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("completed");
  });
});
