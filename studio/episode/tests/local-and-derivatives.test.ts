import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArchive, licenceFromName, type ArchiveItem, type Provider } from "@av/archive-media";
import { checkProvenance, fetchIntoWorkspace, writeAttributions } from "../src/archive-media.js";
import { deriveMedia } from "../src/media-derivatives.js";
import { findLocalMedia, reuseLocalMedia } from "../src/local-media.js";
import { mediaHash, verifyMediaEvidence } from "../src/media-integrity.js";
import { mediaCommand } from "../src/media-process.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
let channel: string;
beforeEach(() => { channel = mkdtempSync(join(tmpdir(), "channel-")); });
afterEach(() => rmSync(channel, { recursive: true, force: true }));
const ws = (name: string) => { const d = join(channel, "series", name); mkdirSync(d, { recursive: true }); return d; };
const PNG = (() => { const b = Buffer.alloc(64); b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write("IHDR", 12, "ascii"); b.writeUInt32BE(3000, 16); b.writeUInt32BE(2000, 20); return b; })();
const ITEM: ArchiveItem = { provider: "museum", id: "1", mediaType: "image", title: "The Great Wave", creator: "Hokusai", institution: "A Museum", landingUrl: "https://museum.example/1", fileUrl: "https://files.example/wave.png", licence: licenceFromName("pdm")!, attribution: "The Great Wave, Hokusai. Public domain", raw: { id: 1, rights: "public domain" } };
async function fetched(workspace: string, item = ITEM) {
  const provider: Provider = { id: item.provider, label: "A Museum", mediaTypes: [item.mediaType], search: async () => [item], item: async () => item };
  const fetcher = (async () => new Response(PNG, { headers: { "content-type": "image/png" } })) as unknown as typeof fetch;
  return fetchIntoWorkspace(workspace, { archive: createArchive({ userAgent: "test", registry: [provider], fetch: fetcher, minIntervalMs: 0 }), provider: item.provider, id: item.id, name: "wave", policy: { allow: ["public-domain", "CC-BY-NC"] } });
}
const relativeRecord = "series/first/assets/images/wave.source.json";

