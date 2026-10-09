import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArchive, extensionOf, tooSmall, DEFAULT_QUALITY } from "../src/archive.js";
import { createHttp, retryAfter } from "../src/http.js";
import { licenceFromName, unknownLicence } from "../src/licence.js";
import type { ArchiveItem, Provider } from "../src/types.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "archive-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function png(w: number, h: number) {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}

/** A fake web: each URL answers a body (or a status); records what it was asked, with headers. */
function web(routes: Record<string, { status?: number; body?: Buffer | string; type?: string; headers?: Record<string, string> }[]>) {
  const asked: { url: string; headers: Record<string, string> }[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    asked.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const queue = routes[url];
    if (!queue || queue.length === 0) return new Response("missing", { status: 404 });
    const r = queue.length > 1 ? queue.shift()! : queue[0]!;
    return new Response(r.body ?? "", { status: r.status ?? 200, headers: { "content-type": r.type ?? "application/json", ...r.headers } });
  }) as unknown as typeof fetch;
  return { fake, asked };
}

const item = (over: Partial<ArchiveItem> = {}): ArchiveItem => ({
  provider: "fake", id: "1", mediaType: "image", title: "Storm", landingUrl: "https://fake.example/1", fileUrl: "https://files.example/storm.png",
  licence: licenceFromName("CC0")!, attribution: "«Storm». CC0-1.0", raw: { id: 1 }, ...over,
});
const provider = (record: ArchiveItem, search: ArchiveItem[] = [record]): Provider => ({
  id: "fake", label: "Fake Museum", mediaTypes: ["image", "video"],
  search: async () => search, item: async () => record,
});
const noSleep = async () => undefined;

