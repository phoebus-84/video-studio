// ── The gateway's remaining execute paths, over HTTP ────────────────────────
//
// Task 7 of avg-qr4's "CLI and agent on the execution service". Four things
// the gateway did with its own machinery now go through `ExecutionService`:
// the single-stage execute, `/status`, `/rerun-plan`, and the two new
// claim/complete routes. Two more consumers of the status projection — the
// episode-detail enrichment in routes/workspace.ts and the poll in
// events/publisher.ts — move with them, and are covered at the bottom of this
// file because neither had a test at all: both were reading `s.id` off a
// report that names it `stageId`, and all 297 gateway tests passed anyway.
//
// The composition under test is the real one (`makeExecutionService`), the
// app is the real Fastify stack, and the pipelines are the shipped manifests.
// Auth is not registered here for the same reason gate-enforcement.test.ts
// does not register it: `registerProductionRoutes` installs no hook of its
// own, and the bearer check lives in server.ts's global preHandler.

import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendJournalEvent, parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { registerProductionRoutes } from "../src/routes/production.js";
import { registerWorkspaceRoutes } from "../src/routes/workspace.js";
import { EventPublisher } from "../src/events/publisher.js";
import { EventBus, type GatewayEvent } from "../src/events/bus.js";
import type { WorkspaceWatcher } from "../src/events/watcher.js";
import type { RuntimeClient } from "../src/runtime/client.js";
import type { WorkspaceService } from "../src/workspace/service.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.unstubAllEnvs();
});

const REF = { channel: "childrens", series: "fairy-tales", episode: "ep" };
const BASE = `/api/channels/${REF.channel}/series/${REF.series}/episodes/${REF.episode}`;

async function episodeDir() {
  const root = await mkdtemp(join(tmpdir(), "gw-stage-route-"));
  roots.push(root);
  const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
  await mkdir(join(dir, "artifacts"), { recursive: true });
  await mkdir(join(dir, "assets", "images"), { recursive: true });
  return { root, dir };
}

/**
 * The real routes over the real Fastify stack, pointed at a throwaway library.
 *
 * `runtime` is a stub: nothing these routes still reach uses it. The three
 * that do — snapshot, approve, init — are Task 8's.
 */
async function appWithEpisode() {
  const { root, dir } = await episodeDir();
  vi.stubEnv("AVG_LIBRARY_ROOT", root);
  const app = Fastify();
  const workspace = { getEpisode: async () => null } as unknown as WorkspaceService;
  registerProductionRoutes(app, {} as unknown as RuntimeClient, workspace);
  await app.ready();
  roots.push(); // app closed by the caller
  return { app, root, dir };
}

/**
 * Record a stage as completed, the way a real run would.
 *
 * Three events, because replay identifies an attempt by its lease: a terminal
 * event with no lease cannot be placed in the history.
 */
let seedCounter = 0;
async function seedCompleted(dir: string, stageId: string, outputs: string[] = []) {
  const leaseId = `seeded-${stageId}-${seedCounter++}`;
  const common = { episode: REF, actor: "runtime" as const };
  await appendJournalEvent(dir, {
    type: "stage-leased", ...common,
    data: {
      stageId, leaseId, attemptNumber: 1, ttlMs: 600_000,
      expiresAt: new Date(Date.now() + 600_000).toISOString(), holder: "seed",
    },
  });
  await appendJournalEvent(dir, {
    type: "stage-started", ...common, data: { stageId, leaseId, attemptNumber: 1 },
  });
  await appendJournalEvent(dir, {
    type: "stage-completed", ...common, data: { stageId, leaseId, attemptNumber: 1, outputs },
  });
}

async function seedUpTo(dir: string, ...stageIds: string[]) {
  for (const id of stageIds) await seedCompleted(dir, id);
}