describe("local library lookup and reuse", () => {
  it("finds and reuses verified media, including its portable evidence", async () => {
    await fetched(ws("first"));
    const hits = findLocalMedia(channel, "hokusai"); expect(hits).toHaveLength(1);
    const second = ws("second"), got = await reuseLocalMedia(channel, hits[0]!.recordPath, second, "reused");
    expect(got).toMatchObject({ deduplicated: false, path: "assets/images/reused.png" });
    expect(checkProvenance(second).ok).toBe(true);
    expect(readFileSync(join(second, "ATTRIBUTIONS.md"), "utf-8")).toContain("Hokusai");
    expect(await reuseLocalMedia(channel, hits[0]!.recordPath, second, "two")).toMatchObject({ deduplicated: true, path: got.path });
  });
  it("checks the destination policy instead of inheriting another series' permission", async () => {
    await fetched(ws("first"), { ...ITEM, licence: licenceFromName("CC BY-NC 4.0")! });
    const target = ws("commercial");
    await expect(reuseLocalMedia(channel, relativeRecord, target, "x")).rejects.toThrow(/licence-refused/);
    expect(readdirSync(target)).toEqual([]);
  });
  it("refuses changed source bytes and does not advertise them in local search", async () => {
    const first = ws("first"); await fetched(first); writeFileSync(join(first, "assets/images/wave.png"), "corrupt");
    expect(findLocalMedia(channel)).toHaveLength(0);
    await expect(reuseLocalMedia(channel, relativeRecord, ws("second"), "x")).rejects.toThrow(/hash/);
  });
  it("verifies evidence before copying and verifies a deduplication hit's bytes", async () => {
    const first = ws("first"), original = await fetched(first), second = ws("second");
    const got = await reuseLocalMedia(channel, relativeRecord, second, "x");
    writeFileSync(join(second, got.path), "tampered");
    await expect(reuseLocalMedia(channel, relativeRecord, second, "y")).rejects.toThrow(/hash/);
    writeFileSync(join(first, original.record.evidence.path), "{}");
    await expect(reuseLocalMedia(channel, relativeRecord, ws("third"), "z")).rejects.toThrow(/evidence hash/);
  });
  it("refuses symlinked source records, assets, evidence and destination directories outside the channel", async () => {
    const first = ws("first"), got = await fetched(first), outside = mkdtempSync(join(tmpdir(), "outside-media-"));
    try {
      const asset = join(first, got.path), saved = join(outside, "wave.png"); writeFileSync(saved, PNG);
      rmSync(asset); symlinkSync(saved, asset);
      await expect(reuseLocalMedia(channel, relativeRecord, ws("second"), "x")).rejects.toThrow(/escapes/);
      rmSync(asset); writeFileSync(asset, PNG);
      const evidence = join(first, got.record.evidence.path), text = readFileSync(evidence); rmSync(evidence); writeFileSync(join(outside, "evidence.json"), text); symlinkSync(join(outside, "evidence.json"), evidence);
      await expect(reuseLocalMedia(channel, relativeRecord, ws("third"), "x")).rejects.toThrow(/escapes/);
      rmSync(evidence); writeFileSync(evidence, text);
      const rec = join(first, got.recordPath), recText = readFileSync(rec); rmSync(rec); writeFileSync(join(outside, "record.json"), recText); symlinkSync(join(outside, "record.json"), rec);
      await expect(reuseLocalMedia(channel, relativeRecord, ws("fourth"), "x")).rejects.toThrow(/escapes/);
      rmSync(rec); writeFileSync(rec, recText);
      const target = ws("fifth"); mkdirSync(join(target, "assets")); symlinkSync(outside, join(target, "assets/images"), "dir");
      await expect(reuseLocalMedia(channel, relativeRecord, target, "x")).rejects.toThrow(/escapes/);
      expect(existsSync(join(outside, "x.png"))).toBe(false);
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });
  it("does not clobber a conflicting destination evidence file", async () => {
    const got = await fetched(ws("first")), second = ws("second"); mkdirSync(join(second, "artifacts/provenance"), { recursive: true });
    writeFileSync(join(second, got.record.evidence.path), "tampered evidence");
    await expect(reuseLocalMedia(channel, relativeRecord, second, "x")).rejects.toThrow(/evidence hash/);
    expect(existsSync(join(second, "assets/images/x.png"))).toBe(false);
  });
});

const lowQuality = { minVideoHeight: 1 };
async function aVideo(licence = "pdm") {
  const dir = ws("video"); mkdirSync(join(dir, "assets/video"), { recursive: true });
  const file = join(dir, "assets/video/src.mp4");
  expect(spawnSync("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15", "-t", "1", "-pix_fmt", "yuv420p", file]).status).toBe(0);
  const bytes = readFileSync(file), evidenceText = JSON.stringify({ providerRecord: "original", licence }), h = mediaHash(evidenceText), evidencePath = `artifacts/provenance/${h.slice(7)}.json`;
  mkdirSync(join(dir, "artifacts/provenance"), { recursive: true }); writeFileSync(join(dir, evidencePath), evidenceText);
  const record = { apiVersion: "studio.video/v1alpha1", kind: "MediaProvenance", file: { path: "assets/video/src.mp4", hash: mediaHash(bytes), bytes: bytes.length, mime: "video/mp4", width: 320, height: 240, durationSeconds: 1 }, provider: { id: "museum", label: "A Museum" }, item: { id: "v1", title: "Clip", landingUrl: "https://museum.example/v1", fileUrl: "https://files.example/v.mp4" }, licence: licenceFromName(licence)!, attribution: `Clip: ${licence}`, retrievedAt: new Date().toISOString(), evidence: { path: evidencePath, hash: h } };
  writeFileSync(join(dir, "assets/video/src.source.json"), JSON.stringify(record)); writeAttributions(dir);
  return { dir, record };
}

