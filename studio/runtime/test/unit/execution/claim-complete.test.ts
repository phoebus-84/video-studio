import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ExecutionService } from "../../../src/execution/service.js";
import type { BudgetGuard, ExecutionServiceOptions } from "../../../src/execution/types.js";
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
  const root = await mkdtemp(join(tmpdir(), "exec-claim-"));
  roots.push(root);
  const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
  await mkdir(join(dir, "journal"), { recursive: true });
  await mkdir(join(dir, "artifacts"), { recursive: true });
  return { root, dir };
}

async function journal(dir: string) {
  return parseJournal(await readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8"));
}

const permissiveBudget: BudgetGuard = {
  maySpend: async () => ok({ reserveId: "r1", estimatedCost: 0 }),
};

function service(root: string, extra: Partial<ExecutionServiceOptions> = {}) {
  return new ExecutionService({
    libraryRoot: root,
    builtinPipelines: PIPELINES,
    budget: permissiveBudget,
    ...extra,
  });
}

describe("claiming a stage for an out-of-process performer", () => {
  it("leases and starts the stage without any dispatcher configured", async () => {
    const { root, dir } = await episode();
    const svc = service(root);

    const outcome = await svc.claim(REF, "narrated-illustrated-video");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.status).toBe("claimed");
    expect(outcome.value.stageId).toBe("brief");
    expect(outcome.value.leaseId).toBeTruthy();
    expect(outcome.value.expiresAt).toBeTruthy();

    const events = await journal(dir);
    expect(events.map((e) => e.type)).toEqual(["stage-leased", "stage-started"]);
  });

  it("refuses a second claim while the first is live", async () => {
    const { root, dir } = await episode();
    const svc = service(root);

    const first = await svc.claim(REF, "narrated-illustrated-video");
    const second = await svc.claim(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(first.ok && first.value.status).toBe("claimed");
    expect(second.ok && second.value.status).toBe("blocked");
    // Refused because the stage is held, not for some unrelated reason: a
    // bare `blocked` here would pass even if the second claim had tripped a
    // gate that has nothing to do with the live lease.
    expect(second.ok && second.value.reason).toMatch(/already held|current state/);

    // And the refusal wrote nothing. Only the first claim is in the journal.
    const events = await journal(dir);
    expect(events.map((e) => e.type)).toEqual(["stage-leased", "stage-started"]);
  });

  it("applies every gate a run applies, so a claim cannot skip one", async () => {
    // `scene-plan` declares autopilot: false and depends on nothing, so the
    // attendance gate is the first one it reaches. A claim must refuse it for
    // the same reason a run does: the service has no way to know a person is
    // present.
    const { root, dir } = await episode();
    const svc = service(root);

    const outcome = await svc.claim(REF, "blender-animation", { stage: "scene-plan" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.status).toBe("blocked");
    expect(outcome.value.reason).toMatch(/autopilot/);
    await expect(readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8")).rejects.toThrow();
  });

  it("does not lease under dryRun", async () => {
    const { root, dir } = await episode();
    const svc = service(root);

    const outcome = await svc.claim(REF, "narrated-illustrated-video", { dryRun: true });

    expect(outcome.ok && outcome.value.status).toBe("would-run");
    await expect(readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8")).rejects.toThrow();
  });
});

describe("the order the gates are applied in", () => {
  // The precheck `run` supplies sits ABOVE the budget checks, which is where
  // the dispatcher checks were before `claimInternal` was extracted. Nothing
  // else in the suite observes that precedence: fail-closed.test.ts's
  // "no dispatcher" test supplies a budget guard and its "no budget guard"
  // test supplies a dispatcher, so each is blind to the ordering. These two
  // fail if the precheck moves back below `maySpend`.

  it("refuses a stage its dispatcher does not handle without consulting the budget", async () => {
    // A stage nothing here can perform must not reach `maySpend`. The
    // reservation it would mint has nothing to settle it (avg-91o), and
    // /execute loops over every stage in the pipeline, so a handler-less
    // stage would mint one on every pass.
    const { root, dir } = await episode();
    let maySpendCalls = 0;
    const counting: BudgetGuard = {
      maySpend: async () => {
        maySpendCalls += 1;
        return ok({ reserveId: "r1", estimatedCost: 0 });
      },
    };
    const svc = service(root, {
      dispatcher: { dispatch: async () => [], canDispatch: () => false },
      budget: counting,
    });

    const outcome = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.status).toBe("blocked");
    expect(outcome.value.reason).toMatch(/does not handle/);
    expect(maySpendCalls).toBe(0);
    await expect(readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8")).rejects.toThrow();
  });

  it("names the missing dispatcher first when neither it nor a budget guard is configured", async () => {
    // Both refusals are true; which one a person is shown is the ordering,
    // and the ordering is the pre-extraction one.
    const { root } = await episode();
    const svc = new ExecutionService({ libraryRoot: root, builtinPipelines: PIPELINES });

    const outcome = await svc.run(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.status).toBe("blocked");
    expect(outcome.value.reason).toMatch(/no dispatcher is configured/);
  });
});

describe("completing a claim", () => {
  it("validates the paths the performer names and records them", async () => {
    const { root, dir } = await episode();
    const svc = service(root);

    const claimed = await svc.claim(REF, "narrated-illustrated-video");
    expect(claimed.ok && claimed.value.status).toBe("claimed");

    await writeFile(join(dir, "artifacts/brief.md"), "a real brief");
    const done = await svc.complete(REF, "narrated-illustrated-video", "brief", {
      outputs: ["artifacts/brief.md"],
    });

    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.status).toBe("completed");
    expect(done.value.outputs).toEqual(["artifacts/brief.md"]);

    const events = await journal(dir);
    expect(events.map((e) => e.type)).toEqual(["stage-leased", "stage-started", "stage-completed"]);
  });

  it("fails the stage when a named output was never written", async () => {
    const { root, dir } = await episode();
    const svc = service(root);

    await svc.claim(REF, "narrated-illustrated-video");
    const done = await svc.complete(REF, "narrated-illustrated-video", "brief", {
      outputs: ["artifacts/brief.md"],
    });

    expect(done.ok && done.value.status).toBe("failed");
    expect(done.ok && done.value.reason).toMatch(/was not written/);
    const events = await journal(dir);
    expect(events.map((e) => e.type)).toEqual(["stage-leased", "stage-started", "stage-failed"]);
  });

  it("records the performer's own failure report", async () => {
    const { root, dir } = await episode();
    const svc = service(root);

    await svc.claim(REF, "narrated-illustrated-video");
    const done = await svc.complete(REF, "narrated-illustrated-video", "brief", {
      failed: true, error: "the model refused the prompt",
    });

    expect(done.ok && done.value.status).toBe("failed");
    const events = await journal(dir);
    const failed = events.find((e) => e.type === "stage-failed");
    expect((failed?.data as { error?: string })?.error).toBe("the model refused the prompt");
  });

  it("refuses a claim that has lapsed, and writes nothing", async () => {
    // The whole reason the lease exists. By the time a lapsed performer
    // reports, another process may already have taken the stage and closed
    // it; a terminal event for the stale lease landing after that makes
    // replay throw on every future call, because the journal is append-only.
    const { root, dir } = await episode();
    let clock = new Date("2026-09-20T10:00:00.000Z");
    const svc = service(root, { leaseTtlMs: 60_000, now: () => clock });

    const claimed = await svc.claim(REF, "narrated-illustrated-video");
    expect(claimed.ok && claimed.value.status).toBe("claimed");

    clock = new Date("2026-09-20T10:05:00.000Z"); // five minutes: well past the TTL
    await writeFile(join(dir, "artifacts/brief.md"), "written too late");
    const done = await svc.complete(REF, "narrated-illustrated-video", "brief", {
      outputs: ["artifacts/brief.md"],
    });

    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.status).toBe("failed");
    expect(done.value.reason).toMatch(/lapsed|expired/);

    const events = await journal(dir);
    expect(events.map((e) => e.type)).toEqual(["stage-leased", "stage-started"]);
  });

  it("lets a second claimant take a stage whose first claim lapsed, and still replays", async () => {
    const { root, dir } = await episode();
    let clock = new Date("2026-09-20T10:00:00.000Z");
    const svc = service(root, { leaseTtlMs: 60_000, now: () => clock });

    await svc.claim(REF, "narrated-illustrated-video");
    clock = new Date("2026-09-20T10:05:00.000Z");
    await svc.complete(REF, "narrated-illustrated-video", "brief", { outputs: ["artifacts/brief.md"] });

    const second = await svc.claim(REF, "narrated-illustrated-video");
    expect(second.ok && second.value.status).toBe("claimed");

    await writeFile(join(dir, "artifacts/brief.md"), "a real brief");
    const done = await svc.complete(REF, "narrated-illustrated-video", "brief", {
      outputs: ["artifacts/brief.md"],
    });
    expect(done.ok && done.value.status).toBe("completed");

    // The journal must still replay: the whole point of the silence above.
    const status = await svc.status(REF, "narrated-illustrated-video");
    expect(status.ok).toBe(true);
  });

  it("refuses to complete a stage nobody claimed", async () => {
    const { root } = await episode();
    const svc = service(root);

    const done = await svc.complete(REF, "narrated-illustrated-video", "brief", {
      outputs: ["artifacts/brief.md"],
    });

    expect(done.ok && done.value.status).toBe("blocked");
    expect(done.ok && done.value.reason).toMatch(/no open claim|not claimed/i);
  });

  it("refuses a leaseId that does not match the open claim", async () => {
    const { root, dir } = await episode();
    const svc = service(root);

    await svc.claim(REF, "narrated-illustrated-video");
    const done = await svc.complete(REF, "narrated-illustrated-video", "brief", {
      outputs: ["artifacts/brief.md"], leaseId: "not-the-lease",
    });

    expect(done.ok && done.value.status).toBe("blocked");
    // And it refused without writing. A `blocked` status alone would pass
    // against an implementation that appended a terminal event for the live
    // holder's lease and only then reported the mismatch.
    const events = await journal(dir);
    expect(events.map((e) => e.type)).toEqual(["stage-leased", "stage-started"]);
  });
});

describe("a lease that dies between the replay and the write", () => {
  // The structural refusal — no open attempt, so nothing to complete — is
  // only true at the instant `deriveExecutionState` runs. Everything after
  // it, `validateOutputs` above all, takes time the lease is not held still
  // for. Nothing in the rest of the suite can catch a lapse in that window:
  // a wall clock cannot be made to land there reliably, and the injected
  // clock is read once per phase, which is exactly what these use.

  const BASE = new Date("2026-09-20T10:00:00.000Z");
  const TTL = 60_000;

  /**
   * A clock that is live on its first reading and long past the lease on
   * every one after it.
   *
   * `complete` reads it once to replay the journal and once more immediately
   * before it writes, so this is the narrowest possible expression of the
   * race: the lease was live when replay proved the attempt open, and had
   * gone by the time the append came round.
   */
  function lapsesAfterReplay() {
    let reads = 0;
    return () => new Date(BASE.getTime() + (reads++ === 0 ? TTL / 2 : TTL * 10));
  }

  /** Claims the stage at BASE, then hands back a service to complete with. */
  async function claimed() {
    const { root, dir } = await episode();
    const claimer = service(root, { leaseTtlMs: TTL, now: () => BASE });
    const outcome = await claimer.claim(REF, "narrated-illustrated-video");
    expect(outcome.ok && outcome.value.status).toBe("claimed");
    // A separate service, as a second process would be: its clock starts
    // being read at the completion, not at the claim.
    const finisher = service(root, { leaseTtlMs: TTL, now: lapsesAfterReplay() });
    return { root, dir, finisher };
  }

  it("appends no stage-completed when the lease lapsed while the outputs were validated", async () => {
    const { dir, finisher } = await claimed();
    await writeFile(join(dir, "artifacts/brief.md"), "a real brief");

    const done = await finisher.complete(REF, "narrated-illustrated-video", "brief", {
      outputs: ["artifacts/brief.md"],
    });

    expect(done.ok && done.value.status).toBe("failed");
    expect(done.ok && done.value.reason).toMatch(/lapsed/);
    const events = await journal(dir);
    expect(events.map((e) => e.type)).toEqual(["stage-leased", "stage-started"]);
  });

  it("appends no stage-failed either when the outputs were invalid and the lease lapsed", async () => {
    const { dir, finisher } = await claimed();
    // Nothing was written, so validation fails — but the lease is gone by
    // then, and a stale stage-failed is as fatal to replay as a stale
    // stage-completed.
    const done = await finisher.complete(REF, "narrated-illustrated-video", "brief", {
      outputs: ["artifacts/brief.md"],
    });

    expect(done.ok && done.value.status).toBe("failed");
    expect(done.ok && done.value.reason).toMatch(/lapsed/);
    expect(done.ok && done.value.reason).not.toMatch(/was not written/);
    const events = await journal(dir);
    expect(events.map((e) => e.type)).toEqual(["stage-leased", "stage-started"]);
  });

  it("appends nothing for a reported failure whose lease lapsed", async () => {
    // This path's window is near zero — there is no filesystem work between
    // the replay and the write. Guarded anyway: three guarded writes are
    // easier to reason about than two guarded and one argued safe.
    const { dir, finisher } = await claimed();

    const done = await finisher.complete(REF, "narrated-illustrated-video", "brief", {
      failed: true, error: "the model refused the prompt",
    });

    expect(done.ok && done.value.status).toBe("failed");
    expect(done.ok && done.value.reason).toMatch(/lapsed/);
    const events = await journal(dir);
    expect(events.map((e) => e.type)).toEqual(["stage-leased", "stage-started"]);
  });

  it("still replays, and a second claimant can take the stage", async () => {
    // The point of the silence, asserted rather than assumed.
    const { root, dir, finisher } = await claimed();
    await writeFile(join(dir, "artifacts/brief.md"), "a real brief");
    await finisher.complete(REF, "narrated-illustrated-video", "brief", {
      outputs: ["artifacts/brief.md"],
    });

    const later = service(root, {
      leaseTtlMs: TTL, now: () => new Date(BASE.getTime() + TTL * 10),
    });
    const status = await later.status(REF, "narrated-illustrated-video");
    expect(status.ok).toBe(true);
    const second = await later.claim(REF, "narrated-illustrated-video");
    expect(second.ok && second.value.status).toBe("claimed");
  });
});

describe("run is claim, dispatch, complete", () => {
  it("writes exactly the events a claim followed by a complete writes", async () => {
    // Asserted on the journal rather than on which methods were called: the
    // guarantee is that the two paths leave the same record, not that one
    // happens to call the other today.
    const viaRun = await episode();
    const runSvc = new ExecutionService({
      libraryRoot: viaRun.root, builtinPipelines: PIPELINES, budget: permissiveBudget,
      dispatcher: {
        dispatch: async () => {
          await writeFile(join(viaRun.dir, "artifacts/brief.md"), "a real brief");
          return ["artifacts/brief.md"];
        },
      },
    });
    const ran = await runSvc.run(REF, "narrated-illustrated-video");
    expect(ran.ok && ran.value.status).toBe("completed");

    const viaClaim = await episode();
    const claimSvc = service(viaClaim.root);
    await claimSvc.claim(REF, "narrated-illustrated-video");
    await writeFile(join(viaClaim.dir, "artifacts/brief.md"), "a real brief");
    await claimSvc.complete(REF, "narrated-illustrated-video", "brief", {
      outputs: ["artifacts/brief.md"],
    });

    const shape = (events: Awaited<ReturnType<typeof journal>>) =>
      events.map((e) => ({
        type: e.type,
        stageId: (e.data as { stageId?: string }).stageId,
        attemptNumber: (e.data as { attemptNumber?: number }).attemptNumber,
        outputs: (e.data as { outputs?: string[] }).outputs,
      }));

    expect(shape(await journal(viaRun.dir))).toEqual(shape(await journal(viaClaim.dir)));
  });
});
