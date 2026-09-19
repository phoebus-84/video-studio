import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile, appendFile } from "node:fs/promises";
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

/** Append a raw journal line, as the writer would have produced it. */
async function journalLine(dir: string, type: string, data: Record<string, unknown>) {
  const event = {
    apiVersion: "studio.video/v1alpha1",
    kind: "JournalEvent",
    id: `evt_${"0".repeat(26)}`,
    episodeRef: REF,
    at: new Date().toISOString(),
    actor: "runtime",
    type,
    data,
  };
  await appendFile(join(dir, "journal", "events.jsonl"), `${JSON.stringify(event)}\n`, "utf-8");
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
  it("derives failed from lease timing alone, with no terminal event ever written, and a fresh service can run the stage again", async () => {
    const { root, dir } = await episode();
    // A real crash leaves exactly this in the journal: a lease and a start,
    // and nothing that closes the attempt — the log is append-only, so no
    // later event can retroactively record what a dead process never
    // reported. expiresAt is already in the past, so a fresh service must
    // derive "failed" purely from lease-timing during replay (execution-state
    // .mjs's closeIfExpired), not from any recorded outcome.
    await journalLine(dir, "stage-leased", {
      stageId: "brief", leaseId: "L1", attemptNumber: 1,
      ttlMs: 1, expiresAt: "2000-01-01T00:00:00Z", holder: "dead-process",
    });
    await journalLine(dir, "stage-started", { stageId: "brief", leaseId: "L1", attemptNumber: 1 });

    const fresh = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES, budget: permissiveBudget,
      dispatcher: writingDispatcher(dir), holder: "fresh",
    });

    const status = await fresh.status(REF, "narrated-illustrated-video");
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    const brief = status.value.stages.find((s) => s.stageId === "brief")!;
    expect(brief.status).toBe("failed");
    expect(brief.lease.state).not.toBe("live");

    // The journal still carries no terminal event for this attempt: the
    // "failed" verdict came from replay's lease-timing logic, not from a
    // recorded outcome.
    const types = (await journal(dir)).map((e: any) => e.type);
    expect(types).toEqual(["stage-leased", "stage-started"]);

    // And the stage is runnable again rather than stuck, recording a new
    // attempt.
    const again = await fresh.run(REF, "narrated-illustrated-video", { stage: "brief" });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.status).toBe("completed");

    const finalTypes = (await journal(dir)).map((e: any) => e.type);
    expect(finalTypes).toEqual([
      "stage-leased", "stage-started", "stage-leased", "stage-started", "stage-completed",
    ]);
  });
});

describe("package surface", () => {
  it("exports the service from @studio/runtime", async () => {
    const mod = await import("../../../src/index.js");
    expect(typeof (mod as Record<string, unknown>).ExecutionService).toBe("function");
    expect(typeof (mod as Record<string, unknown>).dependenciesMet).toBe("function");
  });
});
