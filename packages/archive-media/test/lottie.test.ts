import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArchive } from "../src/archive.js";
import { sanitizeLottie } from "../src/lottie.js";
import { lottie } from "../src/providers/index.js";
import type { Http } from "../src/types.js";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const anim = (extra: object = {}) => ({
  v: "5.7.4", fr: 30, ip: 0, op: 90, w: 512, h: 256,
  layers: [{ ty: 4, ks: { p: { a: 1, k: [{ t: 0, s: [0, 0], i: { x: [0.4], y: [1] }, o: { x: 0.6, y: 0 } }], x: "var $bm_rt = fetch('https://evil.invalid')" } } }],
  ...extra,
});

describe("sanitizeLottie", () => {
  it("removes every expression and keeps easing data that is also called x", () => {
    const { json, facts } = sanitizeLottie(JSON.stringify(anim()));
    const doc = JSON.parse(json);
    expect(json).not.toContain("evil.invalid");
    expect(doc.layers[0].ks.p.k[0].i.x).toEqual([0.4]);
    expect(doc.layers[0].ks.p.k[0].o.x).toBe(0.6);
    expect(facts).toEqual({ width: 512, height: 256, frameRate: 30, durationSeconds: 3, expressionsRemoved: 1 });
  });
  it("keeps embedded pictures and precompositions, and drops font paths", () => {
    const doc = anim({
      assets: [{ id: "img", w: 10, h: 10, u: "images/", p: PNG, e: 0 }, { id: "pre", layers: [{ ty: 4, ks: { x: "eval(1)" } }] }],
      fonts: { list: [{ fName: "Inter", fFamily: "Inter", fPath: "https://fonts.example/inter.css", fOrigin: "g" }] },
    });
    const out = JSON.parse(sanitizeLottie(JSON.stringify(doc)).json);
    expect(out.assets[0]).toMatchObject({ u: "", e: 1, p: PNG });
    expect(out.assets[1].layers[0].ks.x).toBeUndefined();
    expect(out.fonts.list[0].fPath).toBeUndefined();
  });
  it("refuses an animation that loads pictures or sounds from outside the file", () => {
    for (const asset of [{ id: "a", u: "https://cdn.example/", p: "x.png", e: 0 }, { id: "b", p: "data:text/html;base64,PGh0bWw+" }, { id: "c", p: "sound.mp3" }]) {
      expect(() => sanitizeLottie(JSON.stringify(anim({ assets: [asset] })))).toThrow(/not an embedded picture/);
    }
  });
  it("refuses what is not a Lottie animation", () => {
    expect(() => sanitizeLottie("<html>")).toThrow(/not JSON/);
    expect(() => sanitizeLottie(JSON.stringify({ hello: 1 }))).toThrow(/not a Lottie animation/);
    expect(() => sanitizeLottie(JSON.stringify(anim({ op: 0 })))).toThrow(/not a Lottie animation/);
  });
});

describe("LottieFiles animations", () => {
  const node = { id: 12, name: "Wave", jsonUrl: "https://assets.lottiefiles.com/x.json", videoUrl: "https://assets.lottiefiles.com/x.mp4", createdBy: { username: "ann" }, metadata: { width: 512, height: 256, duration: 3 } };
  it("offers the JSON as an animation under its own id, and fetches it inert", async () => {
    const h = { json: vi.fn(async () => ({ data: { searchPublicAnimations: { edges: [{ node }, { node: { ...node, id: 13, jsonUrl: "https://evil.invalid/x.json" } }] } } })), userAgent: "t" } satisfies Http;
    const rows = await lottie.search("wave", { mediaType: "animation", limit: 5 }, h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "json/12", mediaType: "animation", fileUrl: node.jsonUrl, licence: { id: "provider:lottie" } });

    const registry = [{ ...lottie, item: async () => ({ ...rows[0]!, licence: { id: "CC0-1.0", attributionRequired: false, statement: "test" } }) }];
    const fetcher = vi.fn(async () => new Response(JSON.stringify(anim()), { status: 200, headers: { "Content-Type": "application/json" } }));
    const archive = createArchive({ userAgent: "test", registry, fetch: fetcher as unknown as typeof fetch, minIntervalMs: 0 });
    const dir = mkdtempSync(join(tmpdir(), "lottie-"));
    try {
      const got = await archive.fetch("lottie", "json/12", { dir, name: "wave" });
      expect(got).toMatchObject({ mime: "application/json", width: 512, height: 256, durationSeconds: 3 });
      expect(got.file.endsWith("wave.json")).toBe(true);
      expect(readFileSync(got.file, "utf-8")).not.toContain("evil.invalid");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
