#!/usr/bin/env node
/** Offline studio-to-editor preflight. Live Resolve control stays in upstream MCP. */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath, stat, mkdir, writeFile, link, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, relative, sep, isAbsolute, win32, basename, dirname } from "node:path";
import { pathToFileURL } from "node:url";

export const RESOLVE_MCP_URL = "https://github.com/samuelgursky/davinci-resolve-mcp";
const exec = promisify(execFile);
const fail = (message) => { throw new Error(message); };
function object(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${label}: unknown field ${key}`);
}
function text(value, label, folder = false) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 128 || /[\x00-\x1f\x7f]/.test(value)) fail(`${label} must be a nonblank label without control characters (max 128)`);
  if (folder && (/[\\/]/.test(value) || value === "." || value === "..")) fail(`${label} must be a single folder name`);
  return value;
}
function integer(value, label, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label} must be an integer in ${min}..${max}`);
  return value;
}
function array(value, label, nonempty = true) {
  if (!Array.isArray(value) || (nonempty && !value.length)) fail(`${label} must be ${nonempty ? "a nonempty" : "an"} array`);
  return value;
}
function within(root, path) {
  const part = relative(root, path);
  return part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}
function chunks(rows, size = 3) {
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));
}
async function checksum(path, signal) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  return hash.digest("hex");
}
export async function probeResolveMedia(path, { signal } = {}) {
  const { stdout } = await exec(process.env.FFPROBE_BIN || "ffprobe", [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", path,
  ], { timeout: 30_000, maxBuffer: 1024 * 1024, signal });
  return JSON.parse(stdout);
}
function durationFrames(value, fps, label) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) fail(`${label}: no trustworthy positive media duration`);
  return integer(Math.floor(seconds * fps + 0.0001), `${label} playable frames`, 1);
}
function mediaFrames(probe, kind, fps, label) {
  const streams = array(probe?.streams, `${label} probe.streams`);
  const video = streams.find(s => s?.codec_type === "video");
  const audio = streams.find(s => s?.codec_type === "audio");
  if (kind === "subtitle") {
    if (!streams.some(s => s?.codec_type === "subtitle")) fail(`${label}: no subtitle stream`);
    return null;
  }
  if (kind === "audio" && video && audio) fail(`${label}: A/V media must use video-audio, not audio`);
  if ((kind === "video" || kind === "video-audio" || kind === "still") && !video) fail(`${label}: no video/image stream`);
  if ((kind === "audio" || kind === "video-audio") && !audio) fail(`${label}: no audio stream`);
  if (kind === "still") return null; // Import only; Resolve's still duration is a host setting.
  if (video && kind !== "audio") {
    const rate = String(video.avg_frame_rate || video.r_frame_rate).split("/").map(Number);
    const sourceFps = rate.length === 2 ? rate[0] / rate[1] : rate[0];
    if (!Number.isFinite(sourceFps) || Math.abs(sourceFps - fps) > 0.001) fail(`${label}: source FPS ${sourceFps} does not match project FPS ${fps}; conform explicitly first`);
    const frames = Number(video.nb_frames);
    if (Number.isSafeInteger(frames) && frames > 0) return frames;
  }
  const stream = kind === "audio" ? audio : video;
  // Conservative whole-frame range. We never round up and silently cut a syllable.
  return durationFrames(stream?.duration ?? probe?.format?.duration, fps, label);
}

