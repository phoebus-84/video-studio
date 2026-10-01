// ---------------------------------------------------------------------------
// Candidates and atomic take selection (avg-qr4.6)
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionService } from "../../../src/execution/service.js";
import type { StageDispatcher } from "../../../src/execution/types.js";
import { JournalReviewGate } from "../../../src/execution/journal-review-gate.js";
import { ok } from "../../../src/result.js";
import { reviewChainPipeline } from "./helpers/review-chain.js";
import { parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { verifyReceipt } from "@studio/contracts/src/receipt.mjs";

const REF = { channel: "childrens", series: "fairy-tales", episode: "ep" };
const KEY = "operator-key-for-tests";
const budget = { maySpend: async () => ok({ reserveId: "r", estimatedCost: 0 }) };

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (r) => {
    // Kept candidates are read-only; make them removable again.
    await chmodTree(r).catch(() => undefined);
    await rm(r, { recursive: true, force: true });
  }));
});

async function chmodTree(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) await chmodTree(p);
    else await chmod(p, 0o644);
  }
}

/**
 * Writes `artifacts/<stage>.md` holding "take <n>", n counting every dispatch
 * of that stage — so each attempt's bytes differ and can be told apart.
 * `frames` makes `upstream` write a directory of `frames` files instead and
 * report the directory, as a performer of an `illustrations/` contract may —
 * or, with `filesOnly`, each frame it wrote, as the illustrations adapter does.
 */
function writer(dir: string, frames?: () => number, filesOnly = false): StageDispatcher {
  const counts = new Map<string, number>();
  return {
    dispatch: async (stage) => {
      const id = stage.definition.id;
      const n = (counts.get(id) ?? 0) + 1;
      counts.set(id, n);
      if (frames && id === "upstream") {
        const framesDir = join(dir, "artifacts", "frames");
        await mkdir(framesDir, { recursive: true });
        const written: string[] = [];
        for (let i = 1; i <= frames(); i++) {
          written.push(join(framesDir, `f${i}.png`));
          await writeFile(written.at(-1)!, `take ${n} frame ${i}`);
        }
        return filesOnly ? written : [framesDir];
      }
      const file = join(dir, "artifacts", `${id}.md`);
      await writeFile(file, `take ${n}`);
      return [file];
    },
  };
}

async function setup(opts: { operatorKey?: string | null; frames?: () => number; filesOnly?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "exec-takes-"));
  roots.push(root);
  const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
  await mkdir(join(dir, "artifacts"), { recursive: true });
  const pipelines = await reviewChainPipeline(roots);
  const operatorKey = opts.operatorKey === undefined ? KEY : opts.operatorKey;
  const make = (key: string | null) => new ExecutionService({
    libraryRoot: root, builtinPipelines: pipelines,
    dispatcher: writer(dir, opts.frames, opts.filesOnly), budget, review: new JournalReviewGate(key), operatorKey: key,
  });
  return { root, dir, svc: make(operatorKey), make };
}

/** The payload fields these tests read, across the event types they read them from. */
interface Recorded {
  digests?: { path: string; sha256: string }[];
  outputs?: string[];
  selected?: boolean;
  origin?: string;
  trigger?: string;
  affected?: { stageId: string }[];
  binding?: { attemptNumber: number; outputs: { path: string }[] };
}
const data = (event: { data?: unknown }): Recorded => (event.data ?? {}) as Recorded;

