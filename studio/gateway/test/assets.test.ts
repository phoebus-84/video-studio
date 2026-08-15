import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as fs from "node:fs/promises";
import { resolve, join } from "node:path";
import { loadConfig } from "../src/config/index.js";
import { resolveToken } from "../src/auth/index.js";
import { createGateway, type GatewayInstance } from "../src/server.js";

const TMP = resolve(".test-tmp/assets");

/**
 * "Selected Asset" is a core term in the domain language and the asset schema
 * has always carried a `selected` flag, but nothing could change it: the studio
 * set the flag on a local object and never told anyone, so choosing a different
 * take survived until the page reloaded.
 */
describe("asset selection", () => {
  let gateway: GatewayInstance;
  let baseUrl: string;
  let token: string;

  const EP = () => `${baseUrl}/api/channels/acme/series/s1/episodes/ep-01`;
  const auth = () => ({ authorization: `Bearer ${token}` });
  const json = () => ({ ...auth(), "content-type": "application/json" });

  const manifestFile = join(
    TMP, "acme", "series", "s1", "episodes", "ep-01", "assets", "manifest.json",
  );

  const attempt = (id: string, sceneId: string, extra: Record<string, unknown> = {}) => ({
    id,
    sceneId,
    kind: "image",
    state: "ready",
    filePath: `assets/images/${id}.png`,
    provenance: { createdAt: "2026-08-01T00:00:00Z" },
    ...extra,
  });

  const readManifest = async () => JSON.parse(await fs.readFile(manifestFile, "utf-8"));

  const select = (attemptId: string) =>
    fetch(`${EP()}/assets/select`, {
      method: "POST",
      headers: json(),
      body: JSON.stringify({ attemptId }),
    });

  beforeAll(async () => {
    await fs.rm(TMP, { recursive: true, force: true });
    await fs.mkdir(TMP, { recursive: true });

    const config = loadConfig();
    config.port = 0;
    config.host = "127.0.0.1";
    config.token.file = join(TMP, "token");
    config.libraryRoots = [TMP];

    token = resolveToken(config.token);
    gateway = await createGateway(config, token);
    baseUrl = await gateway.start();
  });

  afterAll(async () => {
    await gateway.stop();
    await fs.rm(TMP, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await fs.mkdir(join(TMP, "acme", "series", "s1", "episodes", "ep-01", "assets"), {
      recursive: true,
    });
    await fs.writeFile(
      manifestFile,
      JSON.stringify({
        apiVersion: "v1alpha1",
        kind: "AssetManifest",
        updatedAt: "2026-08-01T00:00:00Z",
        assets: [
          {
            sceneId: "s1",
            sceneTitle: "Opening",
            attempts: [
              attempt("ast_a", "s1", { selected: true }),
              attempt("ast_b", "s1"),
              attempt("ast_c", "s1", { state: "failed" }),
            ],
          },
          {
            sceneId: "s2",
            sceneTitle: "Middle",
            attempts: [attempt("ast_d", "s2", { selected: true })],
          },
        ],
      }),
    );
  });

  it("lists attempts grouped by role", async () => {
    const res = await fetch(`${EP()}/assets`, { headers: auth() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assets).toHaveLength(2);
    expect(body.assets[0].attempts).toHaveLength(3);
  });

  it("answers empty for an episode that has generated nothing", async () => {
    const res = await fetch(
      `${baseUrl}/api/channels/acme/series/s1/episodes/nope/assets`,
      { headers: auth() },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).assets).toEqual([]);
  });

  it("persists the choice", async () => {
    const res = await select("ast_b");
    expect(res.status).toBe(200);

    const group = (await readManifest()).assets[0];
    expect(group.attempts.find((a: any) => a.id === "ast_b").selected).toBe(true);
    expect(group.attempts.find((a: any) => a.id === "ast_a").selected).toBe(false);
  });

  it("selects within a role and leaves other roles alone", async () => {
    await select("ast_b");
    const manifest = await readManifest();
    // s2's selection must be untouched.
    expect(manifest.assets[1].attempts[0].selected).toBe(true);
  });

  it("never has two attempts selected for one role", async () => {
    await select("ast_b");
    const group = (await readManifest()).assets[0];
    expect(group.attempts.filter((a: any) => a.selected)).toHaveLength(1);
  });

  it("refuses to select an attempt that is not ready", async () => {
    // Selecting a failed attempt would put a broken asset in the timeline and
    // the render would only discover it much later.
    const res = await select("ast_c");
    expect(res.status).toBe(409);

    const group = (await readManifest()).assets[0];
    expect(group.attempts.find((a: any) => a.id === "ast_a").selected).toBe(true);
  });

  it("404s for an unknown attempt without touching the manifest", async () => {
    const before = await readManifest();
    const res = await select("ast_nope");
    expect(res.status).toBe(404);
    expect(await readManifest()).toEqual(before);
  });

  it("preserves every other field on an attempt", async () => {
    await select("ast_b");
    const chosen = (await readManifest()).assets[0].attempts.find((a: any) => a.id === "ast_b");
    expect(chosen.provenance).toEqual({ createdAt: "2026-08-01T00:00:00Z" });
    expect(chosen.filePath).toBe("assets/images/ast_b.png");
    expect(chosen.kind).toBe("image");
  });

  it("records when the manifest changed", async () => {
    await select("ast_b");
    expect((await readManifest()).updatedAt).not.toBe("2026-08-01T00:00:00Z");
  });

  it("requires authentication", async () => {
    const res = await fetch(`${EP()}/assets`);
    expect(res.status).toBe(401);
  });
});