/** No network, MCP calls, project edits, directory scanning or canonical promotion. */
export async function buildResolveHandoff(manifest, { mediaRoot, probeMedia = probeResolveMedia, signal } = {}) {
  object(manifest, ["schemaVersion", "project", "assets", "timelines"], "manifest");
  if (manifest.schemaVersion !== 1) fail("schemaVersion must be 1");
  object(manifest.project, ["name", "mode", "fps", "width", "height"], "project");
  const project = {
    name: text(manifest.project.name, "project.name"),
    mode: manifest.project.mode,
    fps: integer(manifest.project.fps, "project.fps", 1, 120),
    width: integer(manifest.project.width, "project.width", 16, 7680),
    height: integer(manifest.project.height, "project.height", 16, 7680),
  };
  if (!["new", "existing"].includes(project.mode)) fail("project.mode must be new or existing");
  if (typeof mediaRoot !== "string" || !mediaRoot) fail("An explicit mediaRoot is required");
  const root = await realpath(mediaRoot);
  if (!(await stat(root)).isDirectory()) fail("mediaRoot must be a directory");
  const assets = [], ids = new Map(), paths = new Set(), binNames = new Set(), folders = new Set();
  for (const [index, input] of array(manifest.assets, "assets").entries()) {
    signal?.throwIfAborted();
    const label = `assets[${index}]`;
    object(input, ["id", "path", "kind", "bin"], label);
    const id = text(input.id, `${label}.id`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || ids.has(id)) fail(`${label}: invalid or duplicate asset id ${id}`);
    const path = input.path;
    if (typeof path !== "string" || !path || /[\x00-\x1f\x7f\\]/.test(path) || isAbsolute(path) || win32.isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.split("/").some(p => !p || p === ".." || p === ".")) fail(`${label}.path must be a clean relative slash-separated path`);
    const filePath = await realpath(resolve(root, path));
    if (!within(root, filePath)) fail(`${label}: symlink escapes mediaRoot`);
    const info = await stat(filePath);
    if (!info.isFile() || info.size === 0) fail(`${label}: media must be a nonempty regular file`);
    if (paths.has(filePath)) fail(`${label}: same physical media referenced twice; reuse its asset id`);
    paths.add(filePath);
    if (!["video", "video-audio", "audio", "still", "subtitle"].includes(input.kind)) fail(`${label}: unsupported kind ${input.kind}`);
    const bin = array(input.bin, `${label}.bin`, false).map((name, i) => text(name, `${label}.bin[${i}]`, true));
    const binPath = ["Master", ...bin].join("/");
    const nameKey = `${binPath}\0${basename(filePath)}`;
    if (binNames.has(nameKey)) fail(`${label}: ambiguous filename in bin ${binPath}`);
    binNames.add(nameKey);
    for (let i = 1; i <= bin.length; i++) folders.add(["Master", ...bin.slice(0, i)].join("/"));
    const probe = await probeMedia(filePath, { signal });
    const frames = mediaFrames(probe, input.kind, project.fps, label);
    // An A/V clip can have a shorter audio stream than picture. Do not approve
    // a speech range merely because its video stream is long enough.
    const audioFrames = input.kind === "video-audio"
      ? durationFrames(probe.streams.find(s => s?.codec_type === "audio")?.duration, project.fps, `${label} audio`)
      : input.kind === "audio" ? frames : null;
    const streams = probe.streams.map(stream => Object.fromEntries(
      ["codec_type", "codec_name", "sample_rate", "channels", "width", "height", "avg_frame_rate"]
        .filter(key => stream?.[key] !== undefined).map(key => [key, stream[key]]),
    ));
    const sha256 = await checksum(filePath, signal);
    const after = await stat(filePath);
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ino !== info.ino) fail(`${label}: media changed during preflight; finish rendering and replan`);
    const asset = { id, path, filePath, binPath, kind: input.kind, frames, audioFrames, streams, bytes: info.size, sha256 };
    assets.push(asset); ids.set(id, asset);
  }
  const names = new Set();
  const timelines = array(manifest.timelines, "timelines").map((input, index) => {
    const label = `timelines[${index}]`;
    object(input, ["name", "tracks", "items"], label);
    const name = text(input.name, `${label}.name`);
    if (names.has(name)) fail(`${label}: duplicate timeline name`);
    names.add(name);
    const tracks = array(input.tracks, `${label}.tracks`).map((track, i) => {
      object(track, ["type", "index", "name", "audioType"], `${label}.tracks[${i}]`);
      if (!["video", "audio"].includes(track.type)) fail(`${label}: only video/audio tracks are supported`);
      integer(track.index, `${label}.track index`, 1, 128);
      text(track.name, `${label}.track name`);
      if (track.type === "audio" && !["mono", "stereo"].includes(track.audioType)) fail(`${label}: audioType must be mono or stereo`);
      if (track.type === "video" && track.audioType !== undefined) fail(`${label}: video track cannot have audioType`);
      return { ...track };
    });
    const trackMap = new Map();
    for (const track of tracks) {
      const key = `${track.type}:${track.index}`;
      if (trackMap.has(key)) fail(`${label}: duplicate track ${key}`);
      trackMap.set(key, track);
    }
    for (const type of ["video", "audio"]) {
      const indexes = tracks.filter(t => t.type === type).map(t => t.index).sort((a, b) => a - b);
      if (indexes.some((n, i) => n !== i + 1)) fail(`${label}: ${type} track indexes must be contiguous from 1`);
    }
    const items = array(input.items, `${label}.items`).map((item, i) => {
      object(item, ["assetId", "sourceInFrame", "sourceOutFrame", "recordFrame", "trackType", "trackIndex"], `${label}.items[${i}]`);
      const asset = ids.get(item.assetId);
      if (!asset) fail(`${label}: unknown asset ${item.assetId}`);
      if (!trackMap.has(`${item.trackType}:${item.trackIndex}`)) fail(`${label}: undeclared target track`);
      const allowed = item.trackType === "video" ? ["video", "video-audio"] : ["audio", "video-audio"];
      if (!allowed.includes(asset.kind)) fail(`${label}: ${asset.kind} cannot be placed on ${item.trackType}; stills/subtitles are import-only`);
      const startFrame = integer(item.sourceInFrame, `${label}.sourceInFrame`);
      const endFrame = integer(item.sourceOutFrame, `${label}.sourceOutFrame`, 1);
      const recordFrame = integer(item.recordFrame, `${label}.recordFrame`);
      const availableFrames = item.trackType === "audio" ? asset.audioFrames : asset.frames;
      if (endFrame <= startFrame || endFrame > availableFrames) fail(`${label}: source range is empty/reversed or exceeds measured media (${availableFrames} frames)`);
      const duration = endFrame - startFrame;
      integer(recordFrame + duration, `${label} record end`);
      return { assetId: asset.id, durationFrames: duration, clipInfo: {
        startFrame, endFrame, recordFrame, recordFrameMode: "relative",
        trackIndex: item.trackIndex, mediaType: item.trackType === "video" ? 1 : 2,
      } };
    });
    for (const track of tracks) {
      const rows = items.filter(i => i.clipInfo.mediaType === (track.type === "video" ? 1 : 2) && i.clipInfo.trackIndex === track.index).sort((a, b) => a.clipInfo.recordFrame - b.clipInfo.recordFrame);
      let end = 0;
      for (const row of rows) {
        if (row.clipInfo.recordFrame < end) fail(`${label}: overlapping clips on ${track.type}:${track.index}; use separate tracks`);
        end = row.clipInfo.recordFrame + row.durationFrames;
      }
    }
    return { name, ifExists: "fail", tracks, expectedDurationFrames: Math.max(...items.map(i => i.clipInfo.recordFrame + i.durationFrames)), expectedItems: items.length, appendBatches: chunks(items) };
  });
  const imports = [];
  for (const binPath of new Set(assets.map(a => a.binPath))) {
    const rows = assets.filter(a => a.binPath === binPath);
    for (const batch of chunks(rows.filter(a => a.kind !== "still"))) imports.push({ binPath, assetIds: batch.map(a => a.id) });
    // Single-file image imports avoid accidental image-sequence grouping.
    for (const row of rows.filter(a => a.kind === "still")) imports.push({ binPath, assetIds: [row.id] });
  }
  return { schemaVersion: 1, integration: RESOLVE_MCP_URL, status: "planned-not-imported", mediaRoot: root, project,
    timelineBin: "Master/Timelines", folders: [...new Set([...folders, "Master/Timelines"])].sort((a, b) => a.split("/").length - b.split("/").length || (a < b ? -1 : a > b ? 1 : 0)),
    assets, imports, timelines, warnings: [
      "Offline preflight only: Resolve/MCP availability, authorization and live readback are still required.",
      "Resolve frame-range semantics vary by build. Check exclusive endFrame behavior on the installed host before applying the plan.",
      "Still images and subtitle files are import-only; no editable text/animation/source reconstruction is promised.",
      "No speech retiming or automatic cue placement. Explicit timing may require editorial review.",
    ] };
}