async function journal(dir: string) {
  return parseJournal(await readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8"));
}

// ── POST /stages/:stage/execute ─────────────────────────────────────────────

describe("POST /stages/:stage/execute", () => {
  it("performs a stage the gateway has a handler for, and journals it", async () => {
    const { app, dir } = await appWithEpisode();
    // `illustrations` depends on `art-direction` alone — not on
    // `terminal-recordings`, which is a sibling behind the same dependency.
    // Seeding the sibling would prove nothing; omitting `art-direction`
    // would make this test assert a dependency refusal while claiming to
    // assert a dispatch.
    await seedUpTo(dir, "brief", "script", "art-direction");
    await writeFile(join(dir, "assets", "images", "s1.png"), "not really a png, but bytes");

    const res = await app.inject({
      method: "POST", url: `${BASE}/stages/illustrations/execute`, payload: {},
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    // `awaiting_review`, not `completed`: illustrations declares review: human.
    // Completion is what happened; acceptance is whether it counts.
    expect(body.outcome.status).toBe("awaiting_review");
    expect(body.outcome.outputs.length).toBeGreaterThan(0);

    const events = await journal(dir);
    expect(events.some((e) => e.type === "stage-completed"
      && (e.data as { stageId?: string }).stageId === "illustrations")).toBe(true);
  });

  it("blocks a stage the gateway has no handler for, rather than reporting success", async () => {
    // What this route did before: shell out to `vpr run`, which printed
    // "Ready to execute: brief" and exited 0. The studio's Run Stage button
    // reported success and nothing had happened.
    const { app, dir } = await appWithEpisode();

    const res = await app.inject({
      method: "POST", url: `${BASE}/stages/brief/execute`, payload: {},
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // `ok` means the service reached a verdict, and it did: it refused.
    expect(body.ok).toBe(true);
    expect(body.outcome.status).toBe("blocked");
    expect(body.outcome.reason).toMatch(/does not handle/);
    // Refused before anything was leased, so there is no journal at all.
    await expect(journal(dir)).rejects.toThrow();
  });

  it("refuses a stage the pipeline does not declare", async () => {
    const { app } = await appWithEpisode();

    const res = await app.inject({
      method: "POST", url: `${BASE}/stages/not-a-stage/execute`, payload: {},
    });
    await app.close();

    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("STAGE_UNKNOWN");
  });

  it("reports a dry run without leasing or writing", async () => {
    const { app, dir } = await appWithEpisode();
    await seedUpTo(dir, "brief", "script", "art-direction");
    await writeFile(join(dir, "assets", "images", "s1.png"), "bytes");
    const before = (await journal(dir)).length;

    const res = await app.inject({
      method: "POST", url: `${BASE}/stages/illustrations/execute`, payload: { dryRun: true },
    });
    await app.close();

    const body = res.json();
    expect(body.outcome.status).toBe("would-run");
    expect(body.outcome.dryRun).toBe(true);
    expect((await journal(dir)).length).toBe(before);
  });
});

// ── GET /status ─────────────────────────────────────────────────────────────

describe("GET /status", () => {
  it("reports pending for a stage with artifacts and no journal", async () => {
    const { app, dir } = await appWithEpisode();
    await writeFile(join(dir, "artifacts", "brief.md"), "written before journals existed");

    const res = await app.inject({ method: "GET", url: `${BASE}/status` });
    await app.close();

    const body = res.json();
    expect(body.ok).toBe(true);
    // The `data` envelope is what the studio reads (production-store.svelte.ts).
    const brief = body.data.stages.find((s: { stageId: string }) => s.stageId === "brief");
    // A file on disk is not evidence a stage ran. That inference is the whole
    // defect this epic removes.
    expect(brief.state).toBe("runnable");
    expect(brief.status).toBe("pending");
  });

  it("names its stages stageId, and carries state and produces through", async () => {
    // No response schema is declared on this route, deliberately: Fastify
    // strips properties a response schema does not list, and an out-of-date
    // one here would silently delete the fields a caller switches on.
    const { app, dir } = await appWithEpisode();
    await seedUpTo(dir, "brief");

    const res = await app.inject({ method: "GET", url: `${BASE}/status` });
    await app.close();

    const body = res.json();
    expect(body.data.pipeline).toBe("narrated-illustrated-video");
    const script = body.data.stages.find((s: { stageId: string }) => s.stageId === "script");
    expect(script).toBeDefined();
    // `script` declares autopilot: false, so it is blocked with a reason,
    // not merely pending.
    expect(script.state).toBe("blocked");
    expect(script.stateReason).toMatch(/autopilot: false/);
    expect(script.dependsOn).toEqual(["brief"]);
    expect(script.produces).toEqual(["script.md"]);
    // Every stage carries an id under the name the report uses.
    expect(body.data.stages.every((s: { stageId?: string }) => typeof s.stageId === "string")).toBe(true);
  });
});

// ── claim / complete ────────────────────────────────────────────────────────

describe("claim and complete over HTTP", () => {
  it("claims a stage, then completes it with the outputs the caller names", async () => {
    const { app, dir } = await appWithEpisode();

    const claimed = await app.inject({
      method: "POST", url: `${BASE}/stages/brief/claim`, payload: {},
    });
    const claim = claimed.json();
    expect(claim.ok).toBe(true);
    expect(claim.outcome.status).toBe("claimed");
    expect(typeof claim.outcome.leaseId).toBe("string");

    await writeFile(join(dir, "artifacts", "brief.md"), "a real brief");

    const done = await app.inject({
      method: "POST",
      url: `${BASE}/stages/brief/complete`,
      payload: { outputs: ["artifacts/brief.md"], leaseId: claim.outcome.leaseId },
    });
    await app.close();

    const body = done.json();
    expect(body.ok).toBe(true);
    // brief declares review: none, so completion IS the end of it.
    expect(body.outcome.status).toBe("completed");
    expect(body.outcome.outputs).toEqual(["artifacts/brief.md"]);

    expect((await journal(dir)).map((e) => e.type))
      .toEqual(["stage-leased", "stage-started", "stage-completed"]);
  });

  it("claims a stage the gateway has no handler for — a claim promises nothing about this process", async () => {
    // `brief` above is the point: /execute refuses it because the gateway
    // cannot perform it, and /claim takes it anyway, because a claim is a
    // promise to perform from somewhere else.
    const { app } = await appWithEpisode();
    const res = await app.inject({ method: "POST", url: `${BASE}/stages/brief/claim`, payload: {} });
    await app.close();
    expect(res.json().outcome.status).toBe("claimed");
  });

  it("forwards the leaseId, so a lapsed performer cannot close another holder's claim", async () => {
    const { app, dir } = await appWithEpisode();

    const claimed = await app.inject({
      method: "POST", url: `${BASE}/stages/brief/claim`, payload: {},
    });
    const leaseId = claimed.json().outcome.leaseId as string;
    await writeFile(join(dir, "artifacts", "brief.md"), "a real brief");

    const done = await app.inject({
      method: "POST",
      url: `${BASE}/stages/brief/complete`,
      payload: { outputs: ["artifacts/brief.md"], leaseId: "some-other-holders-lease" },
    });
    await app.close();

    const body = done.json();
    expect(body.ok).toBe(true);
    expect(body.outcome.status).toBe("blocked");
    expect(body.outcome.reason).toContain(leaseId);
    // Nothing was recorded against the real claim.
    expect((await journal(dir)).map((e) => e.type)).toEqual(["stage-leased", "stage-started"]);
  });

  it("refuses a completion that names no outputs and reports no failure", async () => {
    const { app } = await appWithEpisode();
    await app.inject({ method: "POST", url: `${BASE}/stages/brief/claim`, payload: {} });

    const res = await app.inject({
      method: "POST", url: `${BASE}/stages/brief/complete`, payload: {},
    });
    await app.close();

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.json().message).toMatch(/outputs is required/);
  });

  it("records a performer's reported failure", async () => {
    const { app, dir } = await appWithEpisode();
    const claimed = await app.inject({
      method: "POST", url: `${BASE}/stages/brief/claim`, payload: {},
    });
    const leaseId = claimed.json().outcome.leaseId as string;

    const res = await app.inject({
      method: "POST",
      url: `${BASE}/stages/brief/complete`,
      payload: { failed: true, error: "the model refused", leaseId },
    });
    await app.close();

    expect(res.json().outcome.status).toBe("failed");
    expect(res.json().outcome.reason).toBe("the model refused");
    expect((await journal(dir)).map((e) => e.type))
      .toEqual(["stage-leased", "stage-started", "stage-failed"]);
  });
});

// ── POST /rerun-plan ────────────────────────────────────────────────────────

describe("POST /rerun-plan", () => {
  it("plans a retry of the current stage", async () => {
    const { app, dir } = await appWithEpisode();
    await seedUpTo(dir, "brief");

    const res = await app.inject({
      method: "POST", url: `${BASE}/rerun-plan`, payload: { mode: "retry-current" },
    });
    await app.close();

    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.plan.mode).toBe("retry-current");
    expect(body.plan.episodeSlug).toBe(`${REF.channel}/${REF.series}/${REF.episode}`);
    expect(Array.isArray(body.plan.stages)).toBe(true);
  });

  it("refuses rerun-affected-downstream by name instead of planning nothing", async () => {
    // Computing it needs staleness propagation (avg-33r), which nothing
    // wires up. MODE_UNSUPPORTED, not STAGE_UNKNOWN: no stage is unknown, a
    // mode is unimplemented, and a caller told STAGE_UNKNOWN would go
    // looking for a typo in a stage id that was never the problem.
    const { app } = await appWithEpisode();

    const res = await app.inject({
      method: "POST", url: `${BASE}/rerun-plan`, payload: { mode: "rerun-affected-downstream" },
    });
    await app.close();

    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("MODE_UNSUPPORTED");
  });

  it("rejects the mode that never existed", async () => {
    // The schema offered "rerun-affected", which matches no RerunMode member
    // and never has. The studio's staleness panel sent it on every rerun and
    // reached a CLI that shrugged.
    const { app } = await appWithEpisode();

    const res = await app.inject({
      method: "POST", url: `${BASE}/rerun-plan`, payload: { mode: "rerun-affected" },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
  });

  it("refuses a selected stage the pipeline does not declare", async () => {
    const { app } = await appWithEpisode();

    const res = await app.inject({
      method: "POST",
      url: `${BASE}/rerun-plan`,
      payload: { mode: "rerun-selected", stageIds: ["not-a-stage"] },
    });
    await app.close();

    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("STAGE_UNKNOWN");
  });
});

// ── GET /episodes/:episode — the second consumer of the status projection ───

describe("the episode detail's pipeline enrichment", () => {
  async function detailApp(root: string, detail: Record<string, unknown>) {
    vi.stubEnv("AVG_LIBRARY_ROOT", root);
    const app = Fastify();
    const workspace = {
      getEpisode: async () => detail,
      listChannels: async () => [],
      listSeries: async () => [],
      listEpisodes: async () => [],
      findEvents: async () => [],
    } as unknown as WorkspaceService;
    registerWorkspaceRoutes(app, workspace);
    await app.ready();
    return app;
  }

  it("names every stage, rather than shipping a list of undefined ids", async () => {
    // This route read `s.id` off the status projection, which names it
    // `stageId`. Every stage in the episode detail had been arriving as
    // `{ id: undefined, name: undefined }` since the shape changed, and
    // nothing here had a test — which is why it could change silently.
    const { root, dir } = await episodeDir();
    await seedUpTo(dir, "brief");

    const app = await detailApp(root, {
      slug: REF.episode, pipeline: "narrated-illustrated-video",
    });
    const res = await app.inject({
      method: "GET",
      url: `/api/channels/${REF.channel}/series/${REF.series}/episodes/${REF.episode}`,
    });
    await app.close();

    const body = res.json();
    expect(body.pipeline).toBe("narrated-illustrated-video");
    const ids = body.stages.map((s: { id: string }) => s.id);
    expect(ids).toContain("brief");
    expect(ids).toContain("illustrations");
    expect(ids.every((id: unknown) => typeof id === "string")).toBe(true);

    const brief = body.stages.find((s: { id: string }) => s.id === "brief");
    expect(brief.name).toBe("Creative Brief");
    // `status` here is the pipeline-aware state, which is what the studio's
    // episode view colours on.
    expect(brief.status).toBe("completed");
    expect(brief.dependsOn).toEqual([]);
  });

  it("falls back to the workspace's own stages when the pipeline cannot be resolved", async () => {
    const { root } = await episodeDir();
    const app = await detailApp(root, {
      slug: REF.episode,
      pipeline: "no-such-pipeline",
      stages: [{ id: "from-workspace", name: "From Workspace" }],
    });
    const res = await app.inject({
      method: "GET",
      url: `/api/channels/${REF.channel}/series/${REF.series}/episodes/${REF.episode}`,
    });
    await app.close();

    expect(res.json().stages).toEqual([{ id: "from-workspace", name: "From Workspace" }]);
  });
});

// ── The event publisher — the third consumer ────────────────────────────────

describe("the event publisher's stage transitions", () => {
  function capture() {
    const bus = new EventBus();
    const seen: GatewayEvent[] = [];
    bus.subscribe({
      send: (e) => { seen.push(e); },
      close: () => {},
      isAlive: () => true,
    });
    return { bus, seen };
  }

  it("names the stage that moved, and only that stage", async () => {
    // It matched stages across polls with `previous.find(p => p.id === s.id)`.
    // With `id` undefined on both sides that predicate is true for the first
    // element every time: every stage matched the first, and every event
    // published `stageId: undefined`. Nothing tested this file, so all 297
    // gateway tests passed with it broken.
    const { root, dir } = await episodeDir();
    vi.stubEnv("AVG_LIBRARY_ROOT", root);
    const { bus, seen } = capture();
    const publisher = new EventPublisher({ bus, libraryRoot: root });

    // First poll establishes the baseline: nothing is published for it.
    await publisher.pollForEpisode(REF);
    expect(seen).toHaveLength(0);

    await seedCompleted(dir, "brief");
    await publisher.pollForEpisode(REF);

    const ids = seen.map((e) => e.data.stageId);
    expect(ids).toContain("brief");
    expect(ids).not.toContain(undefined);
    const brief = seen.find((e) => e.data.stageId === "brief")!;
    expect(brief.type).toBe("stage.completed");
    expect(brief.data.previousState).toBe("runnable");
    expect(brief.data.newState).toBe("completed");

    // `script` unblocked as a consequence, and is reported as itself rather
    // than as a second event about `brief`.
    const script = seen.find((e) => e.data.stageId === "script");
    expect(script?.type).toBe("stage.changed");
  });

  it("publishes nothing while nothing changes", async () => {
    const { root, dir } = await episodeDir();
    vi.stubEnv("AVG_LIBRARY_ROOT", root);
    await seedCompleted(dir, "brief");
    const { bus, seen } = capture();
    const publisher = new EventPublisher({ bus, libraryRoot: root });

    await publisher.pollForEpisode(REF);
    await publisher.pollForEpisode(REF);
    expect(seen).toHaveLength(0);
  });

  it("starts and stops without a runtime client", async () => {
    // `start` took a RuntimeClient it only used to poll `vpr status`. Task 8
    // deletes that method; the publisher no longer asks for the client.
    const { root } = await episodeDir();
    const { bus } = capture();
    const publisher = new EventPublisher({ bus, libraryRoot: root, pollMs: 60_000 });
    publisher.start({} as unknown as WorkspaceWatcher);
    publisher.stop();
    // `start` fires one poll immediately and does not hand back its promise.
    // Let it land before afterEach deletes the library out from under it.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});
