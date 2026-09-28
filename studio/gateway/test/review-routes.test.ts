// ---------------------------------------------------------------------------
// /approve and /reject over HTTP (avg-qr4.3)
// ---------------------------------------------------------------------------
// `/approve` used to shell out to `vpr approve` and hand back whatever the
// subprocess printed. It now goes through `ExecutionService.review` in
// process, the same call the CLI makes, and its verdict depends on who is
// asking: the operator credential signs a grant, anything else — including
// no credential at all — only requests one. `/reject` is new.
//
// Setup copies `single-stage-route.test.ts`'s `appWithEpisode`: a throwaway
// library, a decoy `AVG_LIBRARY_ROOT` so a handler that falls back to the
// environment fails loudly, and the shipped `narrated-illustrated-video`
// manifest. `illustrations` is the stage under test: it declares
// `review: human` with `autopilot: true`, so — unlike `script`, which is
// `autopilot: false` and cannot yet be claimed over HTTP (Task 7) — it can be
// driven to `awaiting_review` through the real `/execute` route, exactly as
// "performs a stage the gateway has a handler for, and journals it" in
// single-stage-route.test.ts already proves.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendJournalEvent, parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { registerProductionRoutes } from "../src/routes/production.js";
import type { RuntimeClient } from "../src/runtime/client.js";
import type { WorkspaceService } from "../src/workspace/service.js";

const KEY = "operator-key-for-review-routes-test";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.unstubAllEnvs();
});

const REF = { channel: "childrens", series: "fairy-tales", episode: "ep" };
const BASE = `/api/channels/${REF.channel}/series/${REF.series}/episodes/${REF.episode}`;
const STAGE = "illustrations";

async function episodeDir() {
  const root = await mkdtemp(join(tmpdir(), "gw-review-route-"));
  roots.push(root);
  const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
  await mkdir(join(dir, "artifacts"), { recursive: true });
  await mkdir(join(dir, "assets", "images"), { recursive: true });
  return { root, dir };
}

/**
 * Record a stage as completed, the way a real run would — copied from
 * single-stage-route.test.ts. Three events, because replay identifies an
 * attempt by its lease: a terminal event with no lease cannot be placed in
 * the history.
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

/**
 * The real routes over the real Fastify stack, pointed at a throwaway
 * library — `appWithEpisode` from single-stage-route.test.ts, plus the
 * operator key and a hook standing in for the auth middleware: it sets
 * `request.principal` from a test header instead of a bearer token, since
 * `registerProductionRoutes` installs no auth hook of its own (that lives in
 * server.ts's global preHandler — see gate-enforcement.test.ts for why these
 * route tests don't register it).
 */
async function appWithEpisode(opts: { withPrincipalHook?: boolean } = {}) {
  const { withPrincipalHook = true } = opts;
  const { root, dir } = await episodeDir();
  const decoy = await mkdtemp(join(tmpdir(), "gw-decoy-env-"));
  roots.push(decoy);
  vi.stubEnv("AVG_LIBRARY_ROOT", decoy);
  const app = Fastify();
  if (withPrincipalHook) {
    app.addHook("preHandler", async (req) => {
      (req as any).principal = req.headers["x-test-principal"] === "operator" ? "operator" : "agent";
    });
  }
  const workspace = { getEpisode: async () => null } as unknown as WorkspaceService;
  registerProductionRoutes(app, {} as unknown as RuntimeClient, workspace, { libraryRoot: root, operatorKey: KEY });
  await app.ready();
  return { app, root, dir, decoy };
}

/** Drive `illustrations` to `awaiting_review`: seed its dependencies, write the asset the dispatcher reads, then execute it for real. */
async function toAwaitingReview(app: ReturnType<typeof Fastify>, dir: string) {
  await seedUpTo(dir, "brief", "script", "art-direction");
  await writeFile(join(dir, "assets", "images", "s1.png"), "not really a png, but bytes");
  const res = await app.inject({
    method: "POST", url: `${BASE}/stages/${STAGE}/execute`, payload: {},
  });
  const body = res.json();
  if (body.outcome?.status !== "awaiting_review") {
    throw new Error(`setup failed: expected awaiting_review, got ${JSON.stringify(body)}`);
  }
}

