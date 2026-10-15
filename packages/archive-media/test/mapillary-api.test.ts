import { describe, expect, it, vi } from "vitest";
import { createMapillary, runs, bearing, distance, compass, bbox, angleDiff, MAPILLARY_CDN } from "../src/mapillary-api.js";
import type { MapillaryImage } from "../src/mapillary-api.js";

const img = (id: string, lng: number, lat: number, extra: Partial<MapillaryImage> = {}): MapillaryImage => ({
  id, sequence: "s1", captured_at: Date.UTC(2020, 0, 1), computed_geometry: { coordinates: [lng, lat] }, computed_compass_angle: 90,
  is_pano: false, creator: { username: "ana" }, width: 2048, height: 1536, quality_score: 0.8, ...extra,
});
// A straight northward walk: 10 m per step (about 0.00009 deg latitude).
const straight = Array.from({ length: 8 }, (_, k) => img(String(k), 12.5, 41.9 + k * 0.00009, { computed_compass_angle: 0 }));
function mapWith(handler: (url: string) => unknown, opts: { token?: string } = { token: "MLY|test" }) {
  const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(handler(url)), { headers: { "content-type": "application/json" } }));
  return { map: createMapillary({ userAgent: "test", env: {}, fetch: fetch as unknown as typeof fetch, minIntervalMs: 0, ...opts }), fetch };
}

describe("mapillary geometry", () => {
  it("measures a straight walk and finds the run", () => {
    expect(Math.round(distance(straight[0]!, straight[1]!))).toBe(10);
    expect(Math.round(bearing(straight[0]!, straight[1]!))).toBe(0);
    expect(compass(0)).toBe("N");
    expect(compass(135)).toBe("SE");
    expect(angleDiff(1, 359)).toBe(2);
    expect(angleDiff(359, 1)).toBe(2);
    const [run] = runs(straight);
    expect(run).toMatchObject({ from: 0, to: 7, images: 8, bearing: 0 });
    expect(bbox(41.9, 12.5, 150).split(",")).toHaveLength(4);
  });
  it("breaks a run when the camera turns away", () => {
    const long = Array.from({ length: 16 }, (_, k) => img(String(k), 12.5, 41.9 + k * 0.00009, { computed_compass_angle: 0 }));
    const turned = long.map((i, k) => (k < 8 ? i : { ...i, computed_compass_angle: 180 }));
    const found = runs(turned);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]).toMatchObject({ from: 0, to: 7, images: 8 });
  });
});

describe("mapillary queries", () => {
  it("geocodes a place and ranks sequences by their best run", async () => {
    const two = [...straight, ...straight.map((i, k) => ({ ...i, id: `b${k}`, sequence: "s2", quality_score: 0.4 }))];
    const { map, fetch } = mapWith((url) => (url.includes("nominatim") ? [{ lat: "41.9", lon: "12.5", display_name: "Roma" }] : { data: two }));
    const got = await map.coverage("Roma");
    expect(fetch.mock.calls[0]?.[0]).toContain("nominatim.openstreetmap.org");
    expect(got.images).toBe(16);
    expect(got.sequences[0]).toMatchObject({ ref: "mapillary:seq:s1", images: 8, pano: false, quality: 0.8 });
    expect(got.sequences[0]!.run.images).toBe(8);
    expect(got.center).toEqual([41.9, 12.5]);
  });
  it("reports a sequence's length, runs and page", async () => {
    const { map } = mapWith(() => ({ data: straight }));
    const got = await map.coverageOfSequence("s1");
    expect(got).toMatchObject({ ref: "mapillary:seq:s1", images: 8, pano: false, creator: "ana" });
    expect(got.meters).toBeGreaterThan(60);
    expect(got.runs[0]).toMatchObject({ from: 0, to: 7 });
    expect(got.start[0]).toBeCloseTo(41.9, 3);
    await expect(map.coverageOfSequence("s1")).resolves.toBeTruthy();
  });
  it("throws when a sequence is missing", async () => {
    const { map } = mapWith(() => ({ data: [] }));
    await expect(map.coverageOfSequence("nope")).rejects.toThrow(/not found/);
  });
  it("picks one image per year closest to the point and honours heading", async () => {
    const years = [
      img("y2015", 12.5002, 41.9002, { captured_at: Date.UTC(2015, 5, 1), computed_compass_angle: 0 }),
      img("y2020", 12.50005, 41.90005, { captured_at: Date.UTC(2020, 5, 1), computed_compass_angle: 90 }),
      img("y2016far", 12.52, 41.92, { captured_at: Date.UTC(2016, 5, 1), computed_compass_angle: 180 }),
    ];
    const { map } = mapWith(() => ({ data: years }));
    const got = await map.history("41.9,12.5");
    expect(got.years.map((y) => y.year)).toEqual([2015, 2016, 2020]);
    expect(got.years[0]!.ref).toBe("mapillary:image:y2015");
    const faced = await map.history("41.9,12.5", { heading: 0 });
    expect(faced.years.some((y) => y.id === "y2020")).toBe(false); // 90° off the asked heading
  });
  it("aggregates map features and refuses to invent a licence", async () => {
    const { map } = mapWith((url) => (url.includes("map_features")
      ? { data: [{ id: "f1", object_value: "regulatory--stop--g1", geometry: {}, first_seen_at: "2016-01-01T00:00:00Z", last_seen_at: "2020-01-01T00:00:00Z" }, { id: "f2", object_value: "regulatory--stop--g1", first_seen_at: "2018-01-01T00:00:00Z", last_seen_at: "2021-01-01T00:00:00Z" }] }
      : { data: straight }));
    const got = await map.features("41.9,12.5", { kind: "signs" });
    expect(got.features).toBe(2);
    expect(got.values[0]).toMatchObject({ value: "regulatory--stop--g1", count: 2, first: "2016-01-01", last: "2021-01-01" });
  });
  it("counts non-void detections and picks the best photo by distance and quality", async () => {
    const { map } = mapWith((url) => (url.includes("/detections") ? { data: [{ value: "void--car" }, { value: "object--car" }, { value: "object--car" }] } : { data: [img("a", 12.5, 41.9, { quality_score: 0.9 }), img("b", 12.54, 41.94, { quality_score: 0.1 })] }));
    expect(await map.detections("1")).toMatchObject({ detections: 3, values: [["object--car", 2]] });
    const got = await map.photo("41.9,12.5");
    expect(got.photos[0]!.id).toBe("a");
  });
  it("requires a token and refuses a non-CDN download host", async () => {
    const { map } = mapWith(() => ({ data: [] }), { token: undefined });
    await expect(map.coverage("41.9,12.5")).rejects.toThrow(/MAPILLARY_TOKEN/);
    expect(MAPILLARY_CDN).toEqual([".fbcdn.net", ".mapillary.com"]);
    const { map: withToken } = mapWith(() => ({ data: [] }));
    await expect(withToken.download("https://evil.invalid/x.jpg", "x.jpg")).rejects.toThrow(/allowlist/);
  });
});
