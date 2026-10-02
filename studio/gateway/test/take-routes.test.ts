// ---------------------------------------------------------------------------
// /takes and /select over HTTP (avg-qr4.6)
// ---------------------------------------------------------------------------
// The same composition review-routes.test.ts uses: a throwaway library, a
// decoy AVG_LIBRARY_ROOT, the shipped manifest, and a hook standing in for
// the auth middleware so a test header decides the principal. `illustrations`
// is performed for real, twice, through `/execute`, with different asset
// bytes each time, so there are two candidates to choose between.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendJournalEvent } from "@studio/contracts/src/journal.mjs";
import { registerProductionRoutes } from "../src/routes/production.js";
import type { RuntimeClient } from "../src/runtime/client.js";
import type { WorkspaceService } from "../src/workspace/service.js";

const KEY = "operator-key-for-take-routes-test";
const REF = { channel: "childrens", series: "fairy-tales", episode: "ep" };
const BASE = `/api/channels/${REF.channel}/series/${REF.series}/episodes/${REF.episode}`;
const STAGE = "illustrations";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.unstubAllEnvs();
});

let seedCounter = 0;
async function seedCompleted(dir: string, stageId: string) {
  const leaseId = `seeded-${stageId}-${seedCounter++}`;
  const common = { episode: REF, actor: "runtime" as const };
  await appendJournalEvent(dir, {
    type: "stage-leased", ...common,
    data: {
      stageId, leaseId, attemptNumber: 1, ttlMs: 600_000,
      expiresAt: new Date(Date.now() + 600_000).toISOString(), holder: "seed",
    },
  });
  await appendJournalEvent(dir, { type: "stage-started", ...common, data: { stageId, leaseId, attemptNumber: 1 } });
  await appendJournalEvent(dir, { type: "stage-completed", ...common, data: { stageId, leaseId, attemptNumber: 1, outputs: [] } });
}

async function appWithTwoTakes() {
  const root = await mkdtemp(join(tmpdir(), "gw-take-route-"));
  roots.push(root);
  const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
  await mkdir(join(dir, "artifacts"), { recursive: true });
  await mkdir(join(dir, "assets", "images"), { recursive: true });
  const decoy = await mkdtemp(join(tmpdir(), "gw-decoy-env-"));
  roots.push(decoy);
  vi.stubEnv("AVG_LIBRARY_ROOT", decoy);

  const app = Fastify();
  app.addHook("preHandler", async (req) => {
    (req as { principal?: string }).principal = req.headers["x-test-principal"] === "operator" ? "operator" : "agent";
  });
  const workspace = { getEpisode: async () => null } as unknown as WorkspaceService;
  registerProductionRoutes(app, {} as unknown as RuntimeClient, workspace, { libraryRoot: root, operatorKey: KEY });
  await app.ready();

  for (const id of ["brief", "script", "art-direction"]) await seedCompleted(dir, id);
  for (const bytes of ["first illustration", "second illustration"]) {
    // The adapter adopts an asset only where no frame exists yet, so the
    // previous frame goes first — as it would for a fresh render.
    await rm(join(dir, "artifacts", "frames", "s1.png"), { force: true });
    await writeFile(join(dir, "assets", "images", "s1.png"), bytes);
    const res = await app.inject({ method: "POST", url: `${BASE}/stages/${STAGE}/execute`, payload: {} });
    if (res.json().outcome?.status !== "awaiting_review") {
      throw new Error(`setup failed: ${res.body}`);
    }
  }
  return { app, dir };
}

const frame = (dir: string) => readFile(join(dir, "artifacts", "frames", "s1.png"), "utf-8");

describe("GET /takes", () => {
  it("lists the stage's candidates and its selected take", async () => {
    const { app } = await appWithTwoTakes();
    const res = await app.inject({ method: "GET", url: `${BASE}/takes` });
    await app.close();
    expect(res.statusCode).toBe(200);
    const stage = res.json().stages.find((s: { stageId: string }) => s.stageId === STAGE);
    expect(stage.selected).toMatchObject({ attemptNumber: 2, origin: "policy", locked: false });
    expect(stage.candidates.map((c: { attemptNumber: number }) => c.attemptNumber)).toEqual([1, 2]);
    expect(stage.drifted).toEqual([]);
  });
});

describe("POST /stages/:stage/select", () => {
  it("puts the operator's choice in place and locks it against an agent", async () => {
    const { app, dir } = await appWithTwoTakes();
    const chosen = await app.inject({
      method: "POST", url: `${BASE}/stages/${STAGE}/select`,
      headers: { "x-test-principal": "operator" }, payload: { attempt: 1, expected: 2 },
    });
    expect(chosen.json().outcome.status).toBe("selected");
    expect(await frame(dir)).toBe("first illustration");

    const agent = await app.inject({
      method: "POST", url: `${BASE}/stages/${STAGE}/select`, payload: { attempt: 2 },
    });
    await app.close();
    expect(agent.json().outcome.status).toBe("blocked");
    expect(agent.json().outcome.reason).toMatch(/only the operator can change it/);
    expect(await frame(dir)).toBe("first illustration");
  });

  it("refuses a selection made against a take that is no longer selected", async () => {
    const { app, dir } = await appWithTwoTakes();
    const res = await app.inject({
      method: "POST", url: `${BASE}/stages/${STAGE}/select`, payload: { attempt: 1, expected: 1 },
    });
    await app.close();
    expect(res.json().outcome.status).toBe("blocked");
    expect(res.json().outcome.reason).toMatch(/changed since it was read/);
    expect(await frame(dir)).toBe("second illustration");
  });

  it("refuses a body with no attempt", async () => {
    const { app } = await appWithTwoTakes();
    const res = await app.inject({ method: "POST", url: `${BASE}/stages/${STAGE}/select`, payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});
