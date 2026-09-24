import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as fs from "node:fs/promises";
import { resolve, join } from "node:path";
import { loadConfig } from "../src/config/index.js";
import { resolveToken } from "../src/auth/index.js";
import { createGateway, type GatewayInstance } from "../src/server.js";
import { resolveInside, levelRoot, contentTypeFor } from "../src/routes/workspace-files.js";

const TMP = resolve(".test-tmp/workspace-files");

/**
 * The workspace file API is what lets the studio show what is actually on disk.
 * Before it existed the browser probed five hardcoded filenames, so a channel's
 * characters/ or references/ folder could never appear.
 */
describe("workspace file API", () => {
  let gateway: GatewayInstance;
  let baseUrl: string;
  let token: string;

  /** Channel-level endpoint under test. */
  const ch = () => `${baseUrl}/api/channels/acme`;

  const auth = () => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    await fs.rm(TMP, { recursive: true, force: true });
    await fs.mkdir(TMP, { recursive: true });

    const config = loadConfig();
    config.port = 0;
    config.host = "127.0.0.1";
    config.token.file = join(TMP, "token");
    // Alongside the token file, in the same throwaway directory: otherwise
    // `createGateway` resolves the operator key at its default
    // `.operator-key` and writes it into studio/gateway/ on every test run.
    config.operatorKey.file = join(TMP, "operator-key");
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
    // A channel with knowledge folders and one series, in layout 2.
    await fs.rm(join(TMP, "acme"), { recursive: true, force: true });
    await fs.mkdir(join(TMP, "acme", "characters"), { recursive: true });
    await fs.mkdir(join(TMP, "acme", "series", "s1", "episodes", "ep-01"), { recursive: true });
    await fs.writeFile(join(TMP, "acme", "channel.md"), "# Acme\n");
    await fs.writeFile(join(TMP, "acme", "characters", "hero.md"), "# Hero\n");
  });

  // ── Path safety (unit) ────────────────────────────────────────────────

  describe("resolveInside", () => {
    it("resolves a path within the level", () => {
      expect(resolveInside("/lib/ch", "notes/a.md")).toBe("/lib/ch/notes/a.md");
    });

    it("rejects traversal out of the level", () => {
      expect(resolveInside("/lib/ch", "../other/a.md")).toBeNull();
      expect(resolveInside("/lib/ch", "../../etc/passwd")).toBeNull();
    });

    it("rejects a sibling that merely shares a prefix", () => {
      // A startsWith check without a separator would let /lib/ch2 pass as
      // being inside /lib/ch.
      expect(resolveInside("/lib/ch", "../ch2/secret")).toBeNull();
    });

    it("treats a leading slash as relative to the level, not the filesystem", () => {
      expect(resolveInside("/lib/ch", "/etc/passwd")).toBe("/lib/ch/etc/passwd");
    });
  });

  describe("levelRoot", () => {
    it("places episodes inside the layout 2 containers", () => {
      expect(levelRoot("/lib", "episode", { channel: "c", series: "s", episode: "e" }))
        .toBe("/lib/c/series/s/episodes/e");
    });
  });

  describe("contentTypeFor", () => {
    it("classifies media so the studio can pick a viewer", () => {
      expect(contentTypeFor("a.md")).toBe("text/markdown");
      expect(contentTypeFor("a.mp4")).toBe("video/mp4");
      expect(contentTypeFor("a.glb")).toBe("model/gltf-binary");
      expect(contentTypeFor("a.unknown")).toBeNull();
    });
  });

  // ── Listing ───────────────────────────────────────────────────────────

  it("lists what is actually on disk, including knowledge folders", async () => {
    const res = await fetch(`${ch()}/files`, { headers: auth() });
    expect(res.status).toBe(200);
    const body = await res.json();

    const paths = body.entries.map((e: any) => e.path);
    expect(paths).toContain("characters");
    expect(paths).toContain("channel.md");
    expect(paths).toContain("series");

    // Directories sort before files.
    expect(body.entries[0].kind).toBe("directory");
  });

  it("lists recursively when asked", async () => {
    const res = await fetch(`${ch()}/files?recursive=true`, { headers: auth() });
    const body = await res.json();
    expect(body.entries.map((e: any) => e.path)).toContain("characters/hero.md");
  });

  it("hides workspace metadata", async () => {
    await fs.mkdir(join(TMP, "acme", ".workspace"), { recursive: true });
    const res = await fetch(`${ch()}/files`, { headers: auth() });
    const body = await res.json();
    expect(body.entries.map((e: any) => e.path)).not.toContain(".workspace");
  });

  it("404s for a directory that does not exist", async () => {
    const res = await fetch(`${ch()}/files?path=nope`, { headers: auth() });
    expect(res.status).toBe(404);
  });

  it("403s on traversal", async () => {
    const res = await fetch(`${ch()}/files?path=../..`, { headers: auth() });
    expect(res.status).toBe(403);
  });

  // ── Create ────────────────────────────────────────────────────────────

  it("creates a directory and a file", async () => {
    const dir = await fetch(`${ch()}/files`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ path: "references", kind: "directory" }),
    });
    expect(dir.status).toBe(201);

    const file = await fetch(`${ch()}/files`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ path: "references/palette.md", kind: "file", content: "# Palette\n" }),
    });
    expect(file.status).toBe(201);
    expect((await file.json()).revision).toBeTruthy();

    expect(await fs.readFile(join(TMP, "acme", "references", "palette.md"), "utf-8"))
      .toBe("# Palette\n");
  });

  it("refuses to overwrite through create", async () => {
    const res = await fetch(`${ch()}/files`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ path: "channel.md", kind: "file" }),
    });
    expect(res.status).toBe(409);
  });

  // ── Move ──────────────────────────────────────────────────────────────

  it("moves a file", async () => {
    const res = await fetch(`${ch()}/move`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ from: "characters/hero.md", to: "characters/villain.md" }),
    });
    expect(res.status).toBe(200);
    await expect(fs.access(join(TMP, "acme", "characters", "villain.md"))).resolves.toBeUndefined();
  });

  it("refuses to move onto an existing path", async () => {
    const res = await fetch(`${ch()}/move`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ from: "characters/hero.md", to: "channel.md" }),
    });
    expect(res.status).toBe(409);
  });

  // ── Delete ────────────────────────────────────────────────────────────

  it("deletes a file", async () => {
    const res = await fetch(`${ch()}/files?path=characters/hero.md`, {
      method: "DELETE",
      headers: auth(),
    });
    expect(res.status).toBe(200);
    await expect(fs.access(join(TMP, "acme", "characters", "hero.md"))).rejects.toThrow();
  });

  it("refuses to delete a non-empty directory without explicit intent", async () => {
    const res = await fetch(`${ch()}/files?path=characters`, {
      method: "DELETE",
      headers: auth(),
    });
    expect(res.status).toBe(409);
    // The directory must survive a refused delete.
    await expect(fs.access(join(TMP, "acme", "characters"))).resolves.toBeUndefined();
  });

  it("deletes a non-empty directory when recursive is requested", async () => {
    const res = await fetch(`${ch()}/files?path=characters&recursive=true`, {
      method: "DELETE",
      headers: auth(),
    });
    expect(res.status).toBe(200);
    await expect(fs.access(join(TMP, "acme", "characters"))).rejects.toThrow();
  });

  it("refuses to delete the workspace root", async () => {
    const res = await fetch(`${ch()}/files?path=.&recursive=true`, {
      method: "DELETE",
      headers: auth(),
    });
    expect(res.status).toBe(403);
    await expect(fs.access(join(TMP, "acme"))).resolves.toBeUndefined();
  });

  // ── Levels ────────────────────────────────────────────────────────────

  it("serves every level through the same API", async () => {
    const series = await fetch(`${baseUrl}/api/channels/acme/series/s1/files`, { headers: auth() });
    expect(series.status).toBe(200);
    expect((await series.json()).entries.map((e: any) => e.path)).toContain("episodes");

    const episode = await fetch(
      `${baseUrl}/api/channels/acme/series/s1/episodes/ep-01/files`,
      { headers: auth() },
    );
    expect(episode.status).toBe(200);
    expect((await episode.json()).level).toBe("episode");
  });

  it("requires authentication", async () => {
    const res = await fetch(`${ch()}/files`);
    expect(res.status).toBe(401);
  });
});

