import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { ExecutionService } from "../../../src/execution/service.js";
import type { ExecutionServiceOptions, StageOutcome } from "../../../src/execution/types.js";
import type { Result } from "../../../src/result.js";
import { ok, err } from "../../../src/result.js";
import { parseJournal, JOURNAL_RELATIVE_PATH, appendJournalEvent } from "@studio/contracts/src/journal.mjs";
import { verifyReceipt } from "@studio/contracts/src/receipt.mjs";

const REF = { channel: "test", series: "travel", episode: "pisa" };
const PIPELINE = "retry-test";
const KEY = "isolated-test-key-not-a-real-credential";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });
const budget = { maySpend: async () => ok({ reserveId: "none", estimatedCost: 0 }) };
const operator = { principal: "operator" as const, afterAttempt: 3, note: "Image route fixed; resume accepted pose" };
function value<T>(result: Result<T, unknown>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
const bytes = (dir: string) => readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf8");
const journal = async (dir: string) => parseJournal(await bytes(dir));

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "retry-grant-")); roots.push(root);
  const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
  await mkdir(join(dir, "artifacts"), { recursive: true });
  await mkdir(join(root, "pipelines"));
  const definition = {
    pipeline: {
      id: PIPELINE, version: "1.0.0", description: "Test recovery without accepting an animatic",
      stages: [
        { id: "brief", name: "Brief", type: "editorial", description: "Brief", inputs: [], outputs: [],
          gates: { autopilot: true, review: "none", retry_on_failure: 0 }, depends_on: [] },
        { id: "animatic", name: "Animatic", type: "editorial", description: "A real video, not a pose",
          inputs: [], outputs: [], gates: { autopilot: true, review: "human", retry_on_failure: 0 }, depends_on: ["brief"] },
      ],
    },
  };
  const pipelinePath = join(root, "pipelines", PIPELINE + ".yaml");
  await writeFile(pipelinePath, JSON.stringify(definition)); // JSON is also YAML.
  const service = (extra: Partial<ExecutionServiceOptions> = {}) => new ExecutionService({ libraryRoot: root, operatorKey: KEY, budget, ...extra });
  const svc = service();
  const brief = value(await svc.claim(REF, PIPELINE, { stage: "brief" }));
  await writeFile(join(dir, "artifacts/brief.md"), "real brief");
  expect(value(await svc.complete(REF, PIPELINE, "brief", { leaseId: brief.leaseId!, outputs: ["artifacts/brief.md"] })).status).toBe("completed");
  for (let i = 0; i < 3; i++) {
    const claim = value(await svc.claim(REF, PIPELINE, { stage: "animatic" }));
    expect(claim.status).toBe("claimed");
    expect(value(await svc.complete(REF, PIPELINE, "animatic", { leaseId: claim.leaseId!, failed: true, error: "generation failed" })).status).toBe("failed");
  }
  return { root, dir, svc, service, definition, pipelinePath };
}

async function fail(svc: ExecutionService, claim: StageOutcome) {
  expect(claim.status).toBe("claimed");
  return value(await svc.complete(REF, PIPELINE, "animatic", { leaseId: claim.leaseId!, failed: true, error: "another real failure" }));
}

