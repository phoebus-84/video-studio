// ---------------------------------------------------------------------------
// Source pins: a changed source makes the stages that read it stale
// (avg-7zp.5, ADR-0035)
// ---------------------------------------------------------------------------
// The episode pins a channel source, library/<channel>/sources/<name>, used by
// `upstream`. Editing the source makes `upstream` and everything downstream of
// it stale, with a reason naming the files; status writes nothing. Renewing
// the pin journals a `staleness-marked` that keeps them stale until they run
// again.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionService } from "../../../src/execution/service.js";
import type { ReviewGate, StageDispatcher } from "../../../src/execution/types.js";
import { parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { ok } from "../../../src/result.js";
import { reviewChainPipeline } from "./helpers/review-chain.js";

const REF = { channel: "dentro-i-versi", series: "long", episode: "il-lampo" };

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

const budget = { maySpend: async () => ok({ reserveId: "r", estimatedCost: 0 }) };
const permissive: ReviewGate = { isOutstanding: async () => ({ state: "approved" as const }) };

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "exec-pins-"));
  roots.push(root);
  const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
  await mkdir(join(dir, "artifacts"), { recursive: true });
  const source = join(root, REF.channel, "sources", "il-lampo");
  await mkdir(join(source, "timing"), { recursive: true });
  await writeFile(join(source, "takes.json"), "{}");
  await writeFile(join(source, "timing", "recitazione.json"), '{"words":[]}');
  const dispatcher: StageDispatcher = {
    dispatch: async (stage) => {
      const file = join(dir, "artifacts", `${stage.definition.id}.md`);
      await writeFile(file, "output");
      return [file];
    },
  };
  const svc = new ExecutionService({
    libraryRoot: root, builtinPipelines: await reviewChainPipeline(roots),
    dispatcher, budget, review: permissive, operatorKey: null,
  });
  return { root, dir, source, svc };
}

async function runChain(svc: ExecutionService) {
  for (const stage of ["upstream", "gated", "downstream"]) await svc.run(REF, "review-chain", { stage });
}

async function states(svc: ExecutionService) {
  const st = await svc.status(REF, "review-chain");
  if (!st.ok) throw new Error(st.error.message);
  return Object.fromEntries(st.value.stages.map((s) => [s.stageId, { state: s.state, reason: s.stateReason }]));
}

const channelSource = { kind: "channel-source" as const, name: "il-lampo" };

describe("pinning a source", () => {
  it("writes an inventory and leaves the stages as they were", async () => {
    const { dir, svc } = await setup();
    const added = await svc.addPin(REF, "review-chain", { id: "poesia", source: channelSource, usedBy: ["upstream"] });
    expect(added.ok && added.value.ok).toBe(true);
    const pin = JSON.parse(await readFile(join(dir, "source", "pins", "poesia.json"), "utf-8"));
    expect(Object.keys(pin.files)).toEqual(["takes.json", "timing/recitazione.json"]);

    await runChain(svc);
    const s = await states(svc);
    expect(s.upstream!.state).toBe("completed");
    expect(s.downstream!.state).toBe("completed");
  });

  it("refuses a missing source, an unknown stage, itself, and a pin that exists", async () => {
    const { svc } = await setup();
    const refusal = async (input: Parameters<ExecutionService["addPin"]>[2]) => {
      const out = await svc.addPin(REF, "review-chain", input);
      return out.ok && !out.value.ok ? out.value.refusal.code : "accepted";
    };
    expect(await refusal({ id: "a", source: { kind: "channel-source", name: "nope" }, usedBy: ["upstream"] })).toBe("unknown-source");
    expect(await refusal({ id: "a", source: channelSource, usedBy: ["compile"] })).toBe("unknown-stage");
    expect(await refusal({ id: "a", source: { kind: "episode", series: "long", episode: "il-lampo" }, usedBy: ["upstream"] })).toBe("self-pin");
    expect(await refusal({ id: "poesia", source: channelSource, usedBy: ["upstream"] })).toBe("accepted");
    expect(await refusal({ id: "poesia", source: channelSource, usedBy: ["upstream"] })).toBe("pin-exists");
  });
});

