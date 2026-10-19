import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArchive } from "../src/archive.js";
import { licenceAllowed } from "../src/licence.js";
import { extractZipEntry } from "../src/zip.js";
import { ambientcg, fontsource, illustrations, polyhaven } from "../src/providers/index.js";
import type { Http, Provider } from "../src/types.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "graphic-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const opts = { mediaType: "image" as const, limit: 5 };
function http(routes: Record<string, unknown>) {
  const json = vi.fn(async (url: string) => {
    const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    if (!hit) throw new Error(`unexpected ${url}`);
    return hit[1];
  });
  return { json, userAgent: "test" } satisfies Http;
}
function png(w: number, h: number) {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
/** A ZIP of `files`, deflated, as a real archiver writes it. */
function zip(files: Record<string, Buffer>) {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const packed = deflateRawSync(data), n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, packed); centrals.push(central, n);
    offset += 30 + n.length + packed.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const archiveOf = (provider: Provider, routes: Record<string, { body: Buffer | string; type: string }>) => createArchive({
  userAgent: "test", registry: [provider], minIntervalMs: 0,
  fetch: (async (url: string) => {
    const r = routes[url];
    return r ? new Response(r.body, { status: 200, headers: { "content-type": r.type } }) : new Response("missing", { status: 404 });
  }) as unknown as typeof fetch,
});

describe("ZIP entries", () => {
  it("extracts exactly the one entry named, and refuses none or several", () => {
    const z = zip({ "Wood_2K-JPG_Color.jpg": Buffer.from("colour"), "Wood_2K-JPG_NormalGL.jpg": Buffer.from("normal") });
    expect(extractZipEntry(z, /_Color\.jpg$/)).toMatchObject({ name: "Wood_2K-JPG_Color.jpg" });
    expect(extractZipEntry(z, /_Color\.jpg$/).bytes.toString()).toBe("colour");
    expect(() => extractZipEntry(z, /\.png$/)).toThrow(/0 files/);
    expect(() => extractZipEntry(z, /\.jpg$/)).toThrow(/2 files/);
    expect(() => extractZipEntry(Buffer.from("not a zip at all, just text padding the length"), /x/)).toThrow(/not a readable ZIP/);
  });
});

describe("Poly Haven", () => {
  const info = { type: 1, name: "Red Brick", authors: { "Rob Tuytel": "All" }, thumbnail_url: "https://cdn.polyhaven.com/t.png" };
  const files = { Diffuse: { "2k": { jpg: { url: "https://dl.polyhaven.org/d2.jpg", size: 9 } }, "4k": { jpg: { url: "https://dl.polyhaven.org/d4.jpg", size: 30 } } }, nor_gl: { "4k": { png: { url: "https://dl.polyhaven.org/n4.png" } } } };
  it("finds textures by the API's search and takes the 4k colour map by default", async () => {
    const h = http({ "https://api.polyhaven.com/search": { results: [{ slug: "red_brick" }, { slug: "chair" }] }, "https://api.polyhaven.com/assets": { red_brick: info, chair: { type: 2, name: "Chair" } } });
    const rows = await polyhaven.search("brick", opts, h);
    expect(rows.map((r) => r.id)).toEqual(["red_brick"]); // a 3D model is not a picture
    const it_ = await polyhaven.item("red_brick", http({ "https://api.polyhaven.com/info/": info, "https://api.polyhaven.com/files/": files }));
    expect(it_).toMatchObject({ fileUrl: "https://dl.polyhaven.org/d4.jpg", creator: "Rob Tuytel", licence: { id: "CC0-1.0" }, landingUrl: "https://polyhaven.com/a/red_brick" });
    expect(it_.renditions?.map((r) => r.id)).toEqual(["Diffuse-2k", "Diffuse-4k", "nor_gl-4k"]);
    await expect(polyhaven.item("../x", h)).rejects.toThrow();
  });
  it("takes an HDRI's tone-mapped panorama", async () => {
    const got = await polyhaven.item("sky", http({ "https://api.polyhaven.com/info/": { type: 0, name: "Sky" }, "https://api.polyhaven.com/files/": { hdri: {}, tonemapped: { url: "https://dl.polyhaven.org/sky.jpg" } } }));
    expect(got.fileUrl).toBe("https://dl.polyhaven.org/sky.jpg");
  });
});

describe("ambientCG", () => {
  const asset = {
    id: "Wood096", title: "Wood 096", type: "material", url: "https://ambientcg.com/a/Wood096", thumbnails: { "512-PNG": "https://acg-media.struffelproductions.com/t.png" },
    downloads: [{ attributes: "2K-JPG", extension: "zip", url: "https://ambientcg.com/get?file=Wood096_2K-JPG.zip", size: 100 }, { attributes: "2K-JPG", extension: "usdc", url: "https://x" }],
  };
  it("downloads the ZIP and keeps only the colour map", async () => {
    const h = http({ "https://ambientcg.com/api/v3/assets": { assets: [asset] } });
    const [row] = await ambientcg.search("wood", opts, h);
    expect(row).toMatchObject({ id: "Wood096", zipEntry: "^Wood096_2K-JPG_Color\\.jpg$", licence: { id: "CC0-1.0" } });
    expect(row!.renditions?.map((r) => r.id)).toContain("2K-JPG-NormalGL");
    const body = zip({ "Wood096_2K-JPG_Color.jpg": png(2048, 2048), "Wood096_2K-JPG_NormalGL.jpg": png(2048, 2048), "Wood096.usda": Buffer.from("x") });
    const archive = archiveOf({ ...ambientcg, item: async () => row! }, { "https://ambientcg.com/get?file=Wood096_2K-JPG.zip": { body, type: "application/zip" } });
    const got = await archive.fetch("ambientcg", "Wood096", { dir, name: "wood" });
    expect(got).toMatchObject({ mime: "image/png", width: 2048, height: 2048 });
    expect(readFileSync(got.file).equals(png(2048, 2048))).toBe(true);
  });
});

describe("Fontsource", () => {
  const list = [
    { id: "lora", family: "Lora", category: "serif", subsets: ["latin"], weights: [400, 700], styles: ["normal", "italic"], license: "OFL-1.1", type: "google" },
    { id: "inter", family: "Inter", category: "sans-serif", subsets: ["latin"], weights: [400], styles: ["normal"], license: "OFL-1.1", type: "google" },
    { id: "ubuntu", family: "Ubuntu", category: "sans-serif", subsets: ["latin"], weights: [400], styles: ["normal"], license: "UFL-1.0", type: "google" },
  ];
  it("finds families by name or Italian category, each weight a rendition, licence allowed by default", async () => {
    const h = http({ "https://api.fontsource.org/v1/fonts": list });
    const serif = await fontsource.search("graziato", { mediaType: "font", limit: 5 }, h);
    expect(serif.map((r) => r.id)).toEqual(["lora"]);
    expect(serif[0]!.renditions?.map((r) => r.id)).toEqual(["400-normal", "400-normal-ttf", "400-italic", "400-italic-ttf", "700-normal", "700-normal-ttf", "700-italic", "700-italic-ttf"]);
    expect(serif[0]).toMatchObject({ mediaType: "font", fileUrl: "https://cdn.jsdelivr.net/fontsource/fonts/lora@latest/latin-400-normal.woff2", licence: { id: "provider:ofl-1.1" } });
    expect(licenceAllowed(serif[0]!.licence).ok).toBe(true);
    const ubuntu = await fontsource.search("ubuntu", { mediaType: "font", limit: 5 }, h);
    expect(ubuntu[0]!.licence.id).toBe("provider:ufl-1.0");
    expect(licenceAllowed(ubuntu[0]!.licence).ok).toBe(false); // UFL needs a channel's opt-in
  });
  it("fetches a face and checks its bytes are a font", async () => {
    const detail = { ...list[1], variants: { 400: { normal: { latin: { url: { woff2: "https://cdn.jsdelivr.net/i.woff2", ttf: "https://cdn.jsdelivr.net/i.ttf" } } } } } };
    const record = await fontsource.item("inter", http({ "https://api.fontsource.org/v1/fonts/inter": detail }));
    const archive = archiveOf({ ...fontsource, item: async () => record }, {
      "https://cdn.jsdelivr.net/i.woff2": { body: Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(60)]), type: "font/woff2" },
      "https://cdn.jsdelivr.net/i.ttf": { body: "<html>nope</html>", type: "font/ttf" },
    });
    expect(await archive.fetch("fontsource", "inter", { dir, name: "inter" })).toMatchObject({ mime: "font/woff2" });
    await expect(archive.fetch("fontsource", "inter", { dir, name: "inter-ttf", rendition: "400-normal-ttf" })).rejects.toMatchObject({ code: "wrong-type" });
  });
});

