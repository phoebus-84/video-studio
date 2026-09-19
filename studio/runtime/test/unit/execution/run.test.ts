import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ExecutionService } from "../../../src/execution/service.js";
import type { StageDispatcher, BudgetGuard } from "../../../src/execution/types.js";
import { parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { ok } from "../../../src/result.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINES = resolve(__dirname, "../../../../pipelines/pipelines");
const REF = { channel: "childrens", series: "fairy-tales", episode: "ep" };

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function episode() {
  const root = await mkdtemp(join(tmpdir(), "exec-run-"));
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

/**
 * A synthetic single-stage pipeline manifest, written to its own temp
 * directory so `builtinPipelines` can point at it in isolation from the real
 * built-in pipelines. One stage, no dependencies, one declared output — the
 * smallest shape the schema (pipeline-manifest.schema.json) accepts, matched
 * against studio/pipelines/pipelines/repository-documentation.yaml.
 */
async function soloPipeline() {
  const dir = await mkdtemp(join(tmpdir(), "exec-pipeline-"));
  roots.push(dir);
  await writeFile(
    join(dir, "solo-stage.yaml"),
    [
      "pipeline:",
      "  id: solo-stage",
      '  version: "1.0.0"',
      "  stages:",
      "    - id: only",
      '      name: "Only Stage"',
      "      type: editorial",
      "      outputs:",
      "        - contract: note.md",
      '          version: "1.0.0"',
      "      depends_on: []",
      "",
    ].join("\n"),
    "utf-8",
  );
  return dir;
}

describe("ExecutionService.run", () => {
  it("claims a stage, dispatches it, and records the attempt", async () => {
    const { root, dir } = await episode();
    const dispatcher = writingDispatcher(dir);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher, budget: permissiveBudget, holder: "test/1",
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stageId).toBe("brief");
    expect(result.value.status).toBe("completed");
    expect(result.value.outputs.length).toBe(1);
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);

    const types = (await journal(dir)).map((e: any) => e.type);
    expect(types).toEqual(["stage-leased", "stage-started", "stage-completed"]);
  });

  it("writes a lease event that names the holder and an expiry", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: writingDispatcher(dir), budget: permissiveBudget, holder: "gateway/pid-9",
    });

    await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    const leased = (await journal(dir)).find((e: any) => e.type === "stage-leased") as any;
    expect(leased.data.holder).toBe("gateway/pid-9");
    expect(leased.data.leaseId).toMatch(/\S/);
    expect(leased.data.attemptNumber).toBe(1);
    expect(Date.parse(leased.data.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("releases the lease once the stage finishes, so it can run again", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: writingDispatcher(dir), budget: permissiveBudget, holder: "test/1",
    });

    await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    const second = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.status).toBe("completed");
    expect(second.value.attemptNumber).toBe(2);
  });

  it("selects the first stage whose dependencies are met when none is named", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: writingDispatcher(dir), budget: permissiveBudget, holder: "test/1",
    });

    const result = await svc.run(REF, "narrated-illustrated-video");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // brief is the only stage with no dependencies in this pipeline.
    expect(result.value.stageId).toBe("brief");
  });

  // NOTE: the brief for this task asserted "reports idle when every stage
  // that could run has run" here, using narrated-illustrated-video with only
  // `brief` completed. That assertion is wrong for this pipeline: `script`
  // depends only on `brief`, so once `brief` completes, `script`'s
  // dependencies ARE met and an unnamed run() selects it — the result would
  // be stageId "script", not idle. Replaced with the two tests below: one
  // that pins down that real advancement behaviour, and one that exercises
  // genuine idleness against a synthetic single-stage pipeline where there is
  // nothing left to advance to.

  it("advances to the next stage once its dependency completes", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: writingDispatcher(dir), budget: permissiveBudget, holder: "test/1",
    });

    const first = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.status).toBe("completed");

    const result = await svc.run(REF, "narrated-illustrated-video");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stageId).toBe("script");
  });

  it("reports idle when no stage is runnable", async () => {
    const { root, dir } = await episode();
    const pipelines = await soloPipeline();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: pipelines,
      dispatcher: writingDispatcher(dir, "artifacts/note.md"),
      budget: permissiveBudget, holder: "test/1",
    });

    const first = await svc.run(REF, "solo-stage", { stage: "only" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.status).toBe("completed");

    const result = await svc.run(REF, "solo-stage");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("idle");
    expect(result.value.stageId).toBeNull();
  });
});
