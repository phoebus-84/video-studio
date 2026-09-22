import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ExecutionService } from "../../../src/execution/service.js";
import type { StageDispatcher, BudgetGuard } from "../../../src/execution/types.js";
import { parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { ok } from "../../../src/result.js";
import { DEFAULT_ENGINE_CONFIG } from "../../../src/engine/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINES = resolve(__dirname, "../../../../pipelines/pipelines");
const REF = { channel: "childrens", series: "fairy-tales", episode: "ep" };

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

// Controls a mock of @studio/contracts' appendJournalEvent, used only by the
// "dropped stage-leased write" test below (Finding 3), plus the
// "stage-leased write throws" test (task-2 fix round 1) covering the other
// half of the same contract: a malformed event throws instead of returning
// null, and that throw must not leak the lease it was taken under. vi.hoisted
// so the vi.mock factory — which is itself hoisted above these imports — can
// close over it.
const journalMockState = vi.hoisted(() => ({
  dropStageLeased: false,
  dropStageStarted: false,
  /** A terminal event type to drop, or null. */
  dropTerminal: null as null | "stage-completed" | "stage-failed",
  /** Throw instead of writing, standing in for a malformed event. */
  throwStageLeased: false,
}));

vi.mock("@studio/contracts/src/journal.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@studio/contracts/src/journal.mjs")>();
  return {
    ...actual,
    appendJournalEvent: async (episodeDir: string, input: any) => {
      if (input.type === "stage-leased" && journalMockState.throwStageLeased) {
        throw new Error("simulated malformed event: caller bug, not a failed write");
      }
      if (input.type === "stage-leased" && journalMockState.dropStageLeased) {
        return null;
      }
      if (input.type === "stage-started" && journalMockState.dropStageStarted) {
        return null;
      }
      if (input.type === journalMockState.dropTerminal) {
        return null;
      }
      return actual.appendJournalEvent(episodeDir, input);
    },
  };
});

afterEach(() => {
  journalMockState.dropStageLeased = false;
  journalMockState.dropStageStarted = false;
  journalMockState.dropTerminal = null;
  journalMockState.throwStageLeased = false;
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

/** A dispatcher that always throws. */
function failingDispatcher(message = "the renderer died"): StageDispatcher {
  return {
    dispatch: vi.fn(async () => {
      throw new Error(message);
    }),
  };
}

/** A dispatcher that fails its first call, then writes real output on every call after. */
function failThenSucceedDispatcher(dir: string, relative = "artifacts/brief.md"): StageDispatcher {
  let calls = 0;
  return {
    dispatch: vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("the renderer died");
      const file = join(dir, relative);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, "real content");
      return [file];
    }),
  };
}

/** A dispatcher that writes real output, except on the numbered calls given. */
function dispatcherFailingOnCalls(dir: string, failOn: number[], relative = "artifacts/brief.md"): StageDispatcher {
  let calls = 0;
  return {
    dispatch: vi.fn(async () => {
      calls += 1;
      if (failOn.includes(calls)) throw new Error(`call ${calls} died`);
      const file = join(dir, relative);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, "real content");
      return [file];
    }),
  };
}

