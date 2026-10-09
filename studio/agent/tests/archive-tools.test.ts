import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArchive, licenceFromName, type ArchiveItem, type Provider } from "@av/archive-media";
import { archiveSettings, registerArchiveTools } from "../src/archive-tools.js";

/** Pi's archive tools (avg-fe8.2), on a fake museum: the channel's policy decides what may be fetched. */

let root: string;
const EP = () => join(root, "sample", "series", "poetry", "episodes", "morning");
const previous = process.env.AVG_LIBRARY_ROOT;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "archive-tools-"));
  mkdirSync(EP(), { recursive: true });
  process.env.AVG_LIBRARY_ROOT = root;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (previous === undefined) delete process.env.AVG_LIBRARY_ROOT;
  else process.env.AVG_LIBRARY_ROOT = previous;
});

function png(w: number, h: number) {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
const item = (id: string, licence: string): ArchiveItem => ({
  provider: "museum", id, mediaType: "image", title: `Storm ${id}`, landingUrl: `https://museum.example/${id}`, fileUrl: `https://files.example/${id}.png`,
  width: 3000, height: 2000, licence: licenceFromName(licence)!, attribution: `«Storm ${id}». ${licence}`, raw: { id },
});
const ITEMS = [item("pd", "pdm"), item("nc", "CC BY-NC 4.0")];

function tools() {
  const provider: Provider = { id: "museum", label: "A Museum", mediaTypes: ["image"], search: async () => ITEMS, item: async (id) => ITEMS.find((i) => i.id === id)! };
  const fake = (async () => new Response(png(3000, 2000), { headers: { "content-type": "image/png" } })) as unknown as typeof fetch;
  const archive = createArchive({ userAgent: "test", registry: [provider], fetch: fake, sleep: async () => undefined });
  const registered = new Map<string, any>();
  registerArchiveTools({ registerTool: (t: { name: string }) => registered.set(t.name, t) } as never, { archive });
  return (name: string, params: Record<string, unknown>) => registered.get(name)!.execute("call", params);
}

describe("archive tools", () => {
  it("search shows what the policy allows, and says how many it left out", async () => {
    const run = tools();
    const result = await run("pva_search_media", { channel: "sample", query: "storm" });
    expect(result.content[0].text).toContain("1 candidates");
    expect(result.content[0].text).toContain('museum "pd"');
    expect(result.content[0].text).toContain("1 left out by the policy");
    expect(result.details.candidates[0].raw).toBeUndefined();
    const all = await run("pva_search_media", { channel: "sample", query: "storm", onlyAllowed: false });
    expect(all.content[0].text).toContain("refused: CC-BY-NC-4.0 is not allowed");
  });

  it("fetches into the episode with its record and attributions; refuses what the channel does not allow", async () => {
    const run = tools();
    const ok = await run("pva_fetch_media", { channel: "sample", series: "poetry", episode: "morning", provider: "museum", id: "pd", name: "storm" });
    expect(ok.isError).toBeUndefined();
    expect(existsSync(join(EP(), "assets/images/storm.png"))).toBe(true);
    expect(readFileSync(join(EP(), "ATTRIBUTIONS.md"), "utf-8")).toContain("«Storm pd»");
    const nc = await run("pva_fetch_media", { channel: "sample", series: "poetry", episode: "morning", provider: "museum", id: "nc", name: "storm2" });
    expect([nc.isError, nc.content[0].text]).toEqual([true, expect.stringContaining("licence-refused")]);
    const checked = await run("pva_check_provenance", { channel: "sample", series: "poetry", episode: "morning" });
    expect(checked.content[0].text).toContain("✅ 1 archive files");
  });

  it("follows the channel's settings, the series' over them", async () => {
    writeFileSync(join(root, "sample", "settings.yaml"), "archiveMedia:\n  licences: [public-domain, CC0, CC-BY, CC-BY-SA, CC-BY-NC]\n  minImageLongSide: 2400\n");
    mkdirSync(join(root, "sample", "series", "poetry"), { recursive: true });
    expect(archiveSettings(root, "sample")).toEqual({ policy: { allow: ["public-domain", "CC0", "CC-BY", "CC-BY-SA", "CC-BY-NC"] }, quality: { minImageLongSide: 2400 } });
    writeFileSync(join(root, "sample", "series", "poetry", "settings.yaml"), "archiveMedia:\n  licences: [public-domain]\n");
    expect(archiveSettings(root, "sample", "poetry").policy.allow).toEqual(["public-domain"]);
    const run = tools();
    const nc = await run("pva_fetch_media", { channel: "sample", series: "other", episode: "x", provider: "museum", id: "nc", name: "n" });
    expect(nc.content[0].text).toContain("there is no episode");
  });

  it("refuses names that are not slugs", async () => {
    const run = tools();
    const bad = await run("pva_fetch_media", { channel: "../x", series: "poetry", episode: "morning", provider: "museum", id: "pd", name: "s" });
    expect(bad.isError).toBe(true);
  });
});
