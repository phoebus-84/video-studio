import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createArchive } from "../src/archive.js";
import { createHttp } from "../src/http.js";
import { licenceAllowed } from "../src/licence.js";
import { PROVIDERS, pexels, pixabay, unsplash, coverr, smithsonian, wellcome, rijksmuseum, inaturalist, jamendo, ccmixter } from "../src/providers/index.js";
import type { Http, Provider, ArchiveItem } from "../src/types.js";

const opts = { mediaType: "image" as const, limit: 5 };
const key = "test-key-not-a-real-credential";
function http(...answers: unknown[]) {
  const json = vi.fn(async () => answers.length > 1 ? answers.shift() : answers[0]);
  return { json, userAgent: "test", notify: vi.fn(async () => undefined) } satisfies Http;
}
const dirs: string[] = [];
function temp() { const d = mkdtempSync(join(tmpdir(), "stock-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const pexelsPhoto = { id: 1, width: 2400, height: 1600, photographer: "Alice", url: "https://www.pexels.com/photo/1/", src: { original: "https://images.pexels.com/1.jpg" } };

describe("native provider registration", () => {
  it("registers 22 distinct providers without changing the default licence policy", () => {
    expect(new Set(PROVIDERS.map((p) => p.id)).size).toBe(22);
    const archive = createArchive({ userAgent: "test", env: {} });
    expect(archive.providers().find((p) => p.id === "pexels")).toMatchObject({ enabled: false, reason: "needs PEXELS_API_KEY" });
    expect(archive.providers().find((p) => p.id === "inaturalist")).toMatchObject({ enabled: true });
  });
  it("reports explicit unknown and missing-key providers rather than silently returning nothing", async () => {
    const archive = createArchive({ userAgent: "test", env: {} });
    await expect(archive.search("x", { providers: ["typo"] })).rejects.toMatchObject({ code: "provider-unknown" });
    await expect(archive.search("x", { providers: ["pexels"] })).rejects.toMatchObject({ code: "provider-disabled" });
  });
});

describe("stock API contracts", () => {
  it("Pexels separates image/video IDs, uses authorization and the largest MP4", async () => {
    const h = http({ photos: [pexelsPhoto] }, pexelsPhoto);
    const [photo] = await pexels.search("city", opts, h, key);
    expect(photo).toMatchObject({ id: "image/1", width: 2400, creator: "Alice", licence: { id: "provider:pexels" }, raw: pexelsPhoto });
    expect(licenceAllowed(photo!.licence).ok).toBe(false);
    expect(licenceAllowed(photo!.licence, { allow: ["provider:pexels"] }).ok).toBe(true);
    expect(h.json.mock.calls[0]).toEqual([expect.stringContaining("api.pexels.com/v1/search"), { headers: { Authorization: key } }]);
    await pexels.item("image/1", h, key);
    expect(h.json.mock.calls[1]).toEqual(["https://api.pexels.com/v1/photos/1", { cache: false, headers: { Authorization: key } }]);
    const video = { id: 2, video_files: [{ file_type: "video/mp4", width: 640, height: 360, link: "https://videos.pexels.com/s.mp4" }, { file_type: "video/mp4", width: 1920, height: 1080, link: "https://videos.pexels.com/l.mp4" }] };
    const got = await pexels.item("video/2", http(video), key);
    expect(got).toMatchObject({ id: "video/2", width: 1920, fileUrl: "https://videos.pexels.com/l.mp4" });
    await expect(pexels.item("../secret", h, key)).rejects.toThrow();
  });
  it("Pixabay marks resized images honestly and enables safe search", async () => {
    const row = { id: 3, imageWidth: 6000, imageHeight: 4000, largeImageURL: "https://pixabay.com/get/large.jpg" };
    const h = http({ hits: [row] });
    const [got] = await pixabay.search("nature", opts, h, key);
    expect(got).toMatchObject({ id: "image/3", rendition: "large-image" });
    expect(got!.width).toBeUndefined();
    expect(h.json.mock.calls[0]?.[0]).toContain("safesearch=true");
    await pixabay.item("image/3", h, key);
    expect(h.json.mock.calls[1]?.[1]).toEqual({ cache: false });
    const vid = { id: 4, videos: { large: { url: "https://cdn.pixabay.com/v.mp4", width: 1920, height: 1080 } } };
    expect(await pixabay.item("video/4", http({ hits: [vid] }), key)).toMatchObject({ width: 1920, mediaType: "video" });
  });
  it("Unsplash excludes premium images and tracks downloads at a fixed authenticated endpoint", async () => {
    const row = { id: "abc", urls: { full: "https://images.unsplash.com/x.jpg" }, user: { name: "Alice", username: "alice" }, links: { download_location: "https://evil.invalid/steal" } };
    const h = http({ results: [row, { ...row, premium: true }] });
    const rows = await unsplash.search("x", opts, h, key);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attribution).toContain("utm_source=video-studio");
    await unsplash.beforeDownload!(rows[0]!, h, key);
    expect(h.json.mock.calls[1]).toEqual(["https://api.unsplash.com/photos/abc/download", { cache: false, headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" } }]);
    expect(await unsplash.item("abc", http(row), key)).toMatchObject({ id: "abc" });
  });
  it("Coverr uses the MP4, marks its rendition and accounts with PATCH", async () => {
    const row = { id: "v1", max_width: 3840, max_height: 2160, urls: { mp4: "https://cdn.coverr.co/v.mp4" } };
    const h = http({ hits: [row] });
    const [got] = await coverr.search("x", { ...opts, mediaType: "video" }, h, key);
    expect(got).toMatchObject({ rendition: "mp4-1080p", fileUrl: "https://cdn.coverr.co/v.mp4" });
    expect(got!.width).toBeUndefined(); // source dimensions do not describe this rendition
    await coverr.beforeDownload!(got!, h, key);
    expect(h.notify).toHaveBeenCalledWith("https://api.coverr.co/videos/v1/stats/downloads", { method: "PATCH", headers: { Authorization: `Bearer ${key}` } });
    expect(await coverr.item("v1", http(row), key)).toMatchObject({ id: "v1" });
  });
});

describe("collections", () => {
  it("Smithsonian requires CC0 on the actual media, not just the artwork", async () => {
    const row = { id: "ld1", title: "Art", content: { descriptiveNonRepeating: { online_media: { media: [{ type: "Images", usage: { access: "CC0" }, resources: [{ label: "High-resolution JPEG", url: "https://ids.si.edu/ids/x", width: 3000, height: 2000 }] }] } } } };
    const h = http({ response: { rows: [row, { ...row, content: {} }] } }, { response: row });
    const rows = await smithsonian.search("art", opts, h, key);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ width: 3000, licence: { id: "CC0-1.0" } });
    expect(await smithsonian.item("ld1", h, key)).toMatchObject({ raw: row });
  });
  it("Wellcome preserves the exact licence version and only accepts its IIIF host", async () => {
    const row = { id: "w1", source: { id: "work", title: "Image" }, locations: [{ url: "https://iiif.wellcomecollection.org/image/x/info.json", license: { id: "cc-by", url: "https://creativecommons.org/licenses/by/4.0/" } }] };
    const h = http({ results: [row] }, row);
    expect((await wellcome.search("x", opts, h))[0]).toMatchObject({ fileUrl: "https://iiif.wellcomecollection.org/image/x/full/max/0/default.jpg", licence: { id: "CC-BY-4.0" } });
    expect(await wellcome.item("w1", h)).toMatchObject({ id: "w1" });
    await expect(wellcome.item("w1", http({ ...row, locations: [{ url: "https://evil.invalid/info.json" }] }))).rejects.toThrow();
    const unknown = await wellcome.item("w1", http({ ...row, locations: [{ ...row.locations[0], license: { id: "cc-by" } }] }));
    expect(unknown.licence.id).toBe("unknown");
  });
  it("Rijksmuseum follows only trusted Linked Art links and retains all rights evidence", async () => {
    const obj = { shows: [{ id: "https://id.rijksmuseum.nl/visual" }], identified_by: [{ type: "Name", content: "Painting" }] };
    const vis = { subject_to: [{ classified_as: [{ id: "https://creativecommons.org/publicdomain/mark/1.0/" }] }], digitally_shown_by: [{ id: "https://id.rijksmuseum.nl/digital" }] };
    const dig = { access_point: [{ id: "https://iiif.micr.io/x/full/max/0/default.jpg" }] };
    const h = http({ orderedItems: [{ id: "https://id.rijksmuseum.nl/1" }] }, obj, vis, dig);
    const [got] = await rijksmuseum.search("art", opts, h);
    expect(got).toMatchObject({ id: "1", licence: { id: "public-domain" }, raw: { object: obj, visual: vis, digital: dig } });
    await expect(rijksmuseum.item("1", http({ shows: [{ id: "https://localhost/secret" }] }))).rejects.toThrow("unsupported");
  });
});

describe("nature and music rights", () => {
  const photo = { id: 2, license_code: "cc-by", attribution: "Photographer", url: "https://static.inaturalist.org/photos/2/square.jpg" };
  const obs = { id: 1, license_code: "cc0", photos: [photo] };
  it("iNaturalist uses photo rights and credits, rejects hidden/unknown/foreign photos", async () => {
    const h = http({ results: [{ ...obs, photos: [photo, { ...photo, hidden: true }, { ...photo, license_code: null }, { ...photo, url: "https://evil.invalid/photos/2/square.jpg" }] }] });
    const rows = await inaturalist.search("bird", opts, h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "1.2", creator: "Photographer", licence: { id: "CC-BY" }, fileUrl: "https://static.inaturalist.org/photos/2/original.jpg" });
    expect(licenceAllowed(rows[0]!.licence).ok).toBe(true);
    expect(await inaturalist.item("1.2", http({ results: [obs] }))).toMatchObject({ id: "1.2" });
    await expect(inaturalist.item("1.3", http({ results: [obs] }))).rejects.toThrow();
  });
  it("Jamendo requires explicit download permission and preserves NC rejection", async () => {
    const row = { id: "1", audiodownload_allowed: true, audiodownload: "https://storage.jamendo.com/1.mp3", license_ccurl: "https://creativecommons.org/licenses/by-nc/4.0/" };
    const h = http({ headers: { status: "success" }, results: [row, { ...row, audiodownload_allowed: false }] });
    const rows = await jamendo.search("music", { ...opts, mediaType: "audio" }, h, key);
    expect(rows).toHaveLength(1);
    expect(licenceAllowed(rows[0]!.licence).ok).toBe(false);
    expect(await jamendo.item("1", h, key)).toMatchObject({ id: "1" });
    await expect(jamendo.item("1", http({ headers: { status: "failed" } }), key)).rejects.toThrow("API error");
  });
  it("ccMixter selects MPEG files and supplies the required referrer", async () => {
    const row = { upload_id: 7, license_url: "https://creativecommons.org/licenses/by/3.0/", files: [{ file_format_info: { mime_type: "audio/mpeg" }, download_url: "https://ccmixter.org/content/a.mp3" }] };
    const h = http([row]);
    const [got] = await ccmixter.search("music", { ...opts, mediaType: "audio" }, h);
    expect(got).toMatchObject({ id: "7", licence: { id: "CC-BY-3.0" }, fileHeaders: { Referer: "https://ccmixter.org/" } });
    expect(await ccmixter.item("7", h)).toMatchObject({ id: "7" });
  });
});

describe("download safety and filters", () => {
  it("blocks tracking and download when a platform licence has not been opted into", async () => {
    const track = vi.fn();
    const row = await pexels.item("image/1", http(pexelsPhoto), key);
    const p: Provider = { ...pexels, keyEnv: undefined, item: async () => row, beforeDownload: track };
    const fetcher = vi.fn();
    const archive = createArchive({ userAgent: "test", registry: [p], fetch: fetcher });
    await expect(archive.fetch("pexels", "image/1", { dir: temp(), name: "x" })).rejects.toMatchObject({ code: "licence-refused" });
    expect(track).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses off-CDN redirects before contacting their target", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://localhost/private" } }));
    const h = createHttp({ userAgent: "test", fetch: fetcher, minIntervalMs: 0 });
    const d = temp();
    await expect(h.download("https://images.pexels.com/x", join(d, "x"), { allowedHosts: ["images.pexels.com"] })).rejects.toThrow("allowlist");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(readdirSync(d)).toEqual([]);
  });
  it("does not disclose query API keys in HTTP errors", async () => {
    for (const response of [new Response("no", { status: 403 }), new Response("not json")]) {
      const h = createHttp({ userAgent: "test", fetch: vi.fn(async () => response), minIntervalMs: 0 });
      const err = await h.json(`https://example.org/api?api_key=${key}`).catch((e) => e);
      expect(err.message).not.toContain(key);
      expect(err.message).not.toContain("api_key");
    }
  });
  it("accepts ccMixter-sized headers with the real HTTP transport", async () => {
    const server = createServer((_req, res) => { res.writeHead(200, { "X-JSON": "x".repeat(64 * 1024), "Content-Type": "application/json" }); res.end('{"ok":true}'); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address() as { port: number };
      expect(await createHttp({ userAgent: "test" }).json(`http://127.0.0.1:${address.port}/`)).toEqual({ ok: true });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("redacts echoed query keys from evidence and isolates authenticated caches", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ request: `https://example.org/?key=${key}` })));
    const h = createHttp({ userAgent: "test", fetch: fetcher, minIntervalMs: 0, cacheDir: temp() });
    const url = `https://example.org/api?key=${key}`;
    const first = await h.json(url, { headers: { Authorization: "credential-one" } });
    expect(JSON.stringify(first)).not.toContain(key);
    await h.json(url, { headers: { Authorization: "credential-one" } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await h.json(url, { headers: { Authorization: "credential-two" } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("supports valid CDN redirects without retrying provider accounting", async () => {
    const fetcher = vi.fn(async (url: string) => url.endsWith("/start")
      ? new Response(null, { status: 302, headers: { location: "/final" } })
      : new Response("asset"));
    const h = createHttp({ userAgent: "test", fetch: fetcher as typeof fetch, minIntervalMs: 0 });
    expect((await h.download("https://cdn.example/start", join(temp(), "file"), { allowedHosts: ["cdn.example"] })).bytes).toBe(5);
    const refused = vi.fn(async () => new Response("busy", { status: 503 }));
    const accounting = createHttp({ userAgent: "test", fetch: refused, minIntervalMs: 0 });
    await expect(accounting.notify!("https://api.coverr.co/track", { method: "PATCH" })).rejects.toThrow("accounting");
    expect(refused).toHaveBeenCalledTimes(1);
  });
  it("selects a listed rendition by id without losing the item's own id", async () => {
    const png = Buffer.alloc(64);
    png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(0x0d0a1a0a, 4); png.writeUInt32BE(13, 8); png.write("IHDR", 12, "ascii");
    png.writeUInt32BE(3000, 16); png.writeUInt32BE(2000, 20);
    const base = await pexels.item("image/1", http(pexelsPhoto), key);
    const withRendition = { ...base, renditions: [{ id: "small", fileUrl: "https://images.pexels.com/small.png", width: 2000, height: 1500, label: "small" }] };
    const provider: Provider = { ...pexels, keyEnv: undefined, item: async () => withRendition };
    const fetcher = vi.fn(async () => new Response(png, { headers: { "content-type": "image/png" } }));
    const archive = createArchive({ userAgent: "test", registry: [provider], fetch: fetcher as unknown as typeof fetch, sleep: async () => undefined });
    const policy = { allow: ["provider:pexels"] };
    const got = await archive.fetch("pexels", "image/1", { dir: temp(), name: "x", rendition: "small", policy });
    expect(got.item.id).toBe("image/1");
    expect(got.item.rendition).toBe("small");
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://images.pexels.com/small.png");
    await expect(archive.fetch("pexels", "image/1", { dir: temp(), name: "y", rendition: "nope", policy })).rejects.toThrow(/no rendition/);
  });
  it("interleaves providers and does not treat unknown dimensions as matching filters", async () => {
    const base = await pexels.item("image/1", http(pexelsPhoto), key);
    const make = (id: string): Provider => ({ id, label: id, mediaTypes: ["image"], item: async () => base,
      search: async () => [1, 2].map((n): ArchiveItem => ({ ...base, provider: id, id: `${id}${n}`, width: n === 1 ? 1080 : undefined, height: n === 1 ? 1920 : undefined })) });
    const a = createArchive({ userAgent: "test", registry: [make("a"), make("b")] });
    expect((await a.search("x", { diverse: true })).candidates.map((x) => x.id)).toEqual(["a1", "b1", "a2", "b2"]);
    expect((await a.search("x", { orientation: "portrait", minWidth: 1000 })).candidates.map((x) => x.id)).toEqual(["a1", "b1"]);
    expect((await a.search("x", { maxDurationSeconds: 10 })).candidates).toHaveLength(0);
  });
});