describe("POST /stages/:stage/approve", () => {
  it("approve with the operator credential writes a signed grant", async () => {
    const { app, dir } = await appWithEpisode();
    await toAwaitingReview(app, dir);

    const res = await app.inject({
      method: "POST", url: `${BASE}/stages/${STAGE}/approve`,
      headers: { "x-test-principal": "operator" }, payload: {},
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.outcome.status).toBe("approved");

    const events = await journal(dir);
    const grant = events.find((e) => e.type === "approval-granted");
    expect(grant).toBeDefined();
    expect((grant!.data as { origin?: string }).origin).toBe("human");
    expect((grant!.data as { signature?: unknown }).signature).toBeDefined();
  });

  it("approve with the agent credential yields a request, not a grant", async () => {
    const { app, dir } = await appWithEpisode();
    await toAwaitingReview(app, dir);

    const res = await app.inject({
      method: "POST", url: `${BASE}/stages/${STAGE}/approve`, payload: {},
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.outcome.status).toBe("requested");
  });

  it("a route with no principal set is an agent", async () => {
    const { app, dir } = await appWithEpisode({ withPrincipalHook: false });
    await toAwaitingReview(app, dir);

    const res = await app.inject({
      method: "POST", url: `${BASE}/stages/${STAGE}/approve`, payload: {},
    });
    await app.close();

    expect(res.json().outcome.status).toBe("requested");
  });
});

// avg-qr4.3 final review, M1: the body schema declared only an unused
// `justification`, so Fastify stripped a `note`, and `pva_request_approval`
// had no way to ask without the route treating it as an approval.
describe("POST /stages/:stage/approve body", () => {
  it("passes the note through to the grant", async () => {
    const { app, dir } = await appWithEpisode();
    await toAwaitingReview(app, dir);

    const res = await app.inject({
      method: "POST", url: `${BASE}/stages/${STAGE}/approve`,
      headers: { "x-test-principal": "operator" }, payload: { note: "the palette works" },
    });
    await app.close();

    expect(res.json().outcome.status).toBe("approved");
    const grant = (await journal(dir)).find((e) => e.type === "approval-granted");
    expect((grant!.data as { note?: string }).note).toBe("the palette works");
  });

  it("request: true writes a request with its note, even for the operator", async () => {
    const { app, dir } = await appWithEpisode();
    await toAwaitingReview(app, dir);
    const before = (await journal(dir)).length;

    const res = await app.inject({
      method: "POST", url: `${BASE}/stages/${STAGE}/approve`,
      headers: { "x-test-principal": "operator" }, payload: { request: true, note: "please check scene 3" },
    });
    await app.close();

    expect(res.json().outcome.status).toBe("requested");
    const added = (await journal(dir)).slice(before);
    expect(added.map((e) => e.type)).toEqual(["approval-requested"]);
    expect((added[0]!.data as { note?: string }).note).toBe("please check scene 3");
  });
});

describe("POST /stages/:stage/reject", () => {
  it("reject requires a note", async () => {
    const { app, dir } = await appWithEpisode();
    await toAwaitingReview(app, dir);

    const res = await app.inject({
      method: "POST", url: `${BASE}/stages/${STAGE}/reject`,
      headers: { "x-test-principal": "operator" }, payload: {},
    });
    await app.close();

    expect(res.statusCode).toBe(400);
  });

  it("reject with a note records it", async () => {
    const { app, dir } = await appWithEpisode();
    await toAwaitingReview(app, dir);

    const res = await app.inject({
      method: "POST", url: `${BASE}/stages/${STAGE}/reject`,
      headers: { "x-test-principal": "operator" }, payload: { note: "no" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.outcome.status).toBe("rejected");

    const events = await journal(dir);
    const rejection = events.find((e) => e.type === "approval-rejected");
    expect(rejection).toBeDefined();
    expect((rejection!.data as { note?: string }).note).toBe("no");
  });
});