/** A dispatcher that claims to have written a file outside the episode. */
function escapingDispatcher(): StageDispatcher {
  return {
    dispatch: vi.fn(async () => ["../../outside.txt"]),
  };
}

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

  // Findings 1 & 2 (review, task-3): a failed stage has no direct `failed ->
  // running` transition, only `failed -> pending`. run() used to skip that
  // reset and transition straight to "running", which threw on every call —
  // and since unnamed selection excludes only "completed" stages, it kept
  // re-picking the same failed stage forever, blocking the whole episode.

  it("retries a failed stage instead of deadlocking on the next named attempt", async () => {
    const { root, dir } = await episode();
    const dispatcher = failThenSucceedDispatcher(dir);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher, budget: permissiveBudget, holder: "test/1",
    });

    const first = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.status).toBe("failed");

    // The standard this must meet: a dispatcher that fails once and then
    // succeeds must, on the second call, actually run the stage.
    const second = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.status).toBe("completed");
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(2);
  });

  it("advances past a failed stage through unnamed selection too, rather than blocking the episode forever", async () => {
    const { root, dir } = await episode();
    const dispatcher = failThenSucceedDispatcher(dir);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher, budget: permissiveBudget, holder: "test/1",
    });

    const first = await svc.run(REF, "narrated-illustrated-video");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.stageId).toBe("brief");
    expect(first.value.status).toBe("failed");

    // Before the fix this returned `blocked: "brief" cannot start: Invalid
    // transition: failed -> running` forever, and no other stage in the
    // episode could run either, because unnamed selection kept re-picking
    // "brief" on every call.
    const second = await svc.run(REF, "narrated-illustrated-video");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.stageId).toBe("brief");
    expect(second.value.status).toBe("completed");
  });

  it("stops retrying a stage once it exhausts its attempt limit, rather than spinning forever", async () => {
    const { root } = await episode();
    const dispatcher = failingDispatcher();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher, budget: permissiveBudget, holder: "test/1",
    });

    const attempts: string[] = [];
    for (let i = 0; i < DEFAULT_ENGINE_CONFIG.maxAttempts; i++) {
      const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      attempts.push(result.value.status);
    }
    expect(attempts).toEqual(Array(DEFAULT_ENGINE_CONFIG.maxAttempts).fill("failed"));
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(DEFAULT_ENGINE_CONFIG.maxAttempts);

    // The limit is reached: run() must not dispatch a further attempt.
    const overLimit = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    expect(overLimit.ok).toBe(true);
    if (!overLimit.ok) return;
    expect(overLimit.value.status).toBe("blocked");
    expect(overLimit.value.reason).toContain(`${DEFAULT_ENGINE_CONFIG.maxAttempts} time(s)`);
    expect(overLimit.value.reason).toContain(`limit of ${DEFAULT_ENGINE_CONFIG.maxAttempts}`);
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(DEFAULT_ENGINE_CONFIG.maxAttempts);

    // Unnamed selection must not spin on the exhausted stage either.
    const overLimitUnnamed = await svc.run(REF, "narrated-illustrated-video");
    expect(overLimitUnnamed.ok).toBe(true);
    if (!overLimitUnnamed.ok) return;
    expect(overLimitUnnamed.value.stageId).toBe("brief");
    expect(overLimitUnnamed.value.status).toBe("blocked");
  });

  // The cap is a limit on consecutive failures, not on attempts. Replay
  // pushes an attempt for every stage-leased it reads and never prunes, so
  // counting attempts made a stage that had completed three times and then
  // failed once permanently unrunnable — blocked with "has failed 4 time(s)"
  // when it had failed exactly once, and, because unnamed selection excludes
  // only `completed`, stalling the whole episode on it.

  it("does not count successful runs against the retry limit", async () => {
    const { root, dir } = await episode();
    // Three completions, then one failure, then one more good call.
    const dispatcher = dispatcherFailingOnCalls(dir, [4]);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher, budget: permissiveBudget, holder: "test/1",
    });

    for (let i = 0; i < DEFAULT_ENGINE_CONFIG.maxAttempts; i++) {
      const done = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
      expect(done.ok).toBe(true);
      if (!done.ok) return;
      expect(done.value.status).toBe("completed");
    }

    const failed = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    expect(failed.value.status).toBe("failed");

    // One failure, three successes: this stage is nowhere near its limit.
    const retry = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.value.status).toBe("completed");
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(DEFAULT_ENGINE_CONFIG.maxAttempts + 2);
  });

  it("still stops a stage that fails maxAttempts times in a row after a success", async () => {
    const { root, dir } = await episode();
    // One completion, then nothing but failures: the budget resets once and
    // is then spent in full.
    const dispatcher = dispatcherFailingOnCalls(dir, [2, 3, 4, 5]);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher, budget: permissiveBudget, holder: "test/1",
    });

    const first = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.status).toBe("completed");

    for (let i = 0; i < DEFAULT_ENGINE_CONFIG.maxAttempts; i++) {
      const failed = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
      expect(failed.ok).toBe(true);
      if (!failed.ok) return;
      expect(failed.value.status).toBe("failed");
    }

    const overLimit = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    expect(overLimit.ok).toBe(true);
    if (!overLimit.ok) return;
    expect(overLimit.value.status).toBe("blocked");
    expect(overLimit.value.reason).toContain(`${DEFAULT_ENGINE_CONFIG.maxAttempts} time(s) in a row`);
    // The message states what actually happened: three failures, not four
    // attempts, and the successful one is not counted among them.
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(DEFAULT_ENGINE_CONFIG.maxAttempts + 1);
  });

  // Finding 4 (review, task-3): a dispatcher's declared output was joined
  // onto episodeDir and validated on existence alone, so a relative path that
  // climbs out of the episode (or an absolute one elsewhere on disk) could
  // validate and land in stage-completed.outputs verbatim.

  it("fails a stage whose declared output resolves outside the episode directory", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: escapingDispatcher(), budget: permissiveBudget, holder: "test/1",
    });

    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("failed");
    expect(result.value.reason).toMatch(/outside the episode directory/);

    // Recorded as a failed attempt, not as a completed one carrying an
    // output that escapes the episode.
    const types = (await journal(dir)).map((e: any) => e.type);
    expect(types).toEqual(["stage-leased", "stage-started", "stage-failed"]);
  });

  // Finding 3 (review, task-3): a dropped stage-leased append with
  // stage-started still landing would leave replay looking at a terminal
  // event closing an attempt that was never opened — unrecoverable, since the
  // journal is append-only. run() must check that specific write and stop
  // before dispatching if it did not land.

  it("blocks rather than dispatching when the stage-leased write does not land", async () => {
    const { root, dir } = await episode();
    const dispatcher = writingDispatcher(dir);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher, budget: permissiveBudget, holder: "test/1",
    });

    journalMockState.dropStageLeased = true;
    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    journalMockState.dropStageLeased = false;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/journal write/);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();

    // The lease was released, not left dangling: a later run can lease and
    // dispatch the same stage normally, and the journal carries only the
    // events from that successful attempt.
    const second = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.status).toBe("completed");

    const types = (await journal(dir)).map((e: any) => e.type);
    expect(types).toEqual(["stage-leased", "stage-started", "stage-completed"]);
  });

  it("stops rather than dispatching when the stage-started write is dropped", async () => {
    // The only execution append the service did not check. A dropped
    // stage-started is survivable since replay records the gap, but it is
    // still a lost write, and dispatching after one means knowingly doing work
    // whose record already has a hole. Nothing has run yet at this point, so
    // the lease can be released completely — the same reason the stage-leased
    // rollback is safe, and the reason the terminal appends cannot do it.
    const { root, dir } = await episode();
    const dispatcher = writingDispatcher(dir);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher, budget: permissiveBudget, holder: "test/1", leaseTtlMs: 40,
    });

    journalMockState.dropStageStarted = true;
    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    journalMockState.dropStageStarted = false;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("blocked");
    expect(result.value.reason).toMatch(/journal write/);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();

    // The lease is still held, because the journal says it is. A second run
    // while it is live must be refused — the lockfile and the journal agree.
    const immediate = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    expect(immediate.ok).toBe(true);
    if (!immediate.ok) return;
    expect(immediate.value.status).toBe("blocked");
    expect(immediate.value.reason).toMatch(/already held/);

    // And it becomes claimable again by lapse, not by a release that would
    // have contradicted the log.
    await new Promise((r) => setTimeout(r, 60));
    const later = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    expect(later.ok).toBe(true);
    if (!later.ok) return;
    expect(later.value.status).toBe("completed");

    // The dropped attempt left its lease event and nothing after it — no
    // stage-started, and no terminal event claiming an attempt that never ran.
    const types = (await journal(dir)).map((e: any) => e.type);
    expect(types).toEqual(["stage-leased", "stage-leased", "stage-started", "stage-completed"]);
  });

  // Fix round 1 on task-2 (contracts): appendJournalEvent now THROWS for a
  // malformed event instead of returning null — a caller bug, not a failed
  // write, and the throw must reach the caller. But `claimInternal` takes the
  // lease with `sm.transition(instance, "running")` before this append, and a
  // throw here used to skip the `releaseAll()` that the null-return path
  // already had, leaking the lockfile with no journal event to explain it.
  // This must both release the lease AND keep propagating the throw — the
  // one thing it must never do is turn a code bug into a silent `blocked`.

  it("releases the lease and still throws when the stage-leased write throws", async () => {
    const { root, dir } = await episode();
    const dispatcher = writingDispatcher(dir);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher, budget: permissiveBudget, holder: "test/1",
    });

    journalMockState.throwStageLeased = true;
    await expect(svc.run(REF, "narrated-illustrated-video", { stage: "brief" }))
      .rejects.toThrow(/simulated malformed event/);
    journalMockState.throwStageLeased = false;

    expect(dispatcher.dispatch).not.toHaveBeenCalled();

    // No lockfile left behind — a throw is not a write that could leave one
    // legitimately held, so nothing should remain under `.locks`.
    const locksDir = join(dir, ".locks");
    const locks = await readdir(locksDir).catch(() => []);
    expect(locks).toEqual([]);

    // And the lease was actually released, not just the directory empty by
    // accident: a later run can lease and dispatch the same stage normally.
    const second = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.status).toBe("completed");

    // No trace of the aborted attempt in the journal — the throw happened
    // before anything was recorded.
    const types = (await journal(dir)).map((e: any) => e.type);
    expect(types).toEqual(["stage-leased", "stage-started", "stage-completed"]);
  });

  // The other half of the same gap (final review). `stage-leased` is checked
  // and rolled back; the TERMINAL writes were not checked at all. A dropped
  // `stage-completed` left a stage that ran and produced outputs reported as
  // `completed` by this process and as `running` by every other reader —
  // until the lease lapsed and replay turned it into `failed` with no error
  // recorded anywhere. Nothing can roll back work that happened, so the only
  // honest move is to say so.

  it("reports failure, not completion, when the stage-completed write does not land", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: writingDispatcher(dir), budget: permissiveBudget, holder: "test/1",
    });

    journalMockState.dropTerminal = "stage-completed";
    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    journalMockState.dropTerminal = null;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("failed");
    // The reason names the cause and the consequence: the record is missing,
    // and the stage will run again.
    expect(result.value.reason).toMatch(/did not land/);
    expect(result.value.reason).toMatch(/re-run/);

    // And the journal says exactly what it holds — an attempt still open.
    // The outcome agrees with it, which is the whole point.
    const types = (await journal(dir)).map((e: any) => e.type);
    expect(types).toEqual(["stage-leased", "stage-started"]);

    const status = await svc.status(REF, "narrated-illustrated-video");
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.value.stages.find((s) => s.stageId === "brief")?.state).not.toBe("completed");
  });

  it("reports failure when the stage-failed write does not land", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES,
      dispatcher: failingDispatcher("the renderer died"), budget: permissiveBudget, holder: "test/1",
    });

    journalMockState.dropTerminal = "stage-failed";
    const result = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });
    journalMockState.dropTerminal = null;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("failed");
    expect(result.value.reason).toMatch(/did not land/);
    // The dispatcher's own message survives: it is the one thing `complete`
    // cannot read back out of the journal.
    expect(result.value.reason).toMatch(/the renderer died/);

    const types = (await journal(dir)).map((e: any) => e.type);
    expect(types).toEqual(["stage-leased", "stage-started"]);
  });
});
