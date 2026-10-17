import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { checkMedia, MEDIA_LOCK, readMediaLock, writeMediaLock } from "../../src/channel-repo.js";
import { checkRemoteMedia, MEDIA_REMOTE, mediaObjectKey, mediaTier, readMediaRemote, transferMedia } from "../../src/media-remote.js";
import type { MediaObjectStore } from "../../src/media-s3.js";

const EP = "series/test/episodes/one";
const IMAGE = `${EP}/assets/plate.png`;
const sha = (data: string | Buffer) => `sha256:${createHash("sha256").update(data).digest("hex")}`;
let root: string;
let channel: string;
const put = (path: string, data: string) => {
  mkdirSync(dirname(join(channel, path)), { recursive: true });
  writeFileSync(join(channel, path), data);
};
const config = (extra: Record<string, unknown> = {}) => put(MEDIA_REMOTE, JSON.stringify({
  apiVersion: "studio.video/v1alpha1", kind: "MediaRemote", url: "s3://media/shared/", region: "auto", ...extra,
}));
const lockRows = (rows: unknown[]) => put(MEDIA_LOCK, rows.map((row) => JSON.stringify(row)).join("\n"));

class MemoryStore implements MediaObjectStore {
  objects = new Map<string, Buffer>();
  calls = { head: 0, put: 0, get: 0 };
  corrupt = false;
  failGet = false;
  async head(key: string) { this.calls.head++; const value = this.objects.get(key); return value ? { size: value.length } : undefined; }
  async put(key: string, file: string) {
    this.calls.put++;
    if (this.objects.has(key)) return false;
    this.objects.set(key, readFileSync(file));
    return true;
  }
  async get(key: string) {
    this.calls.get++;
    if (this.failGet) throw new Error("interrupted");
    const value = this.objects.get(key)!;
    return Readable.from(this.corrupt ? Buffer.alloc(value.length, "X") : value);
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "media-remote-"));
  channel = join(root, "sample");
  mkdirSync(channel);
  config();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("remote configuration and policy", () => {
  it("uses explicit first-prefix rules, keeps unknown media, and lets a rule override deliveries", () => {
    config({ rules: [{ prefix: `${EP}/assets/loops`, tier: "derived" }, { prefix: `${EP}/output/final-keep.mp4`, tier: "masters" }] });
    const remote = readMediaRemote(channel);
    expect(remote.keep).toContain("other");
    expect(mediaTier(`${EP}/assets/loops/f0001.png`, remote)).toBe("derived");
    expect(mediaTier(`${EP}/assets/loops-other/file.png`, remote)).toBe("other");
    expect(mediaTier(`${EP}/output/final-hour.mp4`, remote)).toBe("deliveries");
    expect(mediaTier(`${EP}/output/final-keep.mp4`, remote)).toBe("masters");
    expect(mediaObjectKey(remote, sha("a"))).toBe(`shared/sha256/ca/${sha("a").slice(7)}`);
  });

  it.each([
    { accessKeyId: "not-a-real-secret" }, { endpoint: "https://user:secret@example.invalid" },
    { endpoint: "http://example.invalid" }, { url: "s3://media/a/../b" },
    { url: "s3://media/x?secret=no" }, { keep: ["typo"] }, { checksum: "false" },
    { rules: [{ prefix: "../escape", tier: "paid" }] },
  ])("rejects invalid/secret-bearing config %j", (extra) => {
    config(extra);
    expect(() => readMediaRemote(channel)).toThrow();
  });
});

