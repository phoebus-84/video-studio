import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ExecutionService } from "../../../src/execution/service.js";
import type { BudgetGuard } from "../../../src/execution/types.js";
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

function service(root: string, extra: Record<string, unknown> = {}) {
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
    const { root } = await episode();
    const svc = service(root);

    const first = await svc.claim(REF, "narrated-illustrated-video");
    const second = await svc.claim(REF, "narrated-illustrated-video", { stage: "brief" });

    expect(first.ok && first.value.status).toBe("claimed");
    expect(second.ok && second.value.status).toBe("blocked");
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