async function main() {
  const args = process.argv.slice(2), values = {};
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: node studio/agent/src/resolve-handoff.mjs --manifest <json> --media-root <directory> [--out <new-json>]\nOffline preflight only; requires ffprobe (or FFPROBE_BIN). Does not control Resolve.");
    return;
  }
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!["--manifest", "--media-root", "--out"].includes(key) || values[key] || !args[i + 1] || args[i + 1].startsWith("--")) fail(`Invalid or duplicate argument: ${key}`);
    values[key] = args[i + 1];
  }
  if (!values["--manifest"] || !values["--media-root"]) fail("--manifest and --media-root are required; use --help");
  const controller = new AbortController();
  const abort = () => controller.abort(new Error("Handoff cancelled"));
  process.once("SIGINT", abort); process.once("SIGTERM", abort);
  try {
    const manifest = JSON.parse(await readFile(resolve(values["--manifest"]), "utf8"));
    const plan = await buildResolveHandoff(manifest, { mediaRoot: resolve(values["--media-root"]), signal: controller.signal });
    controller.signal.throwIfAborted();
    const output = JSON.stringify(plan, null, 2) + "\n";
    if (values["--out"]) {
      const path = resolve(values["--out"]);
      await mkdir(dirname(path), { recursive: true });
      // Publish a complete file atomically, without replacing any existing
      // artifact. A failed/aborted write cannot leave a truncated final plan.
      const temporary = resolve(dirname(path), `.resolve-handoff-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, output, { flag: "wx", signal: controller.signal });
        controller.signal.throwIfAborted();
        await link(temporary, path);
      } finally { await rm(temporary, { force: true }); }
      console.log(`Planned ${plan.assets.length} assets / ${plan.timelines.length} timelines: ${path}`);
    } else process.stdout.write(output);
  } finally {
    process.removeListener("SIGINT", abort); process.removeListener("SIGTERM", abort);
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(`Resolve handoff: ${error.message}`); process.exitCode = 1; });
}