async function journal(dir: string) {
  return parseJournal(await readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8"), { strict: true });
}
const read = (dir: string, rel: string) => readFile(join(dir, rel), "utf-8");

describe("a completion keeps its candidate", () => {
  it("copies the outputs under attempts/<stage>/<n>/, read-only, and records their digests", async () => {
    const { svc, dir } = await setup();
    const out = await svc.run(REF, "review-chain", { stage: "upstream" });
    expect(out.ok && out.value.status).toBe("completed");

    const kept = join(dir, "attempts", "upstream", "1", "artifacts", "upstream.md");
    expect(await readFile(kept, "utf-8")).toBe("take 1");
    expect((await stat(kept)).mode & 0o222).toBe(0);

    const done = (await journal(dir)).find((e) => e.type === "stage-completed")!;
    expect(data(done).digests).toEqual([{ path: "artifacts/upstream.md", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
    expect(data(done).selected).toBeUndefined();

    const status = await svc.status(REF, "review-chain");
    const upstream = status.ok && status.value.stages.find((s) => s.stageId === "upstream");
    expect(upstream && upstream.take).toEqual({ attemptNumber: 1, origin: "policy", locked: false });
  });

  it("expands a directory output into the files inside it", async () => {
    const { svc, dir } = await setup({ frames: () => 2 });
    await svc.run(REF, "review-chain", { stage: "upstream" });
    const done = (await journal(dir)).find((e) => e.type === "stage-completed")!;
    expect(data(done).outputs).toEqual(["artifacts/frames"]);
    expect(data(done).digests?.map((d) => d.path)).toEqual(["artifacts/frames/f1.png", "artifacts/frames/f2.png"]);
  });

  it("keeps the earlier take when the stage runs again", async () => {
    const { svc, dir } = await setup();
    await svc.run(REF, "review-chain", { stage: "upstream" });
    await svc.run(REF, "review-chain", { stage: "upstream" });
    expect(await read(dir, "artifacts/upstream.md")).toBe("take 2");
    expect(await read(dir, "attempts/upstream/1/artifacts/upstream.md")).toBe("take 1");
    const takes = await svc.takes(REF, "review-chain");
    const upstream = takes.ok && takes.value.stages.find((s) => s.stageId === "upstream")!;
    expect(upstream && upstream.candidates.map((c) => [c.attemptNumber, c.selected])).toEqual([[1, false], [2, true]]);
  });
});

describe("ExecutionService.select", () => {
  it("puts an earlier take back in place and records it", async () => {
    const { svc, dir } = await setup();
    await svc.run(REF, "review-chain", { stage: "upstream" });
    await svc.run(REF, "review-chain", { stage: "upstream" });

    const out = await svc.select(REF, "review-chain", "upstream", { attemptNumber: 1, expected: 2, principal: "agent" });
    expect(out.ok && out.value.status).toBe("selected");
    expect(await read(dir, "artifacts/upstream.md")).toBe("take 1");

    const selected = (await journal(dir)).filter((e) => e.type === "take-selected").at(-1)!;
    expect(selected.data).toMatchObject({ stageId: "upstream", decision: "selected", origin: "agent", previous: 2 });
    expect(data(selected).binding?.attemptNumber).toBe(1);
  });

  // A performer that reports a DIRECTORY gets everything in it as its
  // candidate, leftovers from an earlier take included: nothing can tell them
  // apart. One that names the files it wrote — the illustrations adapter —
  // gets exactly those, and the files only the displaced take had go.
  it("removes files only the displaced take had", async () => {
    let count = 3;
    const { svc, dir } = await setup({ frames: () => count, filesOnly: true });
    await svc.run(REF, "review-chain", { stage: "upstream" });
    count = 2;
    await svc.run(REF, "review-chain", { stage: "upstream" });
    // The second attempt wrote two frames; the run's own cleanup removed the
    // third that only the first take had.
    expect((await readdir(join(dir, "artifacts", "frames"))).sort()).toEqual(["f1.png", "f2.png"]);

    await svc.select(REF, "review-chain", "upstream", { attemptNumber: 1, principal: "agent" });
    expect((await readdir(join(dir, "artifacts", "frames"))).sort()).toEqual(["f1.png", "f2.png", "f3.png"]);
    await svc.select(REF, "review-chain", "upstream", { attemptNumber: 2, principal: "agent" });
    expect((await readdir(join(dir, "artifacts", "frames"))).sort()).toEqual(["f1.png", "f2.png"]);
    expect(await read(dir, "artifacts/frames/f1.png")).toBe("take 2 frame 1");
  });

  it("refuses when the selected take changed since the caller looked", async () => {
    const { svc, dir } = await setup();
    await svc.run(REF, "review-chain", { stage: "upstream" });
    await svc.run(REF, "review-chain", { stage: "upstream" });
    const before = (await journal(dir)).length;

    const out = await svc.select(REF, "review-chain", "upstream", { attemptNumber: 1, expected: 1, principal: "agent" });
    expect(out.ok && out.value.status).toBe("blocked");
    expect(out.ok && out.value.reason).toMatch(/is attempt 2, not attempt 1: it changed since it was read/);
    expect((await journal(dir)).length).toBe(before);
    expect(await read(dir, "artifacts/upstream.md")).toBe("take 2");
  });

  it("refuses an attempt that left no candidate", async () => {
    const { svc } = await setup();
    await svc.run(REF, "review-chain", { stage: "upstream" });
    const out = await svc.select(REF, "review-chain", "upstream", { attemptNumber: 7, principal: "agent" });
    expect(out.ok && out.value.reason).toMatch(/no candidate from attempt 7/);
  });

  it("refuses a candidate whose kept files changed, before touching anything", async () => {
    const { svc, dir } = await setup();
    await svc.run(REF, "review-chain", { stage: "upstream" });
    await svc.run(REF, "review-chain", { stage: "upstream" });
    const kept = join(dir, "attempts", "upstream", "1", "artifacts", "upstream.md");
    await chmod(kept, 0o644);
    await writeFile(kept, "tampered");

    const out = await svc.select(REF, "review-chain", "upstream", { attemptNumber: 1, principal: "agent" });
    expect(out.ok && out.value.status).toBe("blocked");
    expect(out.ok && out.value.reason).toMatch(/has changed since it was recorded/);
    expect(await read(dir, "artifacts/upstream.md")).toBe("take 2");
  });

  it("refuses while the stage is leased", async () => {
    const { svc } = await setup();
    await svc.run(REF, "review-chain", { stage: "upstream" });
    const claimed = await svc.claim(REF, "review-chain", { stage: "upstream" });
    expect(claimed.ok && claimed.value.status).toBe("claimed");
    const out = await svc.select(REF, "review-chain", "upstream", { attemptNumber: 1, principal: "agent" });
    expect(out.ok && out.value.reason).toMatch(/held by a run/);
  });

  it("marks the stage's dependents stale when the take changes", async () => {
    const { svc, dir } = await setup();
    await svc.run(REF, "review-chain", { stage: "upstream" });
    await svc.run(REF, "review-chain", { stage: "upstream" });
    await svc.select(REF, "review-chain", "upstream", { attemptNumber: 1, principal: "agent" });
    const marked = (await journal(dir)).filter((e) => e.type === "staleness-marked").at(-1)!;
    expect(data(marked).trigger).toBe("upstream");
    expect(data(marked).affected?.map((a) => a.stageId)).toContain("gated");
  });

  it("writes nothing when the take is already selected, and restores drifted files", async () => {
    const { svc, dir } = await setup();
    await svc.run(REF, "review-chain", { stage: "upstream" });
    await writeFile(join(dir, "artifacts", "upstream.md"), "edited by hand");

    const takes = await svc.takes(REF, "review-chain");
    expect(takes.ok && takes.value.stages.find((s) => s.stageId === "upstream")!.drifted).toEqual(["artifacts/upstream.md"]);

    const before = (await journal(dir)).length;
    const out = await svc.select(REF, "review-chain", "upstream", { attemptNumber: 1, principal: "agent" });
    expect(out.ok && out.value.reason).toMatch(/already selected; its files are in place/);
    expect((await journal(dir)).length).toBe(before);
    expect(await read(dir, "artifacts/upstream.md")).toBe("take 1");
  });

  it("asks for review of a newly selected take on a reviewed stage", async () => {
    const { svc, dir } = await setup();
    await svc.run(REF, "review-chain", { stage: "upstream" });
    await svc.run(REF, "review-chain", { stage: "gated" });
    await svc.review(REF, "review-chain", "gated", { decision: "approved", principal: "operator" });
    await svc.run(REF, "review-chain", { stage: "gated" });

    const out = await svc.select(REF, "review-chain", "gated", { attemptNumber: 1, principal: "agent" });
    expect(out.ok && out.value.status).toBe("selected");
    const last = (await journal(dir)).filter((e) => e.type !== "staleness-marked").at(-1)!;
    expect(last.type).toBe("approval-requested");
    expect(data(last).binding?.outputs[0]?.path).toBe("artifacts/gated.md");
  });
});

describe("an operator's selection is a lock", () => {
  async function locked() {
    const ctx = await setup();
    await ctx.svc.run(REF, "review-chain", { stage: "upstream" });
    await ctx.svc.run(REF, "review-chain", { stage: "upstream" });
    const out = await ctx.svc.select(REF, "review-chain", "upstream", { attemptNumber: 1, principal: "operator" });
    expect(out.ok && out.value.status).toBe("selected");
    return ctx;
  }

  it("is signed with the operator key", async () => {
    const { dir } = await locked();
    const selected = (await journal(dir)).filter((e) => e.type === "take-selected").at(-1)!;
    expect(data(selected).origin).toBe("human");
    expect(verifyReceipt(selected.data as object, KEY)).toBe(true);
  });

  it("cannot be displaced by an agent", async () => {
    const { svc, dir } = await locked();
    const out = await svc.select(REF, "review-chain", "upstream", { attemptNumber: 2, principal: "agent" });
    expect(out.ok && out.value.reason).toMatch(/the operator selected attempt 1 of "upstream"; only the operator can change it/);
    expect(await read(dir, "artifacts/upstream.md")).toBe("take 1");
  });

  it("keeps a later attempt as a candidate and puts the locked take back", async () => {
    const { svc, dir } = await locked();
    const out = await svc.run(REF, "review-chain", { stage: "upstream" });
    expect(out.ok && out.value.status).toBe("completed");
    expect(out.ok && out.value.reason).toMatch(/attempt 3 was kept as a candidate; the operator's take, attempt 1, stays selected/);
    expect(await read(dir, "artifacts/upstream.md")).toBe("take 1");
    expect(await read(dir, "attempts/upstream/3/artifacts/upstream.md")).toBe("take 3");
    const done = (await journal(dir)).filter((e) => e.type === "stage-completed").at(-1)!;
    expect(data(done).selected).toBe(false);

    const status = await svc.status(REF, "review-chain");
    const upstream = status.ok && status.value.stages.find((s) => s.stageId === "upstream");
    expect(upstream && upstream.take).toEqual({ attemptNumber: 1, origin: "human", locked: true });
  });

  it("holds in a composition with no key to verify it — failing closed", async () => {
    const { make, dir } = await locked();
    const keyless = make(null);
    await keyless.run(REF, "review-chain", { stage: "upstream" });
    expect(await read(dir, "artifacts/upstream.md")).toBe("take 1");
  });

  it("can be changed by the operator", async () => {
    const { svc, dir } = await locked();
    const out = await svc.select(REF, "review-chain", "upstream", { attemptNumber: 2, expected: 1, principal: "operator" });
    expect(out.ok && out.value.status).toBe("selected");
    expect(await read(dir, "artifacts/upstream.md")).toBe("take 2");
  });

  it("cannot be recorded without an operator key to sign it", async () => {
    const { svc } = await setup({ operatorKey: null });
    await svc.run(REF, "review-chain", { stage: "upstream" });
    const out = await svc.select(REF, "review-chain", "upstream", { attemptNumber: 1, principal: "operator" });
    expect(out.ok && out.value.reason).toMatch(/no operator key is configured/);
  });

  it("binds an operator's approval to the locked take, not the latest attempt", async () => {
    const { svc, dir } = await setup();
    await svc.run(REF, "review-chain", { stage: "upstream" });
    await svc.run(REF, "review-chain", { stage: "gated" });
    await svc.run(REF, "review-chain", { stage: "gated" });
    await svc.select(REF, "review-chain", "gated", { attemptNumber: 1, principal: "operator" });
    await svc.run(REF, "review-chain", { stage: "gated" });

    const out = await svc.review(REF, "review-chain", "gated", { decision: "approved", principal: "operator" });
    expect(out.ok && out.value.status).toBe("approved");
    const status = await svc.status(REF, "review-chain");
    expect(status.ok && status.value.stages.find((s) => s.stageId === "gated")!.state).toBe("completed");
    expect(await read(dir, "artifacts/gated.md")).toBe("take 1");
  });
});