describe("a changed source", () => {
  it("makes its readers and their downstream stale, naming the files", async () => {
    const { source, svc } = await setup();
    await svc.addPin(REF, "review-chain", { id: "poesia", source: channelSource, usedBy: ["upstream"] });
    await runChain(svc);

    await writeFile(join(source, "timing", "recitazione.json"), '{"words":[1]}');
    const s = await states(svc);
    expect(s.upstream!.state).toBe("stale");
    expect(s.upstream!.reason).toBe(
      '"upstream" is stale: source "il-lampo" changed since it was pinned: timing/recitazione.json (modified) — renew the pin to accept the new version',
    );
    expect(s.gated!.state).toBe("stale");
    expect(s.downstream!.state).toBe("stale");
  });

  it("stays stale when the stage is re-run without renewing the pin", async () => {
    const { source, svc } = await setup();
    await svc.addPin(REF, "review-chain", { id: "poesia", source: channelSource, usedBy: ["upstream"] });
    await runChain(svc);
    await writeFile(join(source, "takes.json"), '{"takes":[]}');

    await svc.run(REF, "review-chain", { stage: "upstream" });
    expect((await states(svc)).upstream!.state).toBe("stale");
  });

  it("writes nothing while reporting it", async () => {
    const { dir, source, svc } = await setup();
    await svc.addPin(REF, "review-chain", { id: "poesia", source: channelSource, usedBy: ["upstream"] });
    await runChain(svc);
    const pinBefore = await readFile(join(dir, "source", "pins", "poesia.json"), "utf-8");
    const journalBefore = await readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8");
    await writeFile(join(source, "takes.json"), '{"takes":[]}');

    await states(svc);
    expect(await readFile(join(dir, "source", "pins", "poesia.json"), "utf-8")).toBe(pinBefore);
    expect(await readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8")).toBe(journalBefore);
  });

  it("reports a source that disappeared and a pin that is not valid", async () => {
    const { dir, source, svc } = await setup();
    await svc.addPin(REF, "review-chain", { id: "poesia", source: channelSource, usedBy: ["upstream"] });
    await runChain(svc);
    await rm(source, { recursive: true, force: true });
    expect((await states(svc)).upstream!.reason).toBe('"upstream" is stale: source "il-lampo" pinned as "poesia" no longer exists');

    await writeFile(join(dir, "source", "pins", "poesia.json"), '{"usedBy":["gated"]}');
    const s = await states(svc);
    expect(s.upstream!.state).toBe("completed");
    expect(s.gated!.state).toBe("stale");
    expect(s.gated!.reason).toMatch(/^"gated" is stale: pin "poesia.json" is not valid/);
  });
});

describe("renewing a pin", () => {
  it("journals what changed and keeps its readers stale until they run again", async () => {
    const { dir, source, svc } = await setup();
    await svc.addPin(REF, "review-chain", { id: "poesia", source: channelSource, usedBy: ["upstream"] });
    await runChain(svc);
    await writeFile(join(source, "takes.json"), '{"takes":[]}');

    const renewed = await svc.renewPin(REF, "review-chain", "poesia", "pi");
    expect(renewed.ok && renewed.value.ok && renewed.value.changed).toEqual([{ path: "takes.json", change: "modified" }]);
    // upstream and everything downstream of it, in pipeline order (skilled and attended also depend on upstream)
    expect(renewed.ok && renewed.value.ok && renewed.value.affected).toEqual(["upstream", "gated", "skilled", "attended", "downstream"]);

    const events = parseJournal(await readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8"), { strict: true });
    const marked = events.filter((e) => e.type === "staleness-marked").at(-1)!;
    expect(marked.actor).toBe("pi");
    const data = marked.data as { trigger?: string; changed?: unknown };
    expect(data.trigger).toBe("pin:poesia");
    expect(data.changed).toEqual([{ path: "takes.json", change: "modified" }]);

    const s = await states(svc);
    expect(s.upstream!.state).toBe("stale");
    expect(s.upstream!.reason).toBe('"upstream" is stale: source pin "poesia" was renewed after it ran');

    await runChain(svc);
    const after = await states(svc);
    expect([after.upstream!.state, after.gated!.state, after.downstream!.state]).toEqual(["completed", "completed", "completed"]);
  });

  it("journals nothing when the source did not change", async () => {
    const { dir, svc } = await setup();
    await svc.addPin(REF, "review-chain", { id: "poesia", source: channelSource, usedBy: ["upstream"] });
    await runChain(svc);
    const renewed = await svc.renewPin(REF, "review-chain", "poesia", "human");
    expect(renewed.ok && renewed.value.ok && renewed.value.affected).toEqual([]);
    const events = parseJournal(await readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8"), { strict: true });
    expect(events.some((e) => e.type === "staleness-marked")).toBe(false);
  });

  it("refuses a pin that does not exist", async () => {
    const { dir, svc } = await setup();
    const out = await svc.renewPin(REF, "review-chain", "nope", "human");
    expect(out.ok && !out.value.ok && out.value.refusal.code).toBe("unknown-pin");
    expect(existsSync(join(dir, "source", "pins"))).toBe(false);
  });
});
