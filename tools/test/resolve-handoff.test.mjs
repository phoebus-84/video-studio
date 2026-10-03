import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, realpath, symlink, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { buildResolveHandoff, RESOLVE_MCP_URL } from "@studio/agent/src/resolve-handoff.mjs";

const cli = resolve(import.meta.dirname, "../../studio/agent/src/resolve-handoff.mjs");
const video = { streams: [{ codec_type: "video", avg_frame_rate: "24/1", nb_frames: "240", duration: "10" }], format: { duration: "10" } };
const audio = { streams: [{ codec_type: "audio", duration: "4", sample_rate: "48000", channels: 1 }], format: { duration: "4" } };
const probeMedia = async path => path.endsWith(".wav") ? audio : video;
function manifest() {
  return { schemaVersion: 1, project: { name: "Example project", mode: "existing", fps: 24, width: 1920, height: 1080 },
    assets: [{ id: "picture", path: "picture.mp4", kind: "video", bin: ["Revision 4", "Final"] }, { id: "voice", path: "voice.wav", kind: "audio", bin: ["Narration V005", "Takes"] }],
    timelines: [{ name: "V004 - Narration review", tracks: [{ type: "video", index: 1, name: "Picture" }, { type: "audio", index: 1, name: "Narration", audioType: "mono" }], items: [
      { assetId: "picture", sourceInFrame: 0, sourceOutFrame: 240, recordFrame: 0, trackType: "video", trackIndex: 1 },
      { assetId: "voice", sourceInFrame: 0, sourceOutFrame: 96, recordFrame: 24, trackType: "audio", trackIndex: 1 },
    ] }] };
}
async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), "resolve-handoff-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, "media"); await mkdir(root);
  await writeFile(join(root, "picture.mp4"), "fake picture");
  await writeFile(join(root, "voice.wav"), "fake voice");
  return { base, root, options: { mediaRoot: root, probeMedia } };
}
test("preflight is deterministic, hashed, bounded and does not mutate sources", async t => {
  const { root, options } = await fixture(t), input = manifest();
  const before = structuredClone(input);
  const plan = await buildResolveHandoff(input, options);
  assert.deepEqual(input, before);
  assert.deepEqual(plan, await buildResolveHandoff(input, options));
  assert.equal(plan.status, "planned-not-imported");
  assert.equal(plan.integration, RESOLVE_MCP_URL);
  assert.match(plan.assets[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(plan.assets[1].frames, 96);
  assert.equal(plan.assets[1].streams[0].sample_rate, "48000");
  assert.equal(plan.assets[1].streams[0].channels, 1);
  assert.deepEqual(plan.folders, ["Master/Narration V005", "Master/Revision 4", "Master/Timelines", "Master/Narration V005/Takes", "Master/Revision 4/Final"]);
  const timeline = plan.timelines[0];
  assert.equal(timeline.ifExists, "fail");
  assert.equal(timeline.expectedDurationFrames, 240);
  assert.deepEqual(timeline.appendBatches[0][1].clipInfo, { startFrame: 0, endFrame: 96, recordFrame: 24, recordFrameMode: "relative", trackIndex: 1, mediaType: 2 });
  assert.equal(await readFile(join(root, "voice.wav"), "utf8"), "fake voice");
});
test("media changing during probe/hash is rejected instead of yielding a stale plan", async t => {
  const { options } = await fixture(t);
  const changingProbe = async path => { await writeFile(path, "changed while probing"); return probeMedia(path); };
  await assert.rejects(buildResolveHandoff(manifest(), { ...options, probeMedia: changingProbe }), /media changed during preflight/);
});

test("half-open source ranges: 24..48 has exactly 24 frames", async t => {
  const { options } = await fixture(t), input = manifest();
  input.timelines[0].items[1].sourceInFrame = 24; input.timelines[0].items[1].sourceOutFrame = 48;
  assert.equal((await buildResolveHandoff(input, options)).timelines[0].appendBatches[0][1].durationFrames, 24);
});
test("media-root symlinks are supported but media symlink escapes are refused", async t => {
  const { base, root, options } = await fixture(t);
  await symlink(root, join(base, "episode"), "dir");
  assert.equal((await buildResolveHandoff(manifest(), { ...options, mediaRoot: join(base, "episode") })).mediaRoot, await realpath(root));
  await writeFile(join(base, "outside.wav"), "private"); await symlink(join(base, "outside.wav"), join(root, "escape.wav"));
  const input = manifest(); input.assets[1].path = "escape.wav";
  await assert.rejects(buildResolveHandoff(input, options), /escapes mediaRoot/);
});
test("absolute, traversal and Windows paths are rejected", async t => {
  const { root, options } = await fixture(t);
  for (const path of [join(root, "voice.wav"), "../outside.wav", "C:\\outside.wav", "C:/outside.wav", "C:voice.wav", "./voice.wav", "nested//voice.wav"]) {
    const input = manifest(); input.assets[1].path = path;
    await assert.rejects(buildResolveHandoff(input, options), /relative slash-separated path/);
  }
});
test("missing/empty media, duplicate identities and ambiguous bins fail closed", async t => {
  const { root, options } = await fixture(t);
  const bad = manifest(); bad.assets[1].path = "missing.wav";
  await assert.rejects(buildResolveHandoff(bad, options), /ENOENT/);
  await writeFile(join(root, "empty.wav"), ""); bad.assets[1].path = "empty.wav";
  await assert.rejects(buildResolveHandoff(bad, options), /nonempty regular file/);
  for (const mutate of [
    m => { m.assets[1].id = "picture"; },
    m => { m.assets[1].path = "picture.mp4"; },
    m => { m.assets[1].bin = ["../Audio"]; },
  ]) {
    const input = manifest(); mutate(input); await assert.rejects(buildResolveHandoff(input, options));
  }
  await mkdir(join(root, "other")); await writeFile(join(root, "other", "picture.mp4"), "another picture");
  const input = manifest(); input.assets.push({ ...input.assets[0], id: "other", path: "other/picture.mp4" });
  await assert.rejects(buildResolveHandoff(input, options), /ambiguous filename/);
});
test("FPS mismatch, unavailable probe and missing streams fail closed", async t => {
  const { options } = await fixture(t);
  await assert.rejects(buildResolveHandoff(manifest(), { ...options, probeMedia: async () => ({ streams: [{ ...video.streams[0], avg_frame_rate: "30000/1001" }] }) }), /does not match project FPS/);
  await assert.rejects(buildResolveHandoff(manifest(), { ...options, probeMedia: async () => { throw new Error("ffprobe missing"); } }), /ffprobe missing/);
  await assert.rejects(buildResolveHandoff(manifest(), { ...options, probeMedia: async () => video }), /no audio stream/);
});
test("audio ranges never silently round up fractional frames", async t => {
  const { options } = await fixture(t);
  const probe = async p => p.endsWith(".wav") ? { streams: [{ codec_type: "audio", duration: "3.73" }] } : video;
  const input = manifest(); input.timelines[0].items[1].sourceOutFrame = 90;
  await assert.rejects(buildResolveHandoff(input, { ...options, probeMedia: probe }), /89 frames/);
  input.timelines[0].items[1].sourceOutFrame = 89;
  assert.equal((await buildResolveHandoff(input, { ...options, probeMedia: probe })).assets[1].frames, 89);
});
test("unknown fields, invalid ranges, wrong tracks and overlapping speech are rejected", async t => {
  const { options } = await fixture(t);
  for (const mutate of [
    m => { m.schemaVersion = 2; },
    m => { m.project.fps = 23.976; },
    m => { m.project.frameRate = 24; },
    m => { m.timelines[0].items[1].sourceOutFrame = 97; },
    m => { m.timelines[0].items[1].sourceInFrame = 96; },
    m => { m.timelines[0].items[1].recordFrame = -1; },
    m => { m.timelines[0].items[1].assetId = "unknown"; },
    m => { m.timelines[0].items[1].trackIndex = 2; },
    m => { m.timelines[0].items[1].trackType = "video"; },
    m => { m.timelines[0].tracks[1].audioType = "surround"; },
    m => { m.timelines[0].tracks.push({ ...m.timelines[0].tracks[1] }); },
    m => { m.timelines.push(structuredClone(m.timelines[0])); },
    m => { m.timelines[0].items.push({ ...m.timelines[0].items[1], recordFrame: 25 }); },
  ]) {
    const input = manifest(); mutate(input); await assert.rejects(buildResolveHandoff(input, options));
  }
});
test("stills are imported individually; AV masters have explicit mediaType selectors", async t => {
  const { root, options } = await fixture(t), input = manifest();
  for (const id of ["s01", "s02"]) { await writeFile(join(root, id + ".png"), "fake image"); input.assets.push({ id, path: id + ".png", kind: "still", bin: ["Stills"] }); }
  const plan = await buildResolveHandoff(input, options);
  assert.deepEqual(plan.imports.filter(i => i.binPath.endsWith("Stills")).map(i => i.assetIds), [["s01"], ["s02"]]);
  input.assets[0].kind = "video-audio";
  input.timelines[0].items[1].assetId = "picture";
  const avProbe = async p => p.endsWith(".wav") ? audio : ({ streams: [...video.streams, ...audio.streams] });
  assert.equal((await buildResolveHandoff(input, { ...options, probeMedia: avProbe })).timelines[0].appendBatches[0][1].clipInfo.mediaType, 2);
});
test("A/V audio bounds are checked independently from picture duration", async t => {
  const { options } = await fixture(t), input = manifest();
  input.assets[0].kind = "video-audio";
  input.timelines[0].items[1].assetId = "picture";
  input.timelines[0].items[1].sourceOutFrame = 240;
  const probe = async p => p.endsWith(".wav") ? audio : { streams: [...video.streams, ...audio.streams] };
  await assert.rejects(buildResolveHandoff(input, { ...options, probeMedia: probe }), /96 frames/);
  input.timelines[0].items[1].sourceOutFrame = 96;
  const plan = await buildResolveHandoff(input, { ...options, probeMedia: probe });
  assert.equal(plan.assets[0].audioFrames, 96);
  const missingDuration = async p => p.endsWith(".wav") ? audio : { streams: [...video.streams, { codec_type: "audio" }], format: { duration: "10" } };
  await assert.rejects(buildResolveHandoff(input, { ...options, probeMedia: missingDuration }), /no trustworthy positive media duration/);
});

test("subtitle/still assets are import-only and malformed subtitle media is rejected", async t => {
  const { root, options } = await fixture(t), input = manifest();
  await writeFile(join(root, "captions.srt"), "1\n00:00:00,000 --> 00:00:01,000\nHello\n");
  input.assets.push({ id: "captions", path: "captions.srt", kind: "subtitle", bin: ["Subtitles"] });
  const probe = async p => p.endsWith(".srt") ? { streams: [{ codec_type: "subtitle" }] } : probeMedia(p);
  const plan = await buildResolveHandoff(input, { ...options, probeMedia: probe });
  assert.equal(plan.assets[2].frames, null);
  await assert.rejects(buildResolveHandoff(input, options), /no subtitle stream/);
  input.timelines[0].items[1].assetId = "captions";
  await assert.rejects(buildResolveHandoff(input, { ...options, probeMedia: probe }), /import-only/);
});
test("documented example produces two explicit review/master timelines", async t => {
  const { root } = await fixture(t);
  const example = JSON.parse(await readFile(new URL("../../docs/public/resolve-handoff.example.json", import.meta.url), "utf8"));
  for (const asset of example.assets) { const file = join(root, asset.path); await mkdir(resolve(file, ".."), { recursive: true }); await writeFile(file, "fake media " + asset.id); }
  const probe = async path => path.endsWith("closing.wav") ? audio : path.endsWith("music.wav") ? { streams: [{ codec_type: "audio", duration: "30" }] } : { streams: [{ ...video.streams[0], nb_frames: "720", duration: "30" }, { ...audio.streams[0], duration: "30" }] };
  const plan = await buildResolveHandoff(example, { mediaRoot: root, probeMedia: probe });
  assert.deepEqual(plan.timelines.map(t => t.expectedDurationFrames), [720, 720]);
  assert.deepEqual(plan.timelines[1].appendBatches.flat().map(i => i.clipInfo.mediaType), [1, 2]);
});

test("large assemblies are chunked without dropping items", async t => {
  const { options } = await fixture(t), input = manifest();
  input.timelines[0].items = Array.from({ length: 128 }, (_, n) => ({ ...input.timelines[0].items[0], sourceOutFrame: 24, recordFrame: n * 24 }));
  const plan = await buildResolveHandoff(input, options), timeline = plan.timelines[0];
  assert.equal(timeline.appendBatches.flat().length, 128);
  assert.ok(timeline.appendBatches.every(b => b.length <= 3));
  assert.equal(timeline.expectedDurationFrames, 3072);
});
test("cancelled preflight cannot produce a successful plan", async t => {
  const { options } = await fixture(t);
  await assert.rejects(buildResolveHandoff(manifest(), { ...options, signal: AbortSignal.abort(new Error("cancelled")) }), /cancelled/);
});
test("in-flight cancellation reaches the probe instead of reporting success", async t => {
  const { options } = await fixture(t), controller = new AbortController();
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const probe = async (_path, { signal }) => { started(); return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })); };
  const pending = buildResolveHandoff(manifest(), { ...options, probeMedia: probe, signal: controller.signal });
  await ready; controller.abort(new Error("cancelled in flight"));
  await assert.rejects(pending, /cancelled in flight/);
});

