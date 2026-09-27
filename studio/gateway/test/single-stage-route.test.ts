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
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendJournalEvent, parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { loadConfig } from "../src/config/index.js";
import { resolveToken } from "../src/auth/index.js";
import { createGateway } from "../src/server.js";
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
 * The root is passed as an option, which is how `registerRoutes` supplies it
 * in the server — not left to `AVG_LIBRARY_ROOT`. `AVG_LIBRARY_ROOT` is
 * deliberately stubbed to a DIFFERENT directory, so any handler that quietly
 * falls back to the environment writes somewhere these tests do not look and
 * fails loudly instead of passing by coincidence.
 *
 * `runtime` is a stub: nothing these routes still reach uses it. The three
 * that do — snapshot, approve, init — are Task 8's.
 */
async function appWithEpisode(opts: { withPrincipalHook?: boolean } = {}) {
  const { withPrincipalHook = false } = opts;
  const { root, dir } = await episodeDir();
  const decoy = await mkdtemp(join(tmpdir(), "gw-decoy-env-"));
  roots.push(decoy);
  vi.stubEnv("AVG_LIBRARY_ROOT", decoy);
  const app = Fastify();
  // Stands in for the auth middleware's `request.principal`, which
  // `registerProductionRoutes` does not itself set — see
  // review-routes.test.ts. Opt-in, not on by default: every other test in
  // this file exercises the ordinary agent-default path, and always
  // installing the hook would hide a route that forgot to read
  // `request.principal` behind Fastify's own default instead.
  if (withPrincipalHook) {
    app.addHook("preHandler", async (req) => {
      (req as any).principal = req.headers["x-test-principal"] === "operator" ? "operator" : "agent";
    });
  }
  const workspace = { getEpisode: async () => null } as unknown as WorkspaceService;
  // No operator key: nothing here records or reads a human decision, and
  // the routes take the key as a required option so no caller omits it.
  registerProductionRoutes(app, {} as unknown as RuntimeClient, workspace, { libraryRoot: root, operatorKey: null });
  await app.ready();
  return { app, root, dir, decoy };
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

  it("lets an operator past the autopilot wall; an agent stops there (Task 7)", async () => {
    // `script` declares `autopilot: false` and has no gateway handler. An
    // agent is refused at the attendance gate, naming autopilot; the
    // operator credential clears that gate and is refused one wall later,
    // by the dispatcher — the refusal this test pins no longer mentions
    // autopilot at all.
    const { app, dir } = await appWithEpisode({ withPrincipalHook: true });
    await seedUpTo(dir, "brief");

    const asAgent = await app.inject({
      method: "POST", url: `${BASE}/stages/script/execute`, payload: {},
    });
    const asOperator = await app.inject({
      method: "POST", url: `${BASE}/stages/script/execute`,
      headers: { "x-test-principal": "operator" }, payload: {},
    });
    await app.close();

    const agentBody = asAgent.json();
    expect(agentBody.ok).toBe(true);
    expect(agentBody.outcome.status).toBe("blocked");
    expect(agentBody.outcome.reason).toMatch(/autopilot: false/);

    const operatorBody = asOperator.json();
    expect(operatorBody.ok).toBe(true);
    expect(operatorBody.outcome.status).toBe("blocked");
    expect(operatorBody.outcome.reason).not.toMatch(/autopilot/);
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

  // Fix round 1 on task-2 (contracts): find-my-way matches an empty path
  // segment (a URL with `//` in it) as a present-but-empty route param, so
  // fastify's `required: [...]` schema — which only checks a key is present,
  // not non-empty — does not catch it. An empty `series` reaching the journal
  // as an episode ref makes `buildJournalEvent` throw (it now throws rather
  // than returning null for a malformed event), which would happen after a
  // lease was already taken. Rejected here, in `parseEpisode`, before any
  // service call — and thus before any lease exists to leak.
  it("refuses a route with an empty path segment before taking any lease", async () => {
    const { app, dir } = await appWithEpisode();

    const res = await app.inject({
      method: "POST",
      url: `/api/channels/${REF.channel}/series//episodes/${REF.episode}/stages/brief/claim`,
      payload: {},
    });
    await app.close();

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("BAD_REQUEST");

    // Nothing was leased against the real episode this malformed request
    // named a segment of.
    await expect(stat(join(dir, ".locks"))).rejects.toThrow();
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

  it("refuses a completion that names no leaseId", async () => {
    // The route's description tells a caller it has no excuse to omit this.
    // Leaving the field optional while saying so is the gap: `complete()`
    // without a lease id closes whichever claim is open, which is exactly the
    // hazard — a performer whose lease lapsed closing a second holder's claim.
    const { app, dir } = await appWithEpisode();
    await app.inject({ method: "POST", url: `${BASE}/stages/brief/claim`, payload: {} });
    await writeFile(join(dir, "artifacts", "brief.md"), "a real brief");

    const res = await app.inject({
      method: "POST",
      url: `${BASE}/stages/brief/complete`,
      payload: { outputs: ["artifacts/brief.md"] },
    });
    await app.close();

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.json().message).toMatch(/leaseId is required/);
    // The open claim is untouched: nothing was closed on a guess.
    expect((await journal(dir)).map((e) => e.type)).toEqual(["stage-leased", "stage-started"]);
  });

  it("refuses a failure report that names no leaseId", async () => {
    // A `failed` completion appends stage-failed against the claim it closes,
    // so an omitted lease id fails somebody else's live attempt. Same hazard
    // as the outputs path, and refused the same way.
    const { app, dir } = await appWithEpisode();
    await app.inject({ method: "POST", url: `${BASE}/stages/brief/claim`, payload: {} });

    const res = await app.inject({
      method: "POST",
      url: `${BASE}/stages/brief/complete`,
      payload: { failed: true, error: "the model refused" },
    });
    await app.close();

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.json().message).toMatch(/leaseId is required/);
    expect((await journal(dir)).map((e) => e.type)).toEqual(["stage-leased", "stage-started"]);
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

// ── The library root the routes write into ──────────────────────────────────

describe("the library root", () => {
  it("writes the journal into the root it was given, not the one in the environment", async () => {
    // These routes used to reach the library through RuntimeClient, which
    // server.ts builds with
    // `AVG_LIBRARY_ROOT ?? config.libraryRoots[0] ?? "./library"`. Composing
    // the service with `AVG_LIBRARY_ROOT ?? "./library"` dropped
    // `config.libraryRoots` — and nothing in this repo sets the variable,
    // while studio/gateway/config.json configures `../../library`. A claim
    // would have leased and journaled a stage into a `./library` beside the
    // process's cwd while the configured episode directory stayed empty, and
    // /status would then report a fully unstarted episode for a half-produced
    // one. The journal is the only record of what ran; writing it into a
    // shadow tree makes it authoritative about the wrong thing.
    const { app, dir, decoy } = await appWithEpisode();

    const claimed = await app.inject({
      method: "POST", url: `${BASE}/stages/brief/claim`, payload: {},
    });
    await app.close();

    expect(claimed.json().outcome.status).toBe("claimed");
    // Written where the server said, ...
    expect((await journal(dir)).map((e) => e.type)).toEqual(["stage-leased", "stage-started"]);
    // ... and nowhere else. `AVG_LIBRARY_ROOT` points at the decoy.
    await expect(readFile(join(
      decoy, REF.channel, "series", REF.series, "episodes", REF.episode, JOURNAL_RELATIVE_PATH,
    ), "utf-8")).rejects.toThrow();
    await expect(readFile(join(
      process.cwd(), "library", REF.channel, "series", REF.series, "episodes", REF.episode,
      JOURNAL_RELATIVE_PATH,
    ), "utf-8")).rejects.toThrow();
  });

  it("reports status from the root it was given", async () => {
    // The read half of the same defect: a /status pointed at the wrong tree
    // reports every stage pending for an episode that has run.
    const { app, dir } = await appWithEpisode();
    await seedUpTo(dir, "brief");

    const res = await app.inject({ method: "GET", url: `${BASE}/status` });
    await app.close();

    const brief = res.json().data.stages
      .find((s: { stageId: string }) => s.stageId === "brief");
    expect(brief.status).toBe("completed");
  });
});

// ── The composition root ────────────────────────────────────────────────────

describe("the gateway assembled by createGateway", () => {
  it("claims into the configured library, with AVG_LIBRARY_ROOT unset", async () => {
    // The tests above call `registerProductionRoutes` directly, so they pin
    // the registrar and not the wiring. Dropping the threading at
    // routes/index.ts's two call sites left all of them green — the only
    // thing that caught it was `noUnusedParameters` noticing `libraryRoot`
    // had become unused, which is incidental and would stop catching it the
    // moment anything else in that function read the value. Since this was
    // the worst defect on the branch and was invisible for exactly this
    // reason the first time, the composition root gets its own test.
    //
    // Built the way the server builds it: no AVG_LIBRARY_ROOT at all, the
    // root supplied only through `config.libraryRoots`, and the request going
    // through the real auth hook. `app.inject` rather than `start()` — this
    // needs the assembled app, not a bound port, and binding one is the flake
    // in integration.test.ts (avg-82z).
    vi.stubEnv("AVG_LIBRARY_ROOT", undefined);
    expect(process.env.AVG_LIBRARY_ROOT).toBeUndefined();

    const root = await mkdtemp(join(tmpdir(), "gw-composition-root-"));
    roots.push(root);
    const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
    await mkdir(join(dir, "artifacts"), { recursive: true });

    const config = loadConfig();
    config.port = 0;
    config.host = "127.0.0.1";
    config.token.file = join(root, "gateway.token");
    // Alongside the token file, or `createGateway` resolves the operator key
    // at its default `.operator-key` and writes it into studio/gateway/.
    config.operatorKey.file = join(root, "gateway.operator-key");
    config.libraryRoots = [root];
    const token = resolveToken(config.token);

    const gateway = await createGateway(config, token);
    try {
      const claimed = await gateway.app.inject({
        method: "POST",
        url: `${BASE}/stages/brief/claim`,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });

      expect(claimed.statusCode).toBe(200);
      expect(claimed.json().outcome.status).toBe("claimed");
    } finally {
      await gateway.stop();
    }

    // The journal landed in the library the config named ...
    expect((await journal(dir)).map((e) => e.type)).toEqual(["stage-leased", "stage-started"]);
    // ... and nothing was created beside the process's cwd, which is where
    // `AVG_LIBRARY_ROOT ?? "./library"` resolves to with the variable unset.
    await expect(stat(join(process.cwd(), "library", REF.channel))).rejects.toThrow();
  });

  it("lists episodes from the same library it executes them in", async () => {
    // The surviving half of the same defect. `createGateway` resolved
    // `libraryRoot` from `AVG_LIBRARY_ROOT ?? config.libraryRoots[0]` and
    // gave it to the execution service, the watcher and both route
    // registrars — then built the FileSystemWorkspaceService from the raw
    // `config.libraryRoots`, which does not know about the variable. With
    // AVG_LIBRARY_ROOT set and `libraryRoots` left at its `["."]` default,
    // the thing that LISTS episodes for the studio and the thing that
    // EXECUTES them read different trees: the studio showed fixture
    // channels while a claim leased and journaled into the real library.
    // Producing an episode into a library the gateway does not serve has
    // already cost this project an episode once.
    const root = await mkdtemp(join(tmpdir(), "gw-workspace-root-"));
    roots.push(root);
    const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
    await mkdir(join(dir, "artifacts"), { recursive: true });
    vi.stubEnv("AVG_LIBRARY_ROOT", root);

    const config = loadConfig();
    config.port = 0;
    config.host = "127.0.0.1";
    config.token.file = join(root, "gateway.token");
    // Alongside the token file, or `createGateway` resolves the operator key
    // at its default `.operator-key` and writes it into studio/gateway/.
    config.operatorKey.file = join(root, "gateway.operator-key");
    config.libraryRoots = ["."];   // the default: the env is the only pointer
    const token = resolveToken(config.token);

    const gateway = await createGateway(config, token);
    try {
      const listed = await gateway.app.inject({
        method: "GET", url: "/api/channels",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(listed.statusCode).toBe(200);
      const slugs = (listed.json() as { slug: string }[]).map((c) => c.slug);
      // The library the env names — not the fixture service's canned
      // "tech-explainer" / "tutorials", which is what this returned before.
      expect(slugs).toEqual([REF.channel]);

      // And it is the same tree the claim writes into.
      const claimed = await gateway.app.inject({
        method: "POST",
        url: `${BASE}/stages/brief/claim`,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });
      expect(claimed.json().outcome.status).toBe("claimed");
    } finally {
      await gateway.stop();
    }

    expect((await journal(dir)).map((e) => e.type)).toEqual(["stage-leased", "stage-started"]);
  });

  it("prefers AVG_OPERATOR_KEY_FILE over config.operatorKey.file", async () => {
    // The CLI's `resolveCliCredential` (studio/runtime/src/execution/
    // principal.ts) reads this variable first, falling back to
    // studio/gateway/.operator-key. The gateway has to honour the same
    // override, or an operator who pointed the CLI at a different key file
    // would silently stop being the operator to the gateway — the two
    // processes would disagree about who holds the credential (avg-qr4.3).
    const root = await mkdtemp(join(tmpdir(), "gw-operator-key-env-"));
    roots.push(root);

    const envKeyFile = join(root, "env-operator-key");
    const configKeyFile = join(root, "config-operator-key");
    await writeFile(envKeyFile, "env-provided-operator-key\n", { mode: 0o600 });
    vi.stubEnv("AVG_OPERATOR_KEY_FILE", envKeyFile);

    const config = loadConfig();
    config.port = 0;
    config.host = "127.0.0.1";
    config.token.file = join(root, "gateway.token");
    config.operatorKey.file = configKeyFile;
    config.libraryRoots = [root];
    const token = resolveToken(config.token);

    const gateway = await createGateway(config, token);
    try {
      // The env-pointed file's content authenticates as the operator.
      const withEnvKey = await gateway.app.inject({
        method: "GET", url: "/api/channels",
        headers: { authorization: "Bearer env-provided-operator-key" },
      });
      expect(withEnvKey.statusCode).toBe(200);
    } finally {
      await gateway.stop();
    }

    // The configured file was never even created: the environment variable
    // won before `resolveOperatorKey` ever saw `config.operatorKey.file`,
    // not merely before it was read.
    await expect(stat(configKeyFile)).rejects.toThrow();
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
  async function detailApp(
    root: string | undefined,
    detail: Record<string, unknown>,
  ) {
    const app = Fastify();
    const workspace = {
      getEpisode: async () => detail,
      listChannels: async () => [],
      listSeries: async () => [],
      listEpisodes: async () => [],
      findEvents: async () => [],
    } as unknown as WorkspaceService;
    registerWorkspaceRoutes(app, workspace, root, null);
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

  it("does not resolve a pipeline for a deployment that configured no library", async () => {
    // What the `if (runtime)` guard used to buy. Without it every
    // episode-detail request pays for a pipeline resolution and a journal
    // read, on a gateway that has no library to read.
    const app = await detailApp(undefined, {
      slug: REF.episode,
      pipeline: "narrated-illustrated-video",
      stages: [{ id: "from-workspace", name: "From Workspace" }],
    });
    const res = await app.inject({
      method: "GET",
      url: `/api/channels/${REF.channel}/series/${REF.series}/episodes/${REF.episode}`,
    });
    await app.close();

    expect(res.json().stages).toEqual([{ id: "from-workspace", name: "From Workspace" }]);
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
    const publisher = new EventPublisher({ bus, libraryRoot: root, operatorKey: null });

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
    const publisher = new EventPublisher({ bus, libraryRoot: root, operatorKey: null });

    await publisher.pollForEpisode(REF);
    await publisher.pollForEpisode(REF);
    expect(seen).toHaveLength(0);
  });

  it("starts and stops without a runtime client", async () => {
    // `start` took a RuntimeClient it only used to poll `vpr status`. Task 8
    // deletes that method; the publisher no longer asks for the client.
    const { root } = await episodeDir();
    const { bus } = capture();
    const publisher = new EventPublisher({ bus, libraryRoot: root, operatorKey: null, pollMs: 60_000 });
    publisher.start({} as unknown as WorkspaceWatcher);
    publisher.stop();
    // `start` fires one poll immediately and does not hand back its promise.
    // Let it land before afterEach deletes the library out from under it.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});
