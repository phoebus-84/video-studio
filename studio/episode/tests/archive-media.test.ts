import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArchive, licenceFromName, unknownLicence, type ArchiveItem, type Provider } from "@av/archive-media";
import { checkProvenance, fetchIntoWorkspace, readProvenance } from "../src/archive-media.js";

/**
 * Archive media in a workspace (avg-fe8.2): the file, its record beside it,
 * the provider's response kept as evidence, ATTRIBUTIONS.md made again.
 */

let ws: string;
beforeEach(() => { ws = mkdtempSync(join(tmpdir(), "archive-ws-")); });
afterEach(() => rmSync(ws, { recursive: true, force: true }));

function png(w: number, h: number, salt = 0) {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); b[40] = salt;
  return b;
}

const ITEM: ArchiveItem = {
  provider: "museum", id: "24645", mediaType: "image", title: "The Great Wave", creator: "Hokusai", date: "1830/33", institution: "A Museum",
  landingUrl: "https://museum.example/artworks/24645", fileUrl: "https://files.example/wave.png",
  licence: { ...licenceFromName("pdm")! }, attribution: "«The Great Wave» by Hokusai (1830/33), A Museum. Public domain",
  raw: { id: 24645, is_public_domain: true },
};

function archiveWith(item: ArchiveItem, body: Buffer) {
  const provider: Provider = { id: "museum", label: "A Museum", mediaTypes: ["image"], search: async () => [item], item: async () => item };
  const fake = (async () => new Response(body, { headers: { "content-type": "image/png" } })) as unknown as typeof fetch;
  return createArchive({ userAgent: "test", registry: [provider], fetch: fake, sleep: async () => undefined });
}

describe("fetchIntoWorkspace", () => {
  it("puts the file, its record and the evidence in place, and makes ATTRIBUTIONS.md", async () => {
    const got = await fetchIntoWorkspace(ws, { archive: archiveWith(ITEM, png(3000, 2000)), provider: "museum", id: "24645", name: "wave" });
    expect(got.path).toBe("assets/images/wave.png");
    expect(got.recordPath).toBe("assets/images/wave.source.json");
    expect(got.record).toMatchObject({
      kind: "MediaProvenance", file: { path: "assets/images/wave.png", width: 3000, height: 2000, mime: "image/png" },
      provider: { id: "museum", label: "A Museum" }, item: { id: "24645", landingUrl: "https://museum.example/artworks/24645" },
      licence: { id: "public-domain", basis: "PDM-1.0" },
    });
    expect(JSON.parse(readFileSync(join(ws, got.record.evidence.path), "utf-8"))).toEqual({ id: 24645, is_public_domain: true });
    expect(readFileSync(join(ws, "ATTRIBUTIONS.md"), "utf-8")).toContain("«The Great Wave» by Hokusai");
    expect(readdirSync(join(ws, "assets/images")).sort()).toEqual(["wave.png", "wave.source.json"]);
    expect(checkProvenance(ws)).toEqual({ ok: true, files: 1, problems: [] });
  });

  it("leaves the workspace as it was on a refusal", async () => {
    const nd = { ...ITEM, licence: licenceFromName("CC BY-ND 4.0")! };
    await expect(fetchIntoWorkspace(ws, { archive: archiveWith(nd, png(3000, 2000)), provider: "museum", id: "24645", name: "wave" })).rejects.toMatchObject({ code: "licence-refused" });
    await expect(fetchIntoWorkspace(ws, { archive: archiveWith({ ...ITEM, licence: unknownLicence("none") }, png(3000, 2000)), provider: "museum", id: "24645", name: "wave" })).rejects.toMatchObject({ code: "licence-refused" });
    await expect(fetchIntoWorkspace(ws, { archive: archiveWith(ITEM, png(600, 400)), provider: "museum", id: "24645", name: "wave" })).rejects.toMatchObject({ code: "too-small" });
    expect(existsSync(join(ws, "ATTRIBUTIONS.md"))).toBe(false);
    expect(existsSync(join(ws, "assets/images")) ? readdirSync(join(ws, "assets/images")) : []).toEqual([]);
  });

  it("never takes a name already used, unless told to replace it", async () => {
    writeFileSync(join(ws, "x"), "");
    const archive = archiveWith(ITEM, png(3000, 2000));
    await fetchIntoWorkspace(ws, { archive, provider: "museum", id: "24645", name: "wave" });
    await expect(fetchIntoWorkspace(ws, { archive, provider: "museum", id: "24645", name: "Wave" })).rejects.toThrow(/already has wave\.png/);
    await expect(fetchIntoWorkspace(ws, { archive, provider: "museum", id: "24645", name: "../wave" })).rejects.toThrow(/not an asset id/);
    const again = await fetchIntoWorkspace(ws, { archive: archiveWith(ITEM, png(3200, 2000, 7)), provider: "museum", id: "24645", name: "wave", replace: true });
    expect(again.record.file.width).toBe(3200);
    expect(readProvenance(ws).records).toHaveLength(1);
  });
});

describe("checkProvenance", () => {
  it("finds a file replaced by hand, evidence gone, a record broken, and stale attributions", async () => {
    const got = await fetchIntoWorkspace(ws, { archive: archiveWith(ITEM, png(3000, 2000)), provider: "museum", id: "24645", name: "wave" });
    writeFileSync(join(ws, got.path), png(3000, 2000, 9));
    rmSync(join(ws, got.record.evidence.path));
    writeFileSync(join(ws, "ATTRIBUTIONS.md"), "edited by hand\n");
    writeFileSync(join(ws, "assets/images/other.source.json"), "{ nope");
    const checked = checkProvenance(ws);
    expect(checked.ok).toBe(false);
    expect(checked.problems.map((p) => p.path)).toEqual(["assets/images/other.source.json", "assets/images/wave.png", got.record.evidence.path, "ATTRIBUTIONS.md"]);
  });
});
