import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArchive } from "../src/archive.js";
import { imageSize } from "../src/image-size.js";
import { licenceAllowed } from "../src/licence.js";
import { emoji, iconify, lottie } from "../src/providers/index.js";
import type { Http } from "../src/types.js";

const opts = { mediaType: "image" as const, limit: 5 };
function http(...answers: unknown[]) {
  const json = vi.fn(async () => (answers.length > 1 ? answers.shift() : answers[0]));
  return { json, userAgent: "test", notify: vi.fn(async () => undefined) } satisfies Http;
}
const iconInfo = (extra: object = {}) => ({ name: "Home", author: { name: "Icons Co" }, license: { title: "MIT", spdx: "MIT", url: "https://opensource.org/license/mit" }, ...extra });

describe("Iconify and emoji", () => {
  it("normalizes an icon to a rasterized SVG rendition with its set licence", async () => {
    const h = http({ icons: ["mdi:home", "brands:acme"], collections: { mdi: iconInfo(), brands: iconInfo({ category: "Brands" }) } });
    const rows = await iconify.search("home", opts, h);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ provider: "iconify", id: "mdi:home", mediaType: "image", rendition: expect.stringContaining("SVG rasterized") });
    expect(rows[0]!.licence).toMatchObject({ id: "provider:mit", attributionRequired: true });
    expect(rows[1]!.attribution).toContain("trademark rights are separate");
    expect(h.json.mock.calls[0]?.[0]).toContain("api.iconify.design/search");
    expect(await iconify.item("mdi:home", http({ mdi: iconInfo() }))).toMatchObject({ id: "mdi:home" });
    await expect(iconify.item("../etc/passwd", h)).rejects.toThrow();
  });
  it("maps a Creative Commons icon licence and keeps an unverified one unknown", async () => {
    const cc = await iconify.search("x", opts, http({ icons: ["openmoji:1F600"], collections: { openmoji: iconInfo({ license: { title: "CC BY-SA 4.0", spdx: "CC-BY-SA-4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" } }) } }));
    expect(cc[0]!.licence.id).toBe("CC-BY-SA-4.0");
    expect(licenceAllowed(cc[0]!.licence).ok).toBe(true);
    const bad = await iconify.item("mdi:home", http({ mdi: { license: { spdx: "Weird-1.0" } } }));
    expect(bad.licence.id).toBe("unknown");
    expect(licenceAllowed(bad.licence).ok).toBe(false);
  });
  it("adds animated Noto emoji by translated keyword and refuses a non-media codepoint", async () => {
    const index = { icons: [{ name: "Rocket", codepoint: "1F680", tags: ["rocket", "launch"] }, { name: "Bad", codepoint: "not-a-codepoint" }] };
    const h = http({ icons: [], collections: {} }, index);
    const rows = await emoji.search("razzo", opts, h);
    expect(rows.find((r) => r.id === "noto-animated:1F680")).toMatchObject({ fileUrl: "https://fonts.gstatic.com/s/e/notoemoji/latest/1F680/512.webp", mediaType: "image" });
    expect(rows.some((r) => r.id === "noto-animated:not-a-codepoint")).toBe(false);
    expect(await emoji.item("noto-animated:1F680", http(index))).toMatchObject({ id: "noto-animated:1F680" });
    await expect(emoji.item("mdi:home", http({ mdi: iconInfo() }))).rejects.toThrow(); // not an emoji set
  });
});

describe("LottieFiles", () => {
  const node = { id: 12, name: "Wave", videoUrl: "https://assets.lottiefiles.com/x.mp4", imageUrl: "https://assets.lottiefiles.com/x.png", downloads: 10, likesCount: 2, createdBy: { firstName: "Ann", lastName: "Lee" }, metadata: { width: 1920, height: 1080, duration: 3 } };
  it("takes the MP4 rendition, never the remote-bearing JSON, and ranks by popularity", async () => {
    const h = http({ data: { searchPublicAnimations: { edges: [{ node }, { node: { ...node, id: 13, videoUrl: "https://evil.invalid/x.mp4" } }] } } });
    const rows = await lottie.search("wave", { ...opts, mediaType: "video" }, h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "lottie", mediaType: "video", fileUrl: "https://assets.lottiefiles.com/x.mp4", creator: "Ann Lee", licence: { id: "provider:lottie" } });
    expect(h.json.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(await lottie.item("12", http({ data: { publicAnimation: node } }))).toMatchObject({ id: "12" });
    await expect(lottie.item("12a", h)).rejects.toThrow();
  });
});

describe("SVG never reaches disk as active XML", () => {
  it("rasterizes a fetched provider SVG to an inert PNG before it is saved", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48" viewBox="0 0 64 48"><script>globalThis.pwned=true</script><rect width="64" height="48" fill="#f00"/></svg>`;
    const provider = {
      id: "svgset", label: "SVG Set", mediaTypes: ["image" as const],
      search: async () => [],
      item: async () => ({
        provider: "svgset", id: "x", mediaType: "image" as const, title: "x", landingUrl: "https://svgset.example/x",
        fileUrl: "https://cdn.example/x.svg", licence: { id: "CC0-1.0", attributionRequired: false, statement: "cc0" }, attribution: "x", raw: {}, rendition: "SVG",
      }),
    };
    const fetcher = vi.fn(async () => new Response(svg, { status: 200, headers: { "Content-Type": "image/svg+xml" } }));
    const archive = createArchive({ userAgent: "test", registry: [provider], fetch: fetcher as unknown as typeof fetch, minIntervalMs: 0 });
    const dir = mkdtempSync(join(tmpdir(), "svg-"));
    try {
      const got = await archive.fetch("svgset", "x", { dir, name: "icon" });
      expect(got.mime).toBe("image/png");
      expect(got.file.endsWith(".png")).toBe(true);
      expect(imageSize(got.file)).toMatchObject({ mime: "image/png", width: 2048, height: 1536 });
      expect(readFileSync(got.file).toString("utf-8")).not.toContain("script");
      expect(got.width).toBe(2048);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
