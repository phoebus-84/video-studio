import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ExecutionService } from "../../../src/execution/service.js";
import type { StageDispatcher, BudgetGuard } from "../../../src/execution/types.js";
import { JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { ok, err } from "../../../src/result.js";
import { DEFAULT_ENGINE_CONFIG } from "../../../src/engine/types.js";

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

  it("reports would-run, not completed, so a loop over run() terminates", async () => {
    // The loop the service is built for — call run() until it stops
    // advancing — never terminates if a dry run claims the stage completed:
    // nothing is journaled, so the same stage is selected and reported
    // complete on every pass, forever.
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: writingDispatcher(dir), budget: permissiveBudget,
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief", dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("would-run");
    expect(result.value.status).not.toBe("completed");
  });

  it("sees the retry cap, and blocks for the same reason a real call gives", async () => {
    // A dry run exists to answer the same question the real call answers.
    // The cap check used to sit below the dry-run return, so a dry run of a
    // retry-exhausted stage said it would have dispatched while the real
    // call refused.
    const { root } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: { dispatch: async () => { throw new Error("the renderer died"); } },
      budget: permissiveBudget,
    });

    for (let i = 0; i < DEFAULT_ENGINE_CONFIG.maxAttempts; i++) {
      await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    }

    const dry = await svc.run(REF, "narrated-illustrated-video", { stage: "brief", dryRun: true });
    const real = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(dry.ok && real.ok).toBe(true);
    if (!dry.ok || !real.ok) return;
    expect(dry.value.status).toBe("blocked");
    expect(dry.value.reason).toBe(real.value.reason);
    expect(dry.value.reason).toMatch(/retry limit/);
    expect(dry.value.dryRun).toBe(true);
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

// ── planRerun ────────────────────────────────────────────────────────────
//
// `cmdRerun` refuses `rerun-affected-downstream` by name before ever calling
// the service, so no CLI-driven test can reach `ExecutionService.planRerun`'s
// own refusal for that mode. This calls the service directly, the way a
// non-CLI caller (Task 7's gateway route) will.

describe("planRerun", () => {
  it("reports MODE_UNSUPPORTED, not STAGE_UNKNOWN, for rerun-affected-downstream", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: writingDispatcher(dir), budget: permissiveBudget,
    });

    const result = await svc.planRerun(REF, "narrated-illustrated-video", "rerun-affected-downstream");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Not STAGE_UNKNOWN: no stage is unknown here — no stage id was even
    // named — a mode this build does not implement is a different fact,
    // and the wrong code would send a caller looking for a typo in a
    // stage id that was never the problem.
    expect(result.error.code).toBe("MODE_UNSUPPORTED");
    expect(result.error.message).toMatch(/staleness/i);
  });

  it("plans full-rebuild without a dispatcher or budget guard configured", async () => {
    // planRerun only replays and plans; it must not require the ports that
    // run() needs to actually dispatch.
    const { root } = await episode();
    const svc = new ExecutionService({ libraryRoot: root, builtinPipelines: PIPELINES });

    const result = await svc.planRerun(REF, "narrated-illustrated-video", "full-rebuild");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rerunStageIds).toContain("brief");
    expect(result.value.episodeSlug).toBe("childrens/fairy-tales/ep");
  });
});