/**
 * Editing used to be destructive. The revisions endpoint read a
 * `.revisions.json` sidecar that nothing ever wrote, so it always answered []
 * — and the studio never called it. History now accrues from ordinary editing.
 */
describe("file revisions", () => {
  let gateway: GatewayInstance;
  let baseUrl: string;
  let token: string;

  const TMP2 = resolve(".test-tmp/revisions");
  const ch = () => `${baseUrl}/api/channels/acme`;
  const auth = () => ({ authorization: `Bearer ${token}` });
  const json = () => ({ ...auth(), "content-type": "application/json" });

  const write = (path: string, content: string, expectedRevision?: string) =>
    fetch(`${ch()}/files`, {
      method: "PUT",
      headers: json(),
      body: JSON.stringify({ path, content, expectedRevision }),
    });

  const revisions = async (path: string) =>
    (await (await fetch(`${ch()}/revisions?path=${encodeURIComponent(path)}`, { headers: auth() })).json()).revisions;

  beforeAll(async () => {
    await fs.rm(TMP2, { recursive: true, force: true });
    await fs.mkdir(join(TMP2, "acme"), { recursive: true });

    const config = loadConfig();
    config.port = 0;
    config.host = "127.0.0.1";
    config.token.file = join(TMP2, "token");
    config.operatorKey.file = join(TMP2, "operator-key");
    config.libraryRoots = [TMP2];

    token = resolveToken(config.token);
    gateway = await createGateway(config, token);
    baseUrl = await gateway.start();
  });

  afterAll(async () => {
    await gateway.stop();
    await fs.rm(TMP2, { recursive: true, force: true });
  });

  it("keeps a version each time a file changes", async () => {
    await write("notes.md", "first");
    expect(await revisions("notes.md")).toHaveLength(0); // nothing existed before the first write

    await write("notes.md", "second");
    await write("notes.md", "third");

    const list = await revisions("notes.md");
    expect(list).toHaveLength(2);
    // Newest first.
    expect(list[0].createdAt >= list[1].createdAt).toBe(true);
    expect(list.every((r: any) => r.contentAvailable)).toBe(true);
  });

  it("serves the content of an old version", async () => {
    await write("story.md", "draft one");
    await write("story.md", "draft two");

    const [prev] = await revisions("story.md");
    const res = await fetch(
      `${ch()}/revisions?path=story.md&id=${encodeURIComponent(prev.id)}`,
      { headers: auth() },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("draft one");
  });

  it("restores an old version, and the restore is itself undoable", async () => {
    await write("script.md", "version A");
    await write("script.md", "version B");

    const [oldest] = await revisions("script.md");
    const res = await fetch(`${ch()}/revisions/restore`, {
      method: "POST",
      headers: json(),
      body: JSON.stringify({ path: "script.md", id: oldest.id }),
    });
    expect(res.status).toBe(200);

    expect(await fs.readFile(join(TMP2, "acme", "script.md"), "utf-8")).toBe("version A");

    // "version B" must still be recoverable.
    const after = await revisions("script.md");
    expect(after.length).toBeGreaterThanOrEqual(2);
    const restoredFrom = await Promise.all(
      after.map(async (r: any) =>
        (await fetch(`${ch()}/revisions?path=script.md&id=${encodeURIComponent(r.id)}`, { headers: auth() })).text(),
      ),
    );
    expect(restoredFrom).toContain("version B");
  });

  it("keeps a copy when a file is deleted", async () => {
    await write("temp.md", "delete me");
    const res = await fetch(`${ch()}/files?path=temp.md`, { method: "DELETE", headers: auth() });
    expect(res.status).toBe(200);

    const list = await revisions("temp.md");
    expect(list.some((r: any) => r.reason === "delete")).toBe(true);
  });

  it("refuses a write based on a stale read", async () => {
    const first = await (await write("shared.md", "one")).json();
    await write("shared.md", "changed by someone else");

    const conflict = await write("shared.md", "my edit", first.revision);
    expect(conflict.status).toBe(409);
    // The other edit must survive.
    expect(await fs.readFile(join(TMP2, "acme", "shared.md"), "utf-8"))
      .toBe("changed by someone else");
  });

  it("hides the revision store from listings", async () => {
    await write("visible.md", "x");
    await write("visible.md", "y");
    const body = await (await fetch(`${ch()}/files?recursive=true`, { headers: auth() })).json();
    expect(body.entries.map((e: any) => e.path)).not.toContain(".revisions");
  });

  it("404s for an unknown revision and rejects traversal in the id", async () => {
    await write("guard.md", "x");
    expect((await fetch(`${ch()}/revisions?path=guard.md&id=nope`, { headers: auth() })).status).toBe(404);
    expect((await fetch(`${ch()}/revisions?path=guard.md&id=../../etc/passwd`, { headers: auth() })).status).toBe(404);
  });
});
