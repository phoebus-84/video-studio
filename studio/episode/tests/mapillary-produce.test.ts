import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMapillary, type Mapillary, type MapillaryImage } from "@av/archive-media";
import { checkProvenance } from "../src/archive-media.js";
import { renderMapillaryHyperlapse, renderMapillaryPan, renderMapillaryPlanet, saveMapillaryStill, sequenceGeoJson } from "../src/mapillary-produce.js";

/**
 * Mapillary productions (avg-lvb): a still, a hyperlapse, a pan, a tiny planet.
 * The Mapillary API and CDN are faked; ffmpeg runs for real on a synthetic image.
 */

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf-8" }).status === 0;
let ws: string, media: string, panoJpeg: Buffer, flatJpeg: Buffer;
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "mly-ws-"));
  media = mkdtempSync(join(tmpdir(), "mly-media-"));
  const pano = join(media, "pano.jpg"), flat = join(media, "flat.jpg");
  spawnSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=1024x512", "-frames:v", "1", pano]);
  spawnSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=1024x768", "-frames:v", "1", flat]);
  panoJpeg = readFileSync(pano);
  flatJpeg = readFileSync(flat);
});
afterEach(() => { rmSync(ws, { recursive: true, force: true }); rmSync(media, { recursive: true, force: true }); });

const pano: MapillaryImage = { id: "111", sequence: "s1", captured_at: Date.UTC(2020, 0, 1), computed_geometry: { coordinates: [12.5, 41.9] },
  computed_compass_angle: 0, is_pano: true, creator: { username: "ana" }, width: 8192, height: 4096,
  thumb_original_url: "https://scontent.xx.fbcdn.net/pano.jpg" };
const flat = Array.from({ length: 6 }, (_, k): MapillaryImage => ({ id: String(200 + k), sequence: "s2", captured_at: Date.UTC(2020, 0, 1) + k * 1000,
  computed_geometry: { coordinates: [12.5, 41.9 + k * 0.00009] }, computed_compass_angle: 0, is_pano: false, creator: { username: "ana" },
  width: 2048, height: 1536, thumb_2048_url: `https://scontent.xx.fbcdn.net/f${k}.jpg` }));

function fakeMap() {
  const fetch: typeof globalThis.fetch = async (input) => {
    const u = new URL(String(input));
    if (u.host.endsWith("fbcdn.net")) return new Response(flatJpeg, { headers: { "content-type": "image/jpeg" } });
    if (u.pathname.includes("images")) {
      const seq = u.searchParams.get("sequence_ids"), ids = u.searchParams.get("image_ids");
      if (seq === "s2") return json({ data: flat });
      if (ids) return json({ data: ids.split(",").map((id) => flat.find((i) => i.id === id) ?? pano) });
      return json({ data: [...flat, pano] });
    }
    const id = u.pathname.replace("/", "");
    if (id === pano.id) return json(pano);
    return json(flat.find((i) => i.id === id) ?? pano);
  };
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  return createMapillary({ userAgent: "test", env: {}, token: "MLY|test", fetch, minIntervalMs: 0 });
}

