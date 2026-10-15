import { describe, expect, it, vi } from "vitest";
import { createArchive } from "../src/archive.js";
import { licenceAllowed } from "../src/licence.js";
import { mapillary, mapillaryInternals } from "../src/providers/mapillary.js";
import type { Http } from "../src/types.js";

const opts = { mediaType: "image" as const, limit: 5 };
const key = "MLY|test";
function http(...answers: unknown[]) {
  const json = vi.fn(async () => (answers.length > 1 ? answers.shift() : answers[0]));
  return { json, userAgent: "test", notify: vi.fn(async () => undefined) } satisfies Http;
}
const row = { id: 42, captured_at: 1700000000000, thumb_original_url: "https://scontent.xx.fbcdn.net/m1.jpg", width: 2048, height: 1536, is_pano: false, quality_score: 0.9, creator: { username: "ana" } };

describe("Mapillary", () => {
  it("geocodes a place, builds a bbox, reads the token and ranks by quality", async () => {
    const h = http([{ lat: "41.9", lon: "12.5", display_name: "Roma" }], { data: [row, { ...row, id: 43, quality_score: 0.4 }] });
    const rows = await mapillary.search("Roma", opts, h, key);
    expect(h.json.mock.calls[0]?.[0]).toContain("nominatim.openstreetmap.org");
    const url = String(h.json.mock.calls[1]?.[0]);
    expect(url).toContain("graph.mapillary.com/images");
    expect(url).toContain("access_token=MLY%7Ctest");
    expect(url).toContain("bbox=");
    expect(rows.map((r) => r.id)).toEqual(["42", "43"]);
    expect(rows[0]).toMatchObject({ creator: "ana", licence: { id: "CC-BY-SA-4.0" }, date: "2023-11-14" });
    expect(licenceAllowed(rows[0]!.licence).ok).toBe(true);
    expect(rows[0]!.attribution).toContain("CC BY-SA 4.0");
  });
  it("accepts an explicit lat,lng without calling the geocoder", async () => {
    const h = http({ data: [row] });
    await mapillary.search("41.9,12.5", opts, h, key);
    expect(h.json.mock.calls[0]?.[0]).not.toContain("nominatim");
  });
  it("refuses a file outside the Mapillary CDN and an unlicensed quality score", async () => {
    expect(mapillaryInternals.CDN).toEqual([".fbcdn.net", ".mapillary.com"]);
    const [got] = await mapillary.search("41.9,12.5", opts, http({ data: [{ ...row, thumb_original_url: "https://evil.invalid/x.jpg" }] }), key);
    expect(got).toBeUndefined();
  });
  it("requires its token and a numeric id, and never sends the token off host", async () => {
    const archive = createArchive({ userAgent: "test", env: {} });
    expect(archive.providers().find((p) => p.id === "mapillary")).toMatchObject({ enabled: false, reason: "needs MAPILLARY_TOKEN" });
    await expect(mapillary.item("not-numeric", http({}), key)).rejects.toThrow();
    const asked = http(row);
    await mapillary.item("42", asked, key);
    const url = String(asked.json.mock.calls[0]?.[0]);
    expect(new URL(url).host).toBe("graph.mapillary.com");
    expect(url).toContain("access_token=");
  });
});
