import { afterEach, describe, expect, it } from "vitest";
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
  const root = await mkdtemp(join(tmpdir(), "exec-concurrency-"));
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

describe("two services over one episode", () => {
  it("lets exactly one of them run a stage", async () => {
    // The gateway and the CLI genuinely run at the same time. The lockfile is
    // what decides; the journal only records the decision.
    const { root, dir } = await episode();
    const slow: StageDispatcher = {
      dispatch: async () => {
        await new Promise((r) => setTimeout(r, 120));
        const file = join(dir, "artifacts", "brief.md");
        await writeFile(file, "content");
        return [file];
      },
    };
    const opts = { libraryRoot: root, builtinPipelines: PIPELINES, budget: permissiveBudget };
    const a = new ExecutionService({ ...opts, dispatcher: slow, holder: "A" });
    const b = new ExecutionService({ ...opts, dispatcher: slow, holder: "B" });

    const [ra, rb] = await Promise.all([
      a.run(REF, "narrated-illustrated-video", { stage: "brief" }),
      b.run(REF, "narrated-illustrated-video", { stage: "brief" }),
    ]);

    const statuses = [ra, rb].map((r) => (r.ok ? r.value.status : "error"));
    expect(statuses.filter((s) => s === "completed")).toHaveLength(1);
    expect(statuses.filter((s) => s === "blocked")).toHaveLength(1);
  });

  it("records only the winner's attempt in the journal", async () => {
    const { root, dir } = await episode();
    const slow: StageDispatcher = {
      dispatch: async () => {
        await new Promise((r) => setTimeout(r, 120));
        const file = join(dir, "artifacts", "brief.md");
        await writeFile(file, "content");
        return [file];
      },
    };
    const opts = { libraryRoot: root, builtinPipelines: PIPELINES, budget: permissiveBudget };
    const a = new ExecutionService({ ...opts, dispatcher: slow, holder: "A" });
    const b = new ExecutionService({ ...opts, dispatcher: slow, holder: "B" });

    await Promise.all([
      a.run(REF, "narrated-illustrated-video", { stage: "brief" }),
      b.run(REF, "narrated-illustrated-video", { stage: "brief" }),
    ]);

    const leases = (await journal(dir)).filter((e: any) => e.type === "stage-leased");
    expect(leases).toHaveLength(1);
  });
});

describe("restart", () => {
  it("derives the same state a fresh service sees after a crash mid-stage", async () => {
    const { root, dir } = await episode();
    // A dispatcher that never returns stands in for a process that died: the
    // lease and start are journaled, no terminal event ever is.
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES, budget: permissiveBudget,
      leaseTtlMs: 40,
      dispatcher: { dispatch: async () => { await new Promise((r) => setTimeout(r, 90)); return []; } },
    });
    await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    // A fresh service, after the lease has expired.
    const fresh = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES, budget: permissiveBudget,
      dispatcher: writingDispatcher(dir), holder: "fresh",
    });

    const status = await fresh.status(REF, "narrated-illustrated-video");
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    const brief = status.value.stages.find((s) => s.stageId === "brief")!;
    expect(brief.lease.state).not.toBe("live");

    // And the stage is runnable again rather than stuck.
    const again = await fresh.run(REF, "narrated-illustrated-video", { stage: "brief" });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.status).toBe("completed");
  });
});

describe("package surface", () => {
  it("exports the service from @studio/runtime", async () => {
    const mod = await import("../../../src/index.js");
    expect(typeof (mod as Record<string, unknown>).ExecutionService).toBe("function");
  });
});