describe("http", () => {
  it("names itself, retries what a server asks to retry, and gives up on the rest", async () => {
    const { fake, asked } = web({ "https://a.example/x": [{ status: 503, headers: { "retry-after": "1" } }, { status: 429 }, { body: '{"ok":true}' }], "https://a.example/gone": [{ status: 404 }], "https://a.example/bad": [{ status: 500 }] });
    const waits: number[] = [];
    const http = createHttp({ userAgent: "ua (me@example.invalid)", fetch: fake, sleep: async (ms) => { waits.push(ms); }, minIntervalMs: 0 });
    expect(await http.json("https://a.example/x")).toEqual({ ok: true });
    expect(asked[0]!.headers["User-Agent"]).toBe("ua (me@example.invalid)");
    expect(waits.filter((w) => w > 0)).toEqual([1000, 2000]);
    await expect(http.json("https://a.example/gone")).rejects.toMatchObject({ code: "not-found" });
    await expect(http.json("https://a.example/bad")).rejects.toMatchObject({ code: "http" });
  });

  it("caches JSON for a day, on disk", async () => {
    const { fake, asked } = web({ "https://a.example/q": [{ body: '{"n":1}' }] });
    let now = 1_000_000;
    const http = createHttp({ userAgent: "ua", fetch: fake, sleep: noSleep, cacheDir: join(dir, "cache"), now: () => now, minIntervalMs: 0 });
    await http.json("https://a.example/q");
    await http.json("https://a.example/q");
    expect(asked).toHaveLength(1);
    now += 25 * 3600 * 1000;
    await http.json("https://a.example/q");
    expect(asked).toHaveLength(2);
    await http.json("https://a.example/q", { cache: false });
    expect(asked).toHaveLength(3);
  });

  it("spaces requests to one host", async () => {
    const { fake } = web({ "https://a.example/1": [{ body: "{}" }], "https://a.example/2": [{ body: "{}" }] });
    let now = 0;
    const waits: number[] = [];
    const http = createHttp({ userAgent: "ua", fetch: fake, sleep: async (ms) => { waits.push(ms); now += ms; }, now: () => now, minIntervalMs: 300 });
    await Promise.all([http.json("https://a.example/1", { cache: false }), http.json("https://a.example/2", { cache: false })]);
    expect(waits).toEqual([300]);
  });

  it("reads Retry-After as seconds or a date", () => {
    expect(retryAfter("3", 0)).toBe(3000);
    expect(retryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(retryAfter("soon", 0)).toBeNull();
  });
});

describe("search", () => {
  it("marks what fetch would refuse, and why; one provider failing sinks none", async () => {
    const free = item({ id: "free", width: 4000, height: 3000 });
    const nc = item({ id: "nc", licence: licenceFromName("CC BY-NC 4.0")!, width: 4000, height: 3000 });
    const small = item({ id: "small", width: 800, height: 600 });
    const broken: Provider = { id: "broken", label: "Broken", mediaTypes: ["image"], search: async () => { throw new Error("down"); }, item: async () => { throw new Error("down"); } };
    const archive = createArchive({ userAgent: "ua", registry: [provider(free, [free, nc, small]), broken], fetch: web({}).fake, sleep: noSleep });
    const result = await archive.search("storm");
    expect(result.candidates.map((c) => [c.id, c.allowed])).toEqual([["free", true], ["nc", false], ["small", false]]);
    expect(result.candidates[1]!.refusal).toContain("CC-BY-NC-4.0 is not allowed");
    expect(result.candidates[2]!.refusal).toContain("smaller than 1600 px");
    expect(result.errors).toEqual([{ provider: "broken", message: "down" }]);
  });

  it("leaves out providers whose key is missing, and says so", () => {
    const keyed: Provider = { ...provider(item()), id: "keyed", label: "Keyed", keyEnv: "KEYED_API_KEY" };
    const archive = createArchive({ userAgent: "ua", registry: [keyed], env: {} });
    expect(archive.providers()).toEqual([{ id: "keyed", label: "Keyed", mediaTypes: ["image", "video"], enabled: false, reason: "needs KEYED_API_KEY" }]);
  });
});

describe("fetch", () => {
  it("downloads the original, hashed, with the host's headers, named by its real type", async () => {
    const bytes = png(3000, 2000);
    const { fake, asked } = web({ "https://files.example/storm.png": [{ body: bytes, type: "image/png" }] });
    const record = item({ fileHeaders: { "AIC-User-Agent": "ua" } });
    const archive = createArchive({ userAgent: "ua", registry: [provider(record)], fetch: fake, sleep: noSleep });
    const got = await archive.fetch("fake", "1", { dir, name: "storm" });
    expect(got).toMatchObject({ file: join(dir, "storm.png"), bytes: bytes.length, mime: "image/png", width: 3000, height: 2000 });
    expect(got.sha256).toBe(`sha256:${createHash("sha256").update(bytes).digest("hex")}`);
    expect(readFileSync(got.file)).toEqual(bytes);
    expect(asked[0]!.headers["AIC-User-Agent"]).toBe("ua");
  });

  it("refuses an unknown or disallowed licence before downloading anything", async () => {
    const { fake, asked } = web({});
    for (const licence of [unknownLicence("no licenseurl"), licenceFromName("CC BY-ND 4.0")!]) {
      const archive = createArchive({ userAgent: "ua", registry: [provider(item({ licence }))], fetch: fake, sleep: noSleep });
      await expect(archive.fetch("fake", "1", { dir, name: "x" })).rejects.toMatchObject({ code: "licence-refused" });
    }
    expect(asked).toHaveLength(0);
  });

  it("checks the size on the bytes that arrived, and leaves nothing behind on a refusal", async () => {
    const { fake } = web({ "https://files.example/storm.png": [{ body: png(900, 600), type: "image/png" }], "https://files.example/page": [{ body: "<html>Just a moment</html>", type: "text/html" }] });
    const archive = createArchive({ userAgent: "ua", registry: [provider(item())], fetch: fake, sleep: noSleep });
    await expect(archive.fetch("fake", "1", { dir, name: "storm" })).rejects.toMatchObject({ code: "too-small" });
    const html = createArchive({ userAgent: "ua", registry: [provider(item({ fileUrl: "https://files.example/page" }))], fetch: fake, sleep: noSleep });
    await expect(html.fetch("fake", "1", { dir, name: "page" })).rejects.toMatchObject({ code: "wrong-type" });
    expect(readdirSync(dir)).toEqual([]);
    // A lower bar, when asked.
    const lenient = await archive.fetch("fake", "1", { dir, name: "storm", quality: { minImageLongSide: 800 } });
    expect(existsSync(lenient.file)).toBe(true);
  });

  it("refuses a name that could leave the folder, a provider that is not there, and a file larger than allowed", async () => {
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(2036)]);
    const { fake } = web({ "https://files.example/big.mp4": [{ body: mp4, type: "video/mp4" }] });
    const archive = createArchive({ userAgent: "ua", registry: [provider(item({ mediaType: "video", fileUrl: "https://files.example/big.mp4", height: 1080 }))], fetch: fake, sleep: noSleep });
    await expect(archive.fetch("fake", "1", { dir, name: "../x" })).rejects.toThrow(/not a file name/);
    await expect(archive.fetch("nowhere", "1", { dir, name: "x" })).rejects.toMatchObject({ code: "provider-unknown" });
    await expect(archive.fetch("fake", "1", { dir, name: "big", maxBytes: 1024 })).rejects.toMatchObject({ code: "too-large" });
    expect(readdirSync(dir)).toEqual([]);
    const video = await archive.fetch("fake", "1", { dir, name: "big" });
    expect(video.file).toBe(join(dir, "big.mp4"));
  });

  it("names extensions from the type, else the URL", () => {
    expect(extensionOf("audio/x-flac", "https://x/a")).toBe(".flac");
    expect(extensionOf("", "https://x/a/b.WEBM?x=1")).toBe(".webm");
    expect(tooSmall({ mediaType: "video", height: 480 }, DEFAULT_QUALITY)).toContain("720p");
  });
});