test("CLI has no Resolve dependency, honours FFPROBE_BIN and refuses output overwrites", async t => {
  const { base, root } = await fixture(t);
  const file = join(base, "manifest.json"), output = join(base, "plan.json");
  await writeFile(file, JSON.stringify(manifest()));
  const fakeProbe = join(base, "probe.cjs");
  await writeFile(fakeProbe, `#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.at(-1).endsWith('.wav') ? ${JSON.stringify(audio)} : ${JSON.stringify(video)}));\n`, { mode: 0o755 });
  const args = [cli, "--manifest", file, "--media-root", root, "--out", output];
  const env = { ...process.env, FFPROBE_BIN: fakeProbe };
  const run = spawnSync(process.execPath, args, { encoding: "utf8", env });
  assert.equal(run.status, 0, run.stderr);
  const before = await readFile(output, "utf8"); assert.equal(JSON.parse(before).status, "planned-not-imported");
  const again = spawnSync(process.execPath, args, { encoding: "utf8", env });
  assert.equal(again.status, 1); assert.match(again.stderr, /EEXIST/); assert.equal(await readFile(output, "utf8"), before);
  const missing = spawnSync(process.execPath, [cli, "--manifest", file, "--media-root", root], { encoding: "utf8", env: { ...env, FFPROBE_BIN: join(base, "absent") } });
  assert.equal(missing.status, 1); assert.match(missing.stderr, /ENOENT/);
  const invalid = spawnSync(process.execPath, [cli, "--manifest", file, "--manifest", file], { encoding: "utf8" });
  assert.equal(invalid.status, 1); assert.match(invalid.stderr, /duplicate argument/);
});