describe.skipIf(!hasFfmpeg)("mapillary productions", () => {
  it("writes a 9:16 360° still with provenance and the share-alike credit", async () => {
    const got = await saveMapillaryStill(fakeMap(), ws, "111", "pano", { vertical: true });
    expect(got.path).toBe("assets/images/pano.jpg");
    const record = JSON.parse(readFileSync(join(ws, got.recordPath), "utf-8"));
    expect(record).toMatchObject({ file: { path: "assets/images/pano.jpg", width: 1080, height: 1920 }, provider: { id: "mapillary" }, licence: { id: "CC-BY-SA-4.0" } });
    expect(record.item.rendition).toContain("360°");
    expect(readFileSync(join(ws, "ATTRIBUTIONS.md"), "utf-8")).toContain("Mapillary");
    expect(checkProvenance(ws).ok).toBe(true);
  }, 120_000);

  it("renders a hyperlapse along a sequence as a 1080×1920 MP4", async () => {
    const got = await renderMapillaryHyperlapse(fakeMap(), ws, "s2", "walk", { durationSeconds: 0.6, fps: 10, interp: "none" });
    expect(got.path).toBe("assets/video/walk.mp4");
    const record = JSON.parse(readFileSync(join(ws, got.recordPath), "utf-8"));
    expect(record).toMatchObject({ file: { path: "assets/video/walk.mp4", width: 1080, height: 1920 }, item: { id: "s2" } });
    expect(record.item.rendition).toContain("hyperlapse");
    const evidence = JSON.parse(readFileSync(join(ws, record.evidence.path), "utf-8"));
    expect(evidence.operation.imageIds).toHaveLength(6);
    expect(evidence.sources).toHaveLength(6);
    expect(evidence.sources[0].record.file.hash).toMatch(/^sha256:/);
    expect(evidence.operation.pitch).toBe(9);
    expect(evidence.operation.fov).toBe(89);
    expect(checkProvenance(ws).ok).toBe(true);
  }, 180_000);

  it("renders a pan and a spinning tiny planet from one 360° image", async () => {
    const pan = await renderMapillaryPan(fakeMap(), ws, "111", "pan", { durationSeconds: 0.2, fps: 10, turn: 90 });
    expect(pan.path).toBe("assets/video/pan.mp4");
    const planet = await renderMapillaryPlanet(fakeMap(), ws, "111", "earth", { durationSeconds: 0.2, fps: 10 });
    expect(planet.path).toBe("assets/video/earth.mp4");
    const still = await renderMapillaryPlanet(fakeMap(), ws, "111", "dot");
    expect(still.path).toBe("assets/images/dot.jpg");
    expect(checkProvenance(ws).ok).toBe(true);
  }, 180_000);

  it("refuses a second file of the same name and a flat image as a planet", async () => {
    await saveMapillaryStill(fakeMap(), ws, "111", "pano", { quality: { minImageLongSide: 1 } });
    await expect(saveMapillaryStill(fakeMap(), ws, "111", "pano")).rejects.toThrow(/already exists/);
    await expect(renderMapillaryPlanet(fakeMap(), ws, "200", "flat")).rejects.toThrow(/360/);
  }, 120_000);

  it("enforces policy before contacting Mapillary and cleans a quality refusal", async () => {
    const one = vi.fn(); const denied = { one } as unknown as Mapillary;
    await expect(saveMapillaryStill(denied, ws, "111", "no", { policy: { allow: ["CC0"] } })).rejects.toThrow(/licence-refused/);
    expect(one).not.toHaveBeenCalled();
    await expect(saveMapillaryStill(fakeMap(), ws, "111", "small", { quality: { minImageLongSide: 3000 } })).rejects.toThrow(/too-small/);
    expect(existsSync(join(ws, "assets/images/small.jpg"))).toBe(false);
    await saveMapillaryStill(fakeMap(), ws, "111", "small", { vertical: true });
  }, 120_000);

  it("cancels FFmpeg, removes partial outputs and permits retry of the same name", async () => {
    const fake = join(media, "stall-ffmpeg"), marker = join(media, "ready");
    writeFileSync(fake, `#!${process.execPath}\nrequire("node:fs").writeFileSync(process.argv.at(-1), "partial"); require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ready"); setInterval(()=>{},1000);\n`); chmodSync(fake, 0o755);
    const previous = process.env.FFMPEG_PATH, controller = new AbortController();
    let pending: Promise<unknown> | undefined;
    try {
      process.env.FFMPEG_PATH = fake;
      pending = renderMapillaryPan(fakeMap(), ws, "111", "retry", { durationSeconds: 0.2, fps: 10, signal: controller.signal });
      const rejection = expect(pending).rejects.toThrow(/cancelled/);
      for (let i = 0; i < 100 && !existsSync(marker); i++) await new Promise((r) => setTimeout(r, 20));
      expect(existsSync(marker)).toBe(true); controller.abort(); await rejection;
      expect(existsSync(join(ws, "assets/video/retry.mp4"))).toBe(false);
      expect(readdirSync(join(ws, "assets/video"))).toEqual([]);
    } finally { controller.abort(); await pending?.catch(() => undefined); if (previous === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = previous; }
    await renderMapillaryPan(fakeMap(), ws, "111", "retry", { durationSeconds: 0.2, fps: 10 });
    expect(checkProvenance(ws).ok).toBe(true);
  }, 120_000);

  it("records measured durations rather than the requested fractional frame length", async () => {
    const got = await renderMapillaryPan(fakeMap(), ws, "111", "rounded", { durationSeconds: 0.21, fps: 10 });
    expect(got.record.file.durationSeconds).toBeCloseTo(0.2, 3);
  }, 120_000);

  it("writes a GeoJSON LineString for a sequence path", () => {
    const text = sequenceGeoJson(flat, "s2");
    const geo = JSON.parse(text) as { geometry: { coordinates: number[][] }; properties: { license: string } };
    expect(geo.geometry.coordinates).toHaveLength(6);
    expect(geo.properties.license).toBe("CC-BY-SA-4.0");
    expect(geo.geometry.coordinates[0]).toHaveLength(2);
  });
});