describe("media transfers", () => {
  it("pushes unique objects, skips them on rerun, and never changes the lock", async () => {
    const store = new MemoryStore();
    put(IMAGE, "plate");
    put(`${EP}/assets/copy.png`, "plate");
    writeMediaLock(channel);
    const lock = readFileSync(join(channel, MEDIA_LOCK), "utf8");
    const report = await transferMedia(channel, "push", { store });
    expect(report).toMatchObject({ ok: true, bytes: 5, transferred: [IMAGE.replace("plate", "copy"), IMAGE] });
    expect(store.calls).toEqual({ head: 1, put: 1, get: 0 });
    expect((await transferMedia(channel, "push", { store })).bytes).toBe(0);
    expect(store.calls.put).toBe(1);
    expect(readFileSync(join(channel, MEDIA_LOCK), "utf8")).toBe(lock);
  });

  it("dry-runs both directions without files, cache, directories, GETs or PUTs", async () => {
    const store = new MemoryStore();
    put(IMAGE, "plate");
    put(`${EP}/output/final-hour.mp4`, "long");
    writeMediaLock(channel);
    const push = await transferMedia(channel, "push", { store, dryRun: true });
    expect(push).toMatchObject({ ok: true, planned: [IMAGE], plannedBytes: 5, excluded: { deliveries: { files: 1, bytes: 4 } } });
    expect(store.calls.put).toBe(0);
    await transferMedia(channel, "push", { store, tiers: ["all"] });
    rmSync(join(channel, "series"), { recursive: true });
    rmSync(join(channel, ".cache"), { recursive: true });
    const pull = await transferMedia(channel, "pull", { store, dryRun: true, tiers: ["all"] });
    expect(pull.planned).toHaveLength(2);
    expect(store.calls.get).toBe(0);
    expect(readdirSync(channel).sort()).toEqual([MEDIA_LOCK, MEDIA_REMOTE]);
  });

  it("restores scoped files and safe symlink chains, verifies bytes, and resumes", async () => {
    const store = new MemoryStore();
    put(IMAGE, "plate");
    put("series/test/episodes/two/assets/other.png", "other");
    symlinkSync("plate.png", join(channel, EP, "assets", "link.png"));
    symlinkSync("link.png", join(channel, EP, "assets", "chain.png"));
    writeMediaLock(channel);
    await transferMedia(channel, "push", { store });
    rmSync(join(channel, "series"), { recursive: true });
    const dry = await transferMedia(channel, "pull", { store, episode: "test/one", dryRun: true });
    expect(dry.ok).toBe(true);
    expect(dry.planned).toHaveLength(3);
    const restored = await transferMedia(channel, "pull", { store, episode: "test/one" });
    expect(restored).toMatchObject({ ok: true, bytes: 5 });
    expect(restored.transferred).toHaveLength(3);
    expect(readFileSync(join(channel, IMAGE), "utf8")).toBe("plate");
    expect(readlinkSync(join(channel, EP, "assets", "chain.png"))).toBe("link.png");
    expect(existsSync(join(channel, "series/test/episodes/two"))).toBe(false);
    expect((await transferMedia(channel, "pull", { store, episode: "test/one" })).transferred).toEqual([]);
    expect(store.calls.get).toBe(1);
    expect((await checkRemoteMedia(channel, { store, episode: "test/one", verify: true })).ok).toBe(true);
  });

  it("includes explicitly linked channel sources in episode scope", async () => {
    const store = new MemoryStore();
    put("sources/sea/plate.png", "plate");
    mkdirSync(dirname(join(channel, IMAGE)), { recursive: true });
    symlinkSync("../../../../../sources/sea/plate.png", join(channel, IMAGE));
    writeMediaLock(channel);
    await transferMedia(channel, "push", { store });
    rmSync(join(channel, "sources"), { recursive: true });
    rmSync(join(channel, "series"), { recursive: true });
    expect((await transferMedia(channel, "pull", { store, episode: "test/one" })).ok).toBe(true);
    expect(readFileSync(join(channel, IMAGE), "utf8")).toBe("plate");
  });

  it("refuses corrupted downloads, removes temp files, and succeeds after retry", async () => {
    const store = new MemoryStore();
    put(IMAGE, "plate");
    writeMediaLock(channel);
    await transferMedia(channel, "push", { store });
    rmSync(join(channel, IMAGE));
    store.corrupt = true;
    const bad = await transferMedia(channel, "pull", { store });
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]?.error).toMatch(/hash/);
    expect(readdirSync(dirname(join(channel, IMAGE)))).toEqual([]);
    store.corrupt = false;
    store.failGet = true;
    expect((await transferMedia(channel, "pull", { store })).ok).toBe(false);
    store.failGet = false;
    expect((await transferMedia(channel, "pull", { store })).ok).toBe(true);
    expect(checkMedia(channel, { verify: true }).ok).toBe(true);
  });

  it.each(["oversized", "truncated", "interrupted"])("cleans a %s download without publishing it", async (failure) => {
    const store = new MemoryStore();
    put(IMAGE, "plate");
    writeMediaLock(channel);
    await transferMedia(channel, "push", { store });
    rmSync(join(channel, IMAGE));
    store.get = async () => failure === "interrupted"
      ? Readable.from((async function* () { yield Buffer.from("pla"); throw new Error("stream interrupted"); })())
      : Readable.from(Buffer.from(failure === "oversized" ? "plate-too-long" : "pla"));
    const report = await transferMedia(channel, "pull", { store });
    expect(report.ok).toBe(false);
    expect(report.errors).toHaveLength(1);
    expect(readdirSync(dirname(join(channel, IMAGE)))).toEqual([]);
  });

  it("does not promise a link whose intermediate target is excluded, even in a dry run", async () => {
    const store = new MemoryStore();
    put(IMAGE, "plate");
    symlinkSync("plate.png", join(channel, EP, "assets", "middle.png"));
    symlinkSync("middle.png", join(channel, EP, "assets", "outer.png"));
    writeMediaLock(channel);
    await transferMedia(channel, "push", { store });
    rmSync(join(channel, "series"), { recursive: true });
    config({ rules: [{ prefix: `${EP}/assets/middle.png`, tier: "derived" }] });
    const dry = await transferMedia(channel, "pull", { store, dryRun: true });
    expect(dry.ok).toBe(false);
    expect(dry.errors[0]?.error).toMatch(/Missing symlink target/);
    expect(existsSync(join(channel, "series"))).toBe(false);
  });

  it("reports cancellation as an error without starting network work", async () => {
    const store = new MemoryStore();
    put(IMAGE, "plate");
    writeMediaLock(channel);
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    expect((await transferMedia(channel, "push", { store, signal: controller.signal })).errors[0]?.error).toBe("cancelled");
    expect(store.calls).toEqual({ head: 0, put: 0, get: 0 });
  });

  it("never overwrites changed media or an existing dangling symlink, and never uploads stale hashes", async () => {
    const store = new MemoryStore();
    put(IMAGE, "plate");
    writeMediaLock(channel);
    put(IMAGE, "edited");
    expect((await transferMedia(channel, "push", { store })).changed).toEqual([IMAGE]);
    expect(store.calls.put).toBe(0);
    expect((await transferMedia(channel, "pull", { store })).changed).toEqual([IMAGE]);
    expect(readFileSync(join(channel, IMAGE), "utf8")).toBe("edited");
    rmSync(join(channel, IMAGE));
    symlinkSync("absent.png", join(channel, IMAGE));
    expect((await transferMedia(channel, "pull", { store })).changed).toEqual([IMAGE]);
    expect(readlinkSync(join(channel, IMAGE))).toBe("absent.png");
  });

  it("publishes exclusively when another writer creates the destination during GET", async () => {
    const store = new MemoryStore();
    put(IMAGE, "plate");
    writeMediaLock(channel);
    await transferMedia(channel, "push", { store });
    rmSync(join(channel, IMAGE));
    const get = store.get.bind(store);
    store.get = async (key) => { put(IMAGE, "other writer"); return get(key); };
    expect((await transferMedia(channel, "pull", { store })).errors[0]?.error).toMatch(/EEXIST/);
    expect(readFileSync(join(channel, IMAGE), "utf8")).toBe("other writer");
  });

  it("reports merged-path ambiguity instead of choosing one version", async () => {
    const store = new MemoryStore();
    lockRows([{ path: IMAGE, hash: sha("a"), size: 1 }, { path: IMAGE, hash: sha("b"), size: 1 }]);
    expect((await transferMedia(channel, "pull", { store })).ambiguous).toEqual([IMAGE]);
    expect((await transferMedia(channel, "push", { store })).ambiguous).toEqual([IMAGE]);
    expect(store.calls).toEqual({ head: 0, get: 0, put: 0 });
    expect((await checkRemoteMedia(channel, { store })).ambiguous).toEqual([IMAGE]);
  });

  it("reports remote availability separately from local readiness, and keeps unlisted files visible", async () => {
    const store = new MemoryStore();
    put(IMAGE, "plate");
    writeMediaLock(channel);
    await transferMedia(channel, "push", { store });
    rmSync(join(channel, IMAGE));
    put(`${EP}/assets/unlisted.png`, "new");
    expect(await checkRemoteMedia(channel, { store, episode: "test/one" })).toMatchObject({
      ok: false, remote: [IMAGE], missing: [], unlisted: [`${EP}/assets/unlisted.png`],
    });
    store.objects.clear();
    expect((await checkRemoteMedia(channel, { store })).missing).toEqual([IMAGE]);
  });

  it("bounds concurrent network work", async () => {
    const store = new MemoryStore();
    let active = 0;
    let peak = 0;
    store.head = async () => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return undefined;
    };
    for (let i = 0; i < 12; i++) put(`${EP}/assets/${i}.png`, `${i}`);
    writeMediaLock(channel);
    await transferMedia(channel, "push", { store, concurrency: 2, dryRun: true });
    expect(peak).toBe(2);
  });
});

