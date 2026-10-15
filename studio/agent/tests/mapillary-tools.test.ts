import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMapillary, type MapillaryImage } from "@av/archive-media";
import { registerMapillaryTools } from "../src/mapillary-tools.js";

/** Pi's Mapillary tool (avg-lvb), on a faked Mapillary API. */

let root: string;
const previous = process.env.AVG_LIBRARY_ROOT;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "mly-tools-")); process.env.AVG_LIBRARY_ROOT = root; });
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (previous === undefined) delete process.env.AVG_LIBRARY_ROOT; else process.env.AVG_LIBRARY_ROOT = previous;
});

const flat = Array.from({ length: 8 }, (_, k): MapillaryImage => ({ id: String(100 + k), sequence: "s2", captured_at: Date.UTC(2020, 0, 1) + k * 1000,
  computed_geometry: { coordinates: [12.5, 41.9 + k * 0.00009] }, computed_compass_angle: 0, is_pano: false, creator: { username: "ana" },
  width: 2048, height: 1536, quality_score: 0.8, thumb_2048_url: `https://scontent.xx.fbcdn.net/f${k}.jpg` }));

function tools() {
  const fakeFetch: typeof fetch = async (input) => {
    const u = new URL(String(input));
    const body = u.pathname.includes("images") ? { data: flat } : { data: [] };
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  };
  const mapillary = createMapillary({ userAgent: "test", env: {}, token: "MLY|test", fetch: fakeFetch, minIntervalMs: 0 });
  const registered = new Map<string, any>();
  registerMapillaryTools({ registerTool: (t: { name: string }) => registered.set(t.name, t) } as never, { mapillary });
  return (params: Record<string, unknown>) => registered.get("pva_mapillary")!.execute("call", params);
}

describe("mapillary tool", () => {
  it("lists coverage with runs and credits", async () => {
    const run = tools();
    const got = await run({ action: "coverage", query: "41.9,12.5" });
    expect(got.isError).toBeUndefined();
    expect(got.content[0].text).toContain("sequences within 150 m");
    expect(got.content[0].text).toContain("mapillary:seq:s2");
    expect(got.content[0].text).toContain("ana");
  });
  it("reports a sequence and writes its GeoJSON on request", async () => {
    const run = tools();
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(root, "sample", "series", "poetry", "episodes", "morning"), { recursive: true });
    const got = await run({ action: "sequence", seq: "s2", channel: "sample", series: "poetry", episode: "morning", geojson: true });
    expect(got.content[0].text).toContain("mapillary:seq:s2");
    expect(got.content[0].text).toContain("geojson artifacts/");
  });
  it("requires the fields an action needs, and reports a missing token rather than a crash", async () => {
    const run = tools();
    expect((await run({ action: "detections" })).isError).toBe(true);
    expect((await run({ action: "hyperlapse", channel: "sample", series: "poetry", episode: "morning" })).isError).toBe(true);
  });
});