describe("operator-authorized one-attempt retry", () => {
  it("requires operator identity AND a signing key; ordinary claims stay capped", async () => {
    const { svc, service, dir } = await fixture(); const before = await bytes(dir);
    expect(value(await svc.claim(REF, PIPELINE, { stage: "animatic" })).reason).toMatch(/retry limit/);
    expect(value(await svc.grantRetry(REF, PIPELINE, "animatic", { ...operator, principal: "agent" })).status).toBe("blocked");
    expect(value(await service({ operatorKey: null }).grantRetry(REF, PIPELINE, "animatic", operator)).status).toBe("blocked");
    expect(await bytes(dir)).toBe(before);
  });

  it("appends a signed idempotent grant without changing failures, outputs or approvals", async () => {
    const { svc, dir } = await fixture(); const before = await bytes(dir);
    expect(value(await svc.grantRetry(REF, PIPELINE, "animatic", operator)).status).toBe("retry_granted");
    const after = await bytes(dir); expect(after.startsWith(before)).toBe(true);
    const records = await journal(dir); const grant = records.at(-1)!;
    expect(grant.type).toBe("stage-retry-granted"); expect(verifyReceipt(grant.data, KEY)).toBe(true);
    expect(grant.data.binding).toMatchObject({ afterAttempt: 3, nextAttempt: 4 });
    expect(records.filter((e) => e.type === "stage-failed")).toHaveLength(3);
    expect(records.some((e) => e.type === "approval-granted")).toBe(false);
    expect(value(await svc.grantRetry(REF, PIPELINE, "animatic", operator)).status).toBe("retry_granted");
    expect(await bytes(dir)).toBe(after);
  });

  it("dry runs validate but neither write nor consume permission; one failed retry consumes it", async () => {
    const { svc, dir } = await fixture(); const before = await bytes(dir);
    expect(value(await svc.grantRetry(REF, PIPELINE, "animatic", { ...operator, dryRun: true })).status).toBe("would-run");
    expect(await bytes(dir)).toBe(before);
    await svc.grantRetry(REF, PIPELINE, "animatic", operator); const granted = await bytes(dir);
    for (let i = 0; i < 2; i++) expect(value(await svc.claim(REF, PIPELINE, { stage: "animatic", dryRun: true })).status).toBe("would-run");
    expect(await bytes(dir)).toBe(granted);
    const claim = value(await svc.claim(REF, PIPELINE, { stage: "animatic" }));
    expect(claim.attemptNumber).toBe(4);
    const records = await journal(dir);
    expect(records.filter((e) => e.type === "stage-leased").at(-1)!.data.retryGrantId).toBe(records.find((e) => e.type === "stage-retry-granted")!.id);
    await fail(svc, claim);
    expect(value(await svc.claim(REF, PIPELINE, { stage: "animatic" })).status).toBe("blocked");
    expect(value(await svc.claim(REF, PIPELINE, { stage: "animatic", dryRun: true })).status).toBe("blocked");
    expect(value(await svc.grantRetry(REF, PIPELINE, "animatic", operator)).reason).toMatch(/changed/);
  });

  it("requires a reason and refuses stale, unneeded, running or unknown stages", async () => {
    const { svc, dir } = await fixture(); const before = await bytes(dir);
    expect(value(await svc.grantRetry(REF, PIPELINE, "animatic", { ...operator, note: " " })).status).toBe("blocked");
    expect(value(await svc.grantRetry(REF, PIPELINE, "animatic", { ...operator, afterAttempt: 2 })).reason).toMatch(/changed/);
    expect(value(await svc.grantRetry(REF, PIPELINE, "brief", operator)).reason).toMatch(/not failed/);
    expect((await svc.grantRetry(REF, PIPELINE, "missing", operator)).ok).toBe(false);
    expect(await bytes(dir)).toBe(before);
    await svc.grantRetry(REF, PIPELINE, "animatic", operator);
    await svc.claim(REF, PIPELINE, { stage: "animatic" });
    expect(value(await svc.grantRetry(REF, PIPELINE, "animatic", operator)).reason).toMatch(/held by a run/);
  });

  it("does not bypass a budget refusal or a dependency review, and does not consume the grant there", async () => {
    const { svc, service, dir } = await fixture();
    await svc.grantRetry(REF, PIPELINE, "animatic", operator); const before = await bytes(dir);
    const noFunds = service({ budget: { maySpend: async () => err({ code: "OVER_LIMIT", message: "no money" }) } });
    expect(value(await noFunds.claim(REF, PIPELINE, { stage: "animatic" })).reason).toMatch(/no money/);
    const review = service({ review: { isOutstanding: async () => ({ state: "outstanding", reason: "brief needs review" }) } });
    expect(value(await review.claim(REF, PIPELINE, { stage: "animatic" })).reason).toMatch(/brief needs review/);
    expect(await bytes(dir)).toBe(before);
    expect(value(await svc.claim(REF, PIPELINE, { stage: "animatic" })).status).toBe("claimed");
  });

  it("a successful authorized attempt still awaits human review; it is not an approval", async () => {
    const { svc, dir } = await fixture();
    await svc.grantRetry(REF, PIPELINE, "animatic", operator);
    const claim = value(await svc.claim(REF, PIPELINE, { stage: "animatic" }));
    await writeFile(join(dir, "artifacts/preview.txt"), "test output, not a real episode video");
    expect(value(await svc.complete(REF, PIPELINE, "animatic", { leaseId: claim.leaseId!, outputs: ["artifacts/preview.txt"] })).status).toBe("awaiting_review");
    expect((await journal(dir)).some((e) => e.type === "approval-granted")).toBe(false);
    const next = value(await svc.claim(REF, PIPELINE, { stage: "animatic" }));
    expect(next.status).toBe("claimed"); // Success alone legitimately resets the normal failure cap.
    await fail(svc, next);
    expect(value(await svc.grantRetry(REF, PIPELINE, "animatic", { ...operator, afterAttempt: 5 })).reason).toMatch(/ordinary retries/);
  });

  it("rejects tampered grants, an absent verification key, and changed stage definitions", async () => {
    const { svc, service, dir, definition, pipelinePath } = await fixture();
    await svc.grantRetry(REF, PIPELINE, "animatic", operator);
    expect(value(await service({ operatorKey: null }).claim(REF, PIPELINE, { stage: "animatic" })).status).toBe("blocked");
    const records = await journal(dir); const grant = records.at(-1)!;
    grant.data.note = "changed without signing";
    await writeFile(join(dir, JOURNAL_RELATIVE_PATH), records.map((e) => JSON.stringify(e)).join("\n") + "\n");
    expect(value(await svc.claim(REF, PIPELINE, { stage: "animatic" })).status).toBe("blocked");
    grant.data.note = operator.note;
    await writeFile(join(dir, JOURNAL_RELATIVE_PATH), records.map((e) => JSON.stringify(e)).join("\n") + "\n");
    definition.pipeline.stages[1]!.name = "Different work";
    await writeFile(pipelinePath, JSON.stringify(definition));
    expect(value(await svc.claim(REF, PIPELINE, { stage: "animatic" })).status).toBe("blocked");
  });

  it("does not reuse a receipt with a different last lease", async () => {
    const a = await fixture(); const b = await fixture();
    await a.svc.grantRetry(REF, PIPELINE, "animatic", operator);
    const receipt = (await journal(a.dir)).at(-1)!;
    await appendJournalEvent(b.dir, { episode: REF, type: "stage-retry-granted", actor: "human", data: receipt.data });
    expect(value(await b.svc.claim(REF, PIPELINE, { stage: "animatic" })).status).toBe("blocked"); // Different last lease, even with identical names/plan.
  });

  it("binds the receipt to its episode even when the plan and lease IDs are identical", async () => {
    const { svc, service, dir, root } = await fixture();
    await svc.grantRetry(REF, PIPELINE, "animatic", operator);
    const sibling = { ...REF, episode: "another" };
    const siblingDir = join(root, REF.channel, "series", REF.series, "episodes", sibling.episode);
    await mkdir(join(siblingDir, "journal"), { recursive: true });
    const records = (await journal(dir)).map((e) => ({ ...e, episodeRef: sibling }));
    await writeFile(join(siblingDir, JOURNAL_RELATIVE_PATH), records.map((e) => JSON.stringify(e)).join("\n") + "\n");
    expect(value(await service().claim(sibling, PIPELINE, { stage: "animatic" })).status).toBe("blocked");
  });

  it("consumes a grant even when its claim times out without a terminal event", async () => {
    const { svc, service } = await fixture();
    await svc.grantRetry(REF, PIPELINE, "animatic", operator);
    const claim = value(await svc.claim(REF, PIPELINE, { stage: "animatic" }));
    const later = service({ now: () => new Date(new Date(claim.expiresAt!).getTime() + 1) });
    expect(value(await later.claim(REF, PIPELINE, { stage: "animatic" })).status).toBe("blocked");
  });

  it("rechecks a grant under the lock when another caller consumed it after the first read", async () => {
    const { svc, service, dir } = await fixture();
    await svc.grantRetry(REF, PIPELINE, "animatic", operator);
    let interleaved = false;
    const delayed = service({ budget: { maySpend: async () => {
      if (!interleaved) {
        interleaved = true;
        await fail(svc, value(await svc.claim(REF, PIPELINE, { stage: "animatic" })));
      }
      return ok({ reserveId: "none", estimatedCost: 0 });
    } } });
    const result = value(await delayed.claim(REF, PIPELINE, { stage: "animatic" }));
    expect(result.status).toBe("blocked"); expect(result.reason).toMatch(/no longer current/);
    expect((await journal(dir)).filter((e) => e.type === "stage-leased" && e.data.stageId === "animatic")).toHaveLength(4);
  });

  it("cannot reuse stale state even if a new operator grant arrives during the race", async () => {
    const { svc, service, dir } = await fixture();
    await svc.grantRetry(REF, PIPELINE, "animatic", operator);
    let interleaved = false;
    const delayed = service({ budget: { maySpend: async () => {
      if (!interleaved) {
        interleaved = true;
        await fail(svc, value(await svc.claim(REF, PIPELINE, { stage: "animatic" })));
        await svc.grantRetry(REF, PIPELINE, "animatic", { ...operator, afterAttempt: 4 });
      }
      return ok({ reserveId: "none", estimatedCost: 0 });
    } } });
    expect(value(await delayed.claim(REF, PIPELINE, { stage: "animatic" })).reason).toMatch(/no longer current/);
    expect((await journal(dir)).filter((e) => e.type === "stage-leased" && e.data.stageId === "animatic")).toHaveLength(4);
    expect(value(await svc.claim(REF, PIPELINE, { stage: "animatic" })).attemptNumber).toBe(5);
  });

  it("refuses a dropped append instead of claiming a grant was recorded", async () => {
    const { root, svc, dir } = await fixture();
    const journalPath = join(dir, JOURNAL_RELATIVE_PATH);
    const saved = await bytes(dir);
    class CannotAppend extends ExecutionService {
      protected override async readJournal(episodeDir: string) {
        const result = await super.readJournal(episodeDir);
        await rm(journalPath); await mkdir(journalPath);
        return result;
      }
    }
    const broken = new CannotAppend({ libraryRoot: root, operatorKey: KEY, budget });
    expect(value(await broken.grantRetry(REF, PIPELINE, "animatic", operator)).reason).toMatch(/could not be written/);
    await rm(journalPath, { recursive: true }); await writeFile(journalPath, saved);
    expect(value(await svc.grantRetry(REF, PIPELINE, "animatic", operator)).status).toBe("retry_granted");
  });

  it("fails closed on an unreadable journal and releases the grant lock", async () => {
    const { svc, dir } = await fixture();
    // An operator grant cannot replace a missing journal with a success.
    const path = join(dir, JOURNAL_RELATIVE_PATH);
    const saved = await bytes(dir);
    // Read failures are also refusals and must never leak the mutation lock.
    await rm(path); await mkdir(path);
    expect((await svc.grantRetry(REF, PIPELINE, "animatic", operator)).ok).toBe(false);
    await rm(path, { recursive: true }); await writeFile(path, saved);
    expect(value(await svc.grantRetry(REF, PIPELINE, "animatic", operator)).status).toBe("retry_granted");
  });
});