describe.skipIf(!hasFfmpeg)("local derivatives", () => {
  it("accepts start zero and preserves original bytes with a verified portable chain", async () => {
    const { dir } = await aVideo(), before = readFileSync(join(dir, "assets/video/src.mp4"));
    const got = await deriveMedia(dir, "assets/video/src.mp4", "vert", { startSeconds: 0, durationSeconds: 0.5, vertical: true });
    expect(got.record.file).toMatchObject({ width: 1080, height: 1920 });
    expect(readFileSync(join(dir, "assets/video/src.mp4")).equals(before)).toBe(true);
    const evidence = JSON.parse(readFileSync(join(dir, got.record.evidence.path), "utf-8"));
    expect(evidence.operation.kind).toBe("ffmpeg-derivative"); expect(evidence.sources[0].record.file.hash).toBe(mediaHash(before));
    const second = ws("second"), reused = await reuseLocalMedia(channel, "series/video/" + got.recordPath, second, "copy");
    rmSync(dir, { recursive: true, force: true });
    expect(checkProvenance(second)).toMatchObject({ ok: true, files: 1 });
    const rec = JSON.parse(readFileSync(join(second, reused.recordPath), "utf-8"));
    verifyMediaEvidence(rec, readFileSync(join(second, rec.evidence.path), "utf-8"));
  }, 120_000);
  it("recursively validates a chain even if the outer evidence hash has been recomputed", async () => {
    const { dir } = await aVideo();
    const one = await deriveMedia(dir, "assets/video/src.mp4", "one", { quality: lowQuality });
    const two = await deriveMedia(dir, one.path, "two", { quality: lowQuality });
    const evidence = JSON.parse(readFileSync(join(dir, two.record.evidence.path), "utf-8"));
    evidence.sources[0].evidenceText = "{}";
    const text = JSON.stringify(evidence), record = { ...two.record, evidence: { ...two.record.evidence, hash: mediaHash(text) } };
    expect(() => verifyMediaEvidence(record, text)).toThrow(/evidence hash/);
    const pinned = JSON.parse(readFileSync(join(dir, two.record.evidence.path), "utf-8"));
    pinned.sources[0].record.item.title = "changed parent";
    const altered = JSON.stringify(pinned);
    expect(() => verifyMediaEvidence({ ...two.record, evidence: { ...two.record.evidence, hash: mediaHash(altered) } }, altered)).toThrow(/parent provenance/);
  }, 120_000);
  it("refuses changed provider evidence before starting FFmpeg", async () => {
    const { dir, record } = await aVideo(); writeFileSync(join(dir, record.evidence.path), "{}");
    await expect(deriveMedia(dir, "assets/video/src.mp4", "x", {})).rejects.toThrow(/evidence hash/);
    expect(existsSync(join(dir, "assets/video/x.mp4"))).toBe(false);
  });
  it("does not treat legacy derivative metadata as verified provider evidence", async () => {
    const { dir, record } = await aVideo();
    const text = JSON.stringify({ kind: "ffmpeg-derivative", sourcePath: "../gone.mp4" }), hash = mediaHash(text);
    writeFileSync(join(dir, record.evidence.path), text);
    writeFileSync(join(dir, "assets/video/src.source.json"), JSON.stringify({ ...record, evidence: { ...record.evidence, hash } }));
    await expect(deriveMedia(dir, "assets/video/src.mp4", "x", {})).rejects.toThrow(/legacy derivation/);
    expect(checkProvenance(dir).problems.some((p) => /legacy derivation/.test(p.message))).toBe(true);
  });
  it("does not crop or trim ND media even if downloading it was explicitly allowed", async () => {
    const { dir } = await aVideo("CC BY-ND 4.0");
    await expect(deriveMedia(dir, "assets/video/src.mp4", "x", { vertical: true, policy: { allow: ["CC-BY-ND"] } })).rejects.toThrow(/ND media/);
  });
  it("cleans partial FFmpeg output so the same asset name can be retried", async () => {
    const { dir } = await aVideo(), fake = join(channel, "fail-ffmpeg");
    writeFileSync(fake, `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.argv.at(-1), 'partial'); process.exit(1);\n`); chmodSync(fake, 0o755);
    const previous = process.env.FFMPEG_PATH;
    try { process.env.FFMPEG_PATH = fake; await expect(deriveMedia(dir, "assets/video/src.mp4", "retry", { quality: lowQuality })).rejects.toThrow(/failed/); }
    finally { if (previous === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = previous; }
    expect(existsSync(join(dir, "assets/video/retry.mp4"))).toBe(false);
    expect(readdirSync(join(dir, "assets/video")).some((x) => x.startsWith(".produce"))).toBe(false);
    const got = await deriveMedia(dir, "assets/video/src.mp4", "retry", { quality: lowQuality });
    expect(got.record.file.bytes).toBeGreaterThan(0); expect(checkProvenance(dir).ok).toBe(true);
  }, 120_000);
  it("refuses collisions, invalid numbers and escaping paths", async () => {
    const { dir } = await aVideo();
    await expect(deriveMedia(dir, "assets/video/src.mp4", "src", { quality: lowQuality })).rejects.toThrow(/already exists/);
    await expect(deriveMedia(dir, "assets/video/src.mp4", "x", { startSeconds: -1 })).rejects.toThrow(/non-negative/);
    await expect(deriveMedia(dir, "assets/video/src.mp4", "x", { vertical: true, width: 101 })).rejects.toThrow(/even integer/);
    await expect(deriveMedia(dir, "../secret.mp4", "x", {})).rejects.toThrow(/canonical/);
    await expect(deriveMedia(dir, "assets/video/src.mp4", "../x", {})).rejects.toThrow(/asset name/);
  });
});

describe("async media process", () => {
  it("cancels a running child and waits for exit instead of blocking the event loop", async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 100);
    try { await expect(mediaCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], controller.signal)).rejects.toThrow(/cancelled/); }
    finally { clearTimeout(timer); }
  });
  it("kills a child that exceeds its timeout", async () => {
    await expect(mediaCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], undefined, 50)).rejects.toThrow(/exceeded 50ms/);
  });
  it("rejects before spawning for an already cancelled operation", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(mediaCommand("missing-command", [], controller.signal)).rejects.toThrow();
  });
});