describe("untrusted locks and parents", () => {
  it.each(["../outside.png", "/absolute.png", "a/../../outside.png", ".git/payload.png", "a\\outside.png", "a/.cache/payload.png"])("refuses %s before contacting the remote", async (path) => {
    const store = new MemoryStore();
    lockRows([{ path, hash: sha("a"), size: 1 }]);
    await expect(transferMedia(channel, "pull", { store })).rejects.toThrow(/Unsafe/);
    expect(store.calls.head).toBe(0);
  });

  it.each(["../../../../../../outside.png", "/outside.png", "sub/../plate.png"])("refuses escaping/noncanonical link %s", async (link) => {
    lockRows([{ path: IMAGE, link }]);
    await expect(transferMedia(channel, "pull", { store: new MemoryStore() })).rejects.toThrow(/Unsafe/);
  });

  it("refuses symlinked parents and link cycles", async () => {
    mkdirSync(join(root, "outside"));
    symlinkSync(join(root, "outside"), join(channel, "assets"));
    lockRows([{ path: "assets/plate.png", hash: sha("a"), size: 1 }]);
    await expect(transferMedia(channel, "pull", { store: new MemoryStore() })).rejects.toThrow(/parent/);
    lockRows([{ path: "one.png", link: "two.png" }, { path: "two.png", link: "one.png" }]);
    await expect(transferMedia(channel, "pull", { store: new MemoryStore() })).rejects.toThrow(/Cyclic/);
  });

  it("rejects malformed hashes/sizes, unknown tiers, invalid scopes and bad concurrency", async () => {
    const store = new MemoryStore();
    put(IMAGE, "plate");
    writeMediaLock(channel);
    for (const options of [{ tiers: ["unknown"] }, { episode: "../one" }, { episode: "test/missing" }, { concurrency: 0 }, { concurrency: 17 }]) {
      await expect(transferMedia(channel, "pull", { ...options, store })).rejects.toThrow();
    }
    for (const row of [{ path: IMAGE, hash: "sha256:bad", size: 1 }, { path: IMAGE, hash: sha("a"), size: -1 }]) {
      lockRows([row]);
      await expect(transferMedia(channel, "pull", { store })).rejects.toThrow(/Invalid/);
    }
    expect(store.calls.head).toBe(0);
    expect(readMediaLock(channel).size).toBe(1);
  });
});