describe("Illustrations", () => {
  it("interleaves Openverse illustrations and Commons drawings, an SVG sized for its rasterization", async () => {
    const h = http({
      "https://api.openverse.org/v1/images/": { results: [{ id: "8a1f0b62-1111-4c1e-9a7e-000000000001", url: "https://upload.wikimedia.org/a.svg", filetype: "svg", width: 400, height: 200, title: "Cat", license: "cc0", license_url: "https://creativecommons.org/publicdomain/zero/1.0/", foreign_landing_url: "https://x" }] },
      "https://commons.wikimedia.org/w/api.php": { query: { pages: [{ title: "File:Dog.png", index: 1, imageinfo: [{ url: "https://upload.wikimedia.org/dog.png", mime: "image/png", width: 3000, height: 2000, descriptionurl: "https://commons/dog", extmetadata: { LicenseUrl: { value: "https://creativecommons.org/licenses/by/4.0/" } } }] }] } },
    });
    const rows = await illustrations.search("cat", opts, h);
    expect(rows.map((r) => r.id)).toEqual(["openverse:images/8a1f0b62-1111-4c1e-9a7e-000000000001", "commons:File:Dog.png"]);
    expect(rows[0]).toMatchObject({ provider: "illustrations", width: 2048, height: 1024 });
    expect(rows[1]).toMatchObject({ width: 3000, height: 2000 });
    expect(String(h.json.mock.calls[0]?.[0])).toContain("category=illustration");
    expect(String(h.json.mock.calls[1]?.[0])).toContain("filetype%3Adrawing");
    await expect(illustrations.item("pexels:1", h)).rejects.toThrow(/not an illustrations id/);
  });
});