describe("review fixes", () => {
  /** A body sent in chunks, `gapMs` apart. */
  function slow(chunks: Buffer[], gapMs: number) {
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const c of chunks) {
          await new Promise((r) => setTimeout(r, gapMs));
          controller.enqueue(new Uint8Array(c));
        }
        controller.close();
      },
    });
  }

  it("lets a long download run while bytes keep coming, and stops one that stalls", async () => {
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(100)]);
    const chunks = [mp4, Buffer.alloc(100), Buffer.alloc(100), Buffer.alloc(100), Buffer.alloc(100)];
    const steady = (async () => new Response(slow(chunks, 40), { headers: { "content-type": "video/mp4" } })) as unknown as typeof fetch;
    const http = createHttp({ userAgent: "ua", fetch: steady, sleep: noSleep, minIntervalMs: 0, timeoutMs: 100 });
    const got = await http.download("https://files.example/v.mp4", join(dir, "v.mp4"));
    expect(got.bytes).toBe(mp4.length + 400);
    const stalled = (async () => new Response(slow([mp4, Buffer.alloc(10)], 250), { headers: { "content-type": "video/mp4" } })) as unknown as typeof fetch;
    const stuck = createHttp({ userAgent: "ua", fetch: stalled, sleep: noSleep, minIntervalMs: 0, timeoutMs: 100 });
    await expect(stuck.download("https://files.example/s.mp4", join(dir, "s.mp4"))).rejects.toThrow();
    expect(readdirSync(dir).filter((f) => f.startsWith("s.mp4"))).toEqual([]);
  });

  it("checks a video or a sound on its bytes: a page is never saved as one", async () => {
    const { fake } = web({ "https://files.example/v": [{ body: "<html>log in</html>", type: "text/html" }], "https://files.example/b": [{ body: Buffer.alloc(64), type: "application/octet-stream" }] });
    for (const url of ["https://files.example/v", "https://files.example/b"]) {
      const archive = createArchive({ userAgent: "ua", registry: [provider(item({ mediaType: "video", fileUrl: url, height: 1080 }))], fetch: fake, sleep: noSleep });
      await expect(archive.fetch("fake", "1", { dir, name: "v" })).rejects.toMatchObject({ code: "wrong-type" });
    }
    expect(readdirSync(dir)).toEqual([]);
  });

  it("checks a video's height with a probe when the provider did not say it", async () => {
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(100)]);
    const { fake } = web({ "https://files.example/v.mp4": [{ body: mp4, type: "video/mp4" }] });
    const archive = createArchive({ userAgent: "ua", registry: [provider(item({ mediaType: "video", fileUrl: "https://files.example/v.mp4" }))], fetch: fake, sleep: noSleep });
    await expect(archive.fetch("fake", "1", { dir, name: "v", probe: async () => ({ width: 640, height: 360 }) })).rejects.toMatchObject({ code: "too-small" });
    const ok = await archive.fetch("fake", "1", { dir, name: "v", probe: async () => ({ width: 1920, height: 1080, durationSeconds: 12 }) });
    expect([ok.width, ok.height, ok.durationSeconds]).toEqual([1920, 1080, 12]);
  });
});
