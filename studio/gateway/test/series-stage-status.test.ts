// ---------------------------------------------------------------------------
// A spec-driven series episode's status through the gateway (avg-qwc): what
// Pi's pva_gather_context and the web studio's stage list read. Its stages
// come from its files, not the journal, since Pi makes it with tools that
// write files.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { specEpisode } from "@studio/episode/testing";
import { registerProductionRoutes } from "../src/routes/production.js";
import type { RuntimeClient } from "../src/runtime/client.js";
import type { WorkspaceService } from "../src/workspace/service.js";

const REF = { channel: "sample", series: "poetry", episode: "morning" };
const BASE = `/api/channels/${REF.channel}/series/${REF.series}/episodes/${REF.episode}`;
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function app(pipeline: string) {
  const root = await mkdtemp(join(tmpdir(), "gw-series-status-"));
  roots.push(root);
  specEpisode(join(root, REF.channel, "series", REF.series, "episodes", REF.episode), REF);
  const fastify = Fastify();
  const workspace = { getEpisode: async () => ({ pipeline }) } as unknown as WorkspaceService;
  registerProductionRoutes(fastify, {} as unknown as RuntimeClient, workspace, { libraryRoot: root, operatorKey: null });
  await fastify.ready();
  return fastify;
}

describe("GET /status of a spec-driven series episode", () => {
  it("reads its stages from its files", async () => {
    const res = await (await app("series-production")).inject({ method: "GET", url: `${BASE}/status` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.source).toBe("files");
    const by = Object.fromEntries(body.data.stages.map((s: { stageId: string; state: string; stateReason: string }) => [s.stageId, s]));
    expect([by.spec.state, by.pictures.state, by.takes.state, by.timeline.state]).toEqual(["completed", "completed", "completed", "pending"]);
    expect(by.timeline.stateReason).toContain("pva_build_timeline");
  });
});
