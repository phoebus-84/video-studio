import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArchive, licenceFromName, unknownLicence, type ArchiveItem, type Provider } from "@av/archive-media";
import { fetchIntoWorkspace } from "../src/archive-media.js";
import { deriveMedia } from "../src/media-derivatives.js";
import { findLocalMedia, reuseLocalMedia } from "../src/local-media.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf-8" }).status === 0;
let channel: string;
beforeEach(() => { channel = mkdtempSync(join(tmpdir(), "channel-")); });
afterEach(() => rmSync(channel, { recursive: true, force: true }));

const PNG = (() => {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(3000, 16); b.writeUInt32BE(2000, 20);
  return b;
})();
const ITEM: ArchiveItem = {
  provider: "museum", id: "1", mediaType: "image", title: "The Great Wave", creator: "Hokusai", institution: "A Museum",
  landingUrl: "https://museum.example/1", fileUrl: "https://files.example/wave.png",
  licence: { ...licenceFromName("pdm")! }, attribution: "«The Great Wave» by Hokusai, A Museum. Public domain", raw: { id: 1 },
};
function archiveWith(item: ArchiveItem, body: Buffer) {
  const provider: Provider = { id: item.provider, label: "A Museum", mediaTypes: [item.mediaType], search: async () => [item], item: async () => item };
  const fake = (async () => new Response(body, { headers: { "content-type": "image/png" } })) as unknown as typeof fetch;
  return createArchive({ userAgent: "test", registry: [provider], fetch: fake, sleep: async () => undefined });
}
const episodeDir = (name: string) => { const d = join(channel, "series", name); mkdirSync(d, { recursive: true }); return d; };

describe("local library lookup and reuse", () => {
  it("finds an existing licensed asset by title/creator and reuses its bytes without another provider call", async () => {
    const first = episodeDir("ep-1");
    await fetchIntoWorkspace(first, { archive: archiveWith(ITEM, PNG), provider: "museum", id: "1", name: "wave" });
    const hits = findLocalMedia(channel, "hokusai");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ recordPath: "series/ep-1/assets/images/wave.source.json", record: { item: { title: "The Great Wave" } } });

    const second = episodeDir("ep-2");
    const got = reuseLocalMedia(channel, hits[0]!.recordPath, second, "reused");
    expect(got.deduplicated).toBe(false);
    expect(got.path).toBe("assets/images/reused.png");
    expect(existsSync(join(second, got.path))).toBe(true);
    expect(existsSync(join(second, got.recordPath))).toBe(true);
    expect(existsSync(join(second, hits[0]!.record.evidence.path))).toBe(true);
    expect(readFileSync(join(second, "ATTRIBUTIONS.md"), "utf-8")).toContain("The Great Wave");
    expect(JSON.parse(readFileSync(join(second, got.recordPath), "utf-8")).file.path).toBe("assets/images/reused.png");
  });
  it("reports the same SHA-256 instead of copying twice, and refuses a tampered source", async () => {
    const first = episodeDir("ep-1");
    await fetchIntoWorkspace(first, { archive: archiveWith(ITEM, PNG), provider: "museum", id: "1", name: "wave" });
    const second = episodeDir("ep-2");
    const rec = "series/ep-1/assets/images/wave.source.json";
    reuseLocalMedia(channel, rec, second, "one");
    const again = reuseLocalMedia(channel, rec, second, "two");
    expect(again).toMatchObject({ deduplicated: true, path: "assets/images/one.png" });

    writeFileSync(join(first, "assets/images/wave.png"), PNG.subarray(0, 60));
    expect(() => reuseLocalMedia(channel, rec, episodeDir("ep-3"), "three")).toThrow(/hash/);
  });
});

describe.skipIf(!hasFfmpeg)("local derivatives", () => {
  async function aVideo(): Promise<string> {
    const ws = episodeDir("ep-video");
    const dir = join(ws, "assets/video");
    mkdirSync(dir, { recursive: true });
    const src = join(dir, "src.mp4");
    const run = spawnSync("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15", "-t", "1", "-pix_fmt", "yuv420p", src], { encoding: "utf-8" });
    expect(run.status).toBe(0);
    const { createHash } = await import("node:crypto");
    const bytes = readFileSync(src);
    const record = {
      apiVersion: "studio.video/v1alpha1", kind: "MediaProvenance",
      file: { path: "assets/video/src.mp4", hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, bytes: bytes.length, mime: "video/mp4", width: 320, height: 240, durationSeconds: 1 },
      provider: { id: "museum", label: "A Museum" },
      item: { id: "v1", title: "Clip", landingUrl: "https://museum.example/v1", fileUrl: "https://files.example/v.mp4" },
      licence: { ...licenceFromName("pdm")! },
      attribution: "Clip. Public domain", retrievedAt: new Date().toISOString(),
      evidence: { path: "artifacts/provenance/" + "a".repeat(64) + ".json", hash: `sha256:${"b".repeat(64)}` },
    };
    mkdirSync(join(ws, "artifacts/provenance"), { recursive: true });
    writeFileSync(join(ws, record.evidence.path), "{}\n");
    writeFileSync(join(dir, "src.source.json"), `${JSON.stringify(record, null, 2)}\n`);
    return ws;
  }
  it("trims and converts to vertical without touching the original, with chained provenance", async () => {
    const ws = await aVideo();
    const before = readFileSync(join(ws, "assets/video/src.mp4"));
    const got = deriveMedia(ws, "assets/video/src.mp4", "vert", { durationSeconds: 0.5, vertical: true });
    expect(got.path).toBe("assets/video/vert.mp4");
    expect(got.record).toMatchObject({ file: { width: 1080, height: 1920 }, item: { id: "v1" } });
    expect(got.record.item.rendition).toContain("local derivative");
    expect(got.record.attribution).toContain("locally derived");
    expect(readFileSync(join(ws, "assets/video/src.mp4")).equals(before)).toBe(true);
    const evidence = JSON.parse(readFileSync(join(ws, got.record.evidence.path), "utf-8"));
    expect(evidence).toMatchObject({ kind: "ffmpeg-derivative", source: { path: "assets/video/src.mp4" } });
    expect(readFileSync(join(ws, "ATTRIBUTIONS.md"), "utf-8")).toContain("locally derived");
  });
  it("refuses an input without a matching hash and a name already taken", async () => {
    const ws = await aVideo();
    writeFileSync(join(ws, "assets/video/src.mp4"), "corrupted");
    expect(() => deriveMedia(ws, "assets/video/src.mp4", "x", {})).toThrow(/provenance/);
  });
  it("never lets a derivative escape the canonical asset folders", async () => {
    const ws = await aVideo();
    expect(() => deriveMedia(ws, "../secret.mp4", "x", {})).toThrow(/canonical/);
    expect(() => deriveMedia(ws, "assets/video/src.mp4", "../x", {})).toThrow(/output name/);
  });
});

describe("licence vocabulary still rejects", () => {
  it("leaves an unknown licence unfetchable", () => {
    expect(unknownLicence("none").id).toBe("unknown");
  });
});