// Exercise the freshly built CLI (npm test rebuilds it), using ONLY a fixture key.
describe("vpr retry", () => {
  const cli = fileURLToPath(new URL("../../../dist/src/cli.js", import.meta.url));
  it("supports dry-run and a signed grant, but refuses headless callers even with a key path", async () => {
    const { root, dir } = await fixture(); const key = join(root, "test-operator-key");
    await writeFile(key, KEY, { mode: 0o600 });
    const args = [cli, "retry", "test/travel/pisa", "animatic", "--after-attempt", "3", "--note", operator.note,
      "--pipeline", PIPELINE, "--library", root, "--json"];
    const invoke = (headless: string, more: string[] = []) => spawnSync(process.execPath, [...args, ...more], {
      encoding: "utf8", env: { ...process.env, AVG_HEADLESS: headless, AVG_OPERATOR_KEY_FILE: key },
    });
    const before = await bytes(dir);
    const refused = invoke("1"); expect(refused.status).not.toBe(0);
    expect(JSON.parse(refused.stdout).status).toBe("blocked"); expect(await bytes(dir)).toBe(before);
    const dry = invoke("0", ["--dry-run"]); expect(dry.status, dry.stdout + dry.stderr).toBe(0);
    expect(JSON.parse(dry.stdout).status).toBe("would-run"); expect(await bytes(dir)).toBe(before);
    const granted = invoke("0"); expect(granted.status, granted.stdout + granted.stderr).toBe(0);
    expect(JSON.parse(granted.stdout).status).toBe("retry_granted");
    expect(verifyReceipt((await journal(dir)).at(-1)!.data, KEY)).toBe(true);
  });
});
