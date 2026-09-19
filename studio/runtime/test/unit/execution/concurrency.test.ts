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

describe("lease takeover", () => {
  // A leases a stage with a short TTL and overruns. B finds the lease
  // expired, reclaims it, and runs the stage to completion. A then returns.
  // If A appends a terminal event for its stale lease at that point, replay
  // sees a completed stage being failed — `Stage "brief" cannot go from
  // completed to failed` — and because the journal is append-only it throws
  // on every replay from then on: status() and run() return REPLAY_INVALID
  // for the life of the episode. A lapsed attempt must therefore write
  // nothing at all.

  /** A dispatcher that takes `ms` and then writes real output. */
  function slowWriter(dir: string, ms: number): StageDispatcher {
    return {
      dispatch: async () => {
        await new Promise((r) => setTimeout(r, ms));
        const file = join(dir, "artifacts", "brief.md");
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, "A's late content");
        return [file];
      },
    };
  }

  it("leaves the episode replayable when the overrun holder returns after the new one finished", async () => {
    const { root, dir } = await episode();
    const opts = { libraryRoot: root, builtinPipelines: PIPELINES, budget: permissiveBudget };
    const a = new ExecutionService({ ...opts, dispatcher: slowWriter(dir, 250), holder: "A", leaseTtlMs: 25 });
    const b = new ExecutionService({ ...opts, dispatcher: writingDispatcher(dir), holder: "B" });

    const aRun = a.run(REF, "narrated-illustrated-video", { stage: "brief" });
    // Let A's lease lapse, then let B take the stage over and finish it —
    // so A's write, if it made one, would land after B's stage-completed.
    await new Promise((r) => setTimeout(r, 60));
    const rb = await b.run(REF, "narrated-illustrated-video", { stage: "brief" });
    const ra = await aRun;

    expect(rb.ok).toBe(true);
    if (!rb.ok) return;
    expect(rb.value.status).toBe("completed");

    expect(ra.ok).toBe(true);
    if (!ra.ok) return;
    expect(ra.value.status).toBe("failed");
    expect(ra.value.reason).toMatch(/lease/i);

    // A contributed nothing after its lease lapsed: B's attempt is the last
    // word in the journal.
    const types = (await journal(dir)).map((e: any) => e.type);
    expect(types).toEqual([
      "stage-leased", "stage-started", "stage-leased", "stage-started", "stage-completed",
    ]);

    // The point of the whole exercise: the episode is still replayable.
    const status = await b.status(REF, "narrated-illustrated-video");
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.value.stages.find((s) => s.stageId === "brief")!.status).toBe("completed");
  });

  it("writes nothing either when the overrun holder throws after losing its lease", async () => {
    const { root, dir } = await episode();
    const opts = { libraryRoot: root, builtinPipelines: PIPELINES, budget: permissiveBudget };
    const throwsLate: StageDispatcher = {
      dispatch: async () => {
        await new Promise((r) => setTimeout(r, 250));
        throw new Error("the renderer died, eventually");
      },
    };
    const a = new ExecutionService({ ...opts, dispatcher: throwsLate, holder: "A", leaseTtlMs: 25 });
    const b = new ExecutionService({ ...opts, dispatcher: writingDispatcher(dir), holder: "B" });

    const aRun = a.run(REF, "narrated-illustrated-video", { stage: "brief" });
    await new Promise((r) => setTimeout(r, 60));
    await b.run(REF, "narrated-illustrated-video", { stage: "brief" });
    const ra = await aRun;

    expect(ra.ok).toBe(true);
    if (!ra.ok) return;
    expect(ra.value.status).toBe("failed");
    // The dispatcher's own error is still reported to A's caller; it is only
    // the journal that stays silent.
    expect(ra.value.reason).toMatch(/the renderer died, eventually/);

    const types = (await journal(dir)).map((e: any) => e.type);
    expect(types).toEqual([
      "stage-leased", "stage-started", "stage-leased", "stage-started", "stage-completed",
    ]);

    const status = await b.status(REF, "narrated-illustrated-video");
    expect(status.ok).toBe(true);
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
