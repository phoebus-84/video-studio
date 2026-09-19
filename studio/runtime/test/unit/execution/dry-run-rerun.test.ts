import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ExecutionService } from "../../../src/execution/service.js";
import type { StageDispatcher, BudgetGuard } from "../../../src/execution/types.js";
import { JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { ok, err } from "../../../src/result.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINES = resolve(__dirname, "../../../../pipelines/pipelines");
const REF = { channel: "childrens", series: "fairy-tales", episode: "ep" };

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function episode() {
  const root = await mkdtemp(join(tmpdir(), "exec-dryrun-rerun-"));
  roots.push(root);
  const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
  await mkdir(join(dir, "journal"), { recursive: true });
  await mkdir(join(dir, "artifacts"), { recursive: true });
  return { root, dir };
}

/** A dispatcher that writes the file it claims to have written. */
function writingDispatcher(dir: string, relative = "artifacts/brief.md"): StageDispatcher {
  return {
    dispatch: vi.fn(async () => {
      const file = join(dir, relative);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, "real content");
      return [file];
    }),
  };
}

const permissiveBudget: BudgetGuard = {
  maySpend: async () => ok({ reserveId: "r1", estimatedCost: 0 }),
};

describe("dry run", () => {
  it("writes nothing and dispatches nothing", async () => {
    const { root, dir } = await episode();
    const dispatcher = writingDispatcher(dir);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES, dispatcher, budget: permissiveBudget,
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief", dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dryRun).toBe(true);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    await expect(readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8")).rejects.toThrow();
  });

  it("still reports a gate refusal, so it answers the same question as a real run", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES, dispatcher: writingDispatcher(dir),
      budget: { maySpend: async () => err({ code: "OVER_LIMIT", message: "no funds remain" }) },
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief", dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/no funds remain/);
  });

  it("takes no lease, so a real run immediately after is unaffected", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: writingDispatcher(dir), budget: permissiveBudget,
    });

    await svc.run(REF, "narrated-illustrated-video", { stage: "brief", dryRun: true });
    const real = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(real.ok).toBe(true);
    if (!real.ok) return;
    expect(real.value.status).toBe("completed");
  });

  it("reports a dependency refusal, not just a budget one, and still writes nothing", async () => {
    const { root, dir } = await episode();
    const dispatcher = writingDispatcher(dir);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES, dispatcher, budget: permissiveBudget,
    });

    // "script" depends on "brief", which has never run in this episode.
    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "script", dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/brief/);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    await expect(readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8")).rejects.toThrow();
  });
});

describe("rerun", () => {
  it("runs a completed stage again and records a second attempt", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: writingDispatcher(dir), budget: permissiveBudget,
    });
    await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    const result = await svc.rerun(REF, "narrated-illustrated-video", ["brief"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.status).toBe("completed");
    expect(result.value[0]!.attemptNumber).toBe(2);

    const status = await svc.status(REF, "narrated-illustrated-video");
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.value.stages.find((s) => s.stageId === "brief")!.attempts).toBe(2);
  });

  it("refuses a stage the pipeline does not declare", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: writingDispatcher(dir), budget: permissiveBudget,
    });

    const result = await svc.rerun(REF, "narrated-illustrated-video", ["no-such-stage"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STAGE_UNKNOWN");
  });

  it("runs nothing when a later id in the list is a typo", async () => {
    const { root, dir } = await episode();
    const dispatcher = writingDispatcher(dir);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher, budget: permissiveBudget,
    });
    await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    vi.mocked(dispatcher.dispatch).mockClear();

    const result = await svc.rerun(REF, "narrated-illustrated-video", ["brief", "no-such-stage"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STAGE_UNKNOWN");
    expect(result.error.message).toMatch(/no-such-stage/);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();

    const status = await svc.status(REF, "narrated-illustrated-video");
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.value.stages.find((s) => s.stageId === "brief")!.attempts).toBe(1);
  });

  it("keeps the outcomes of earlier stages when a later one blocks", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: writingDispatcher(dir), budget: permissiveBudget,
    });
    await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    // "art-direction" depends on "script", which has never run — the second
    // rerun in this list is a soft failure (blocked), not a hard error.
    const result = await svc.rerun(REF, "narrated-illustrated-video", ["brief", "art-direction"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value[0]!.stageId).toBe("brief");
    expect(result.value[0]!.status).toBe("completed");
    expect(result.value[1]!.stageId).toBe("art-direction");
    expect(result.value[1]!.status).toBe("blocked");
    expect(result.value[1]!.reason).toMatch(/script/);
  });
});
