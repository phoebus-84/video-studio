import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
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
