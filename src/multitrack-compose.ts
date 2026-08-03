// ---------------------------------------------------------------------------
// Clip + frame-addressed audio composition
// ---------------------------------------------------------------------------
// Composes an existing visual MP4 with approved local audio assets. The cue
// sheet is declarative and shell-free; outputs are immutable render IDs with a
// canonical output/current.json pointer and sibling report.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";

export interface AudioCue {
  id: string;
  kind: "buzz" | "foley" | "music" | "silence";
  startFrame: number;
  durationFrames: number;
  gain: number;
  purpose: string;
  assetPath?: string;
}

export interface SoundCueSheet {
  version: 1;
  episode: string;
  fps: number;
  cues: AudioCue[];
}

export interface MultitrackComposeResult {
  renderId: string;
  outputPath: string;
  reportPath: string;
  durationSeconds: number;
  fileSize: number;
  audioCueCount: number;
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export function parseSoundCueSheet(value: unknown): SoundCueSheet {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Sound cue sheet must be an object");
  const sheet = value as SoundCueSheet;
  if (sheet.version !== 1) throw new Error("Sound cue sheet version must be 1");
  if (typeof sheet.episode !== "string" || !sheet.episode.trim()) throw new Error("Sound cue sheet episode is required");
  if (!Number.isInteger(sheet.fps) || sheet.fps < 24 || sheet.fps > 60) throw new Error("Sound cue sheet fps must be from 24 to 60");
  if (!Array.isArray(sheet.cues) || sheet.cues.length > 500) throw new Error("Sound cue sheet must contain at most 500 cues");

  const ids = new Set<string>();
  for (const cue of sheet.cues) {
    if (!SAFE_ID.test(cue.id)) throw new Error(`Invalid cue id: ${cue.id}`);
    if (ids.has(cue.id)) throw new Error(`Duplicate cue id: ${cue.id}`);
    ids.add(cue.id);
    if (!["buzz", "foley", "music", "silence"].includes(cue.kind)) throw new Error(`Invalid cue kind: ${cue.kind}`);
    if (!Number.isInteger(cue.startFrame) || cue.startFrame < 0) throw new Error(`Cue ${cue.id} startFrame is invalid`);
    if (!Number.isInteger(cue.durationFrames) || cue.durationFrames < 1) throw new Error(`Cue ${cue.id} durationFrames is invalid`);
    if (!Number.isFinite(cue.gain) || cue.gain < 0 || cue.gain > 2) throw new Error(`Cue ${cue.id} gain must be from 0 to 2`);
    if (typeof cue.purpose !== "string" || !cue.purpose.trim()) throw new Error(`Cue ${cue.id} purpose is required`);
    if (cue.kind !== "silence" && (typeof cue.assetPath !== "string" || !cue.assetPath.trim())) {
      throw new Error(`Cue ${cue.id} requires assetPath`);
    }
    if (cue.assetPath && (path.isAbsolute(cue.assetPath) || cue.assetPath.includes("..") || cue.assetPath.includes("\0"))) {
      throw new Error(`Cue ${cue.id} assetPath must remain relative to the episode`);
    }
  }
  return sheet;
}

async function run(binary: string, args: string[], signal?: AbortSignal): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk).slice(0, 16_384); });
    const abort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", reject);
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) reject(new Error("Video composition cancelled"));
      else if (code === 0) resolve({ stdout });
      else reject(new Error(`${binary} exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

async function probe(filePath: string, signal?: AbortSignal): Promise<{ durationSeconds: number; fileSize: number }> {
  const result = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration,size",
    "-of", "json",
    filePath,
  ], signal);
  const parsed = JSON.parse(result.stdout) as { format?: { duration?: string; size?: string } };
  return {
    durationSeconds: Number(parsed.format?.duration ?? 0),
    fileSize: Number(parsed.format?.size ?? (await stat(filePath)).size),
  };
}

export async function composeMultitrackVideo(options: {
  episodeDir: string;
  videoPath: string;
  cueSheet: SoundCueSheet;
  label?: string;
  signal?: AbortSignal;
}): Promise<MultitrackComposeResult> {
  const episodeDir = path.resolve(options.episodeDir);
  const videoPath = path.resolve(options.videoPath);
  if (videoPath !== episodeDir && !videoPath.startsWith(`${episodeDir}${path.sep}`)) throw new Error("Video path escapes the episode workspace");
  await stat(videoPath);
  const cueSheet = parseSoundCueSheet(options.cueSheet);
  const audioCues = cueSheet.cues.filter((cue) => cue.kind !== "silence");
  const silenceCues = cueSheet.cues.filter((cue) => cue.kind === "silence");
  for (const cue of audioCues) await stat(path.join(episodeDir, cue.assetPath!));

  const label = options.label?.trim() || "wordless-short";
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(label)) throw new Error("label must be a lowercase kebab-case value of at most 40 characters");
  const digest = createHash("sha256")
    .update(JSON.stringify(cueSheet))
    .update(String((await stat(videoPath)).size))
    .digest("hex")
    .slice(0, 8);
  const renderId = `${label}-${Date.now()}-${digest}`;
  const outputDir = path.join(episodeDir, "output");
  const outputPath = path.join(outputDir, `${renderId}.mp4`);
  const reportPath = path.join(outputDir, `${renderId}.report.json`);
  await mkdir(outputDir, { recursive: true });

  const args = ["-y", "-i", videoPath];
  for (const cue of audioCues) args.push("-i", path.join(episodeDir, cue.assetPath!));

  if (audioCues.length === 0) {
    args.push(
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-map", "0:v:0", "-map", "1:a:0",
    );
  } else {
    const chains: string[] = [];
    audioCues.forEach((cue, index) => {
      const duration = cue.durationFrames / cueSheet.fps;
      const delayMs = Math.round((cue.startFrame / cueSheet.fps) * 1000);
      chains.push(`[${index + 1}:a]atrim=0:${duration.toFixed(6)},asetpts=PTS-STARTPTS,volume=${cue.gain.toFixed(4)},adelay=${delayMs}|${delayMs}[a${index}]`);
    });
    chains.push(`${audioCues.map((_, index) => `[a${index}]`).join("")}amix=inputs=${audioCues.length}:normalize=0:dropout_transition=0[mix0]`);
    silenceCues.forEach((cue, index) => {
      const start = cue.startFrame / cueSheet.fps;
      const end = (cue.startFrame + cue.durationFrames) / cueSheet.fps;
      chains.push(`[mix${index}]volume=0:enable=between(t\\,${start.toFixed(6)}\\,${end.toFixed(6)})[mix${index + 1}]`);
    });
    const finalMix = `mix${silenceCues.length}`;
    chains.push(`[${finalMix}]loudnorm=I=-14:TP=-1:LRA=11,apad[aout]`);
    args.push("-filter_complex", chains.join(";"), "-map", "0:v:0", "-map", "[aout]");
  }

  args.push(
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "48000",
    "-shortest",
    "-movflags", "+faststart",
    outputPath,
  );
  await run("ffmpeg", args, options.signal);

  const media = await probe(outputPath, options.signal);
  const report = {
    version: 1,
    renderId,
    sourceVideo: path.relative(episodeDir, videoPath),
    cueSheet,
    output: {
      path: path.relative(episodeDir, outputPath),
      durationSeconds: media.durationSeconds,
      fileSize: media.fileSize,
      videoCodec: "copy",
      audioCodec: "aac",
      targetIntegratedLoudnessLufs: -14,
      maximumTruePeakDb: -1,
    },
    createdAt: new Date().toISOString(),
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  await writeFile(path.join(outputDir, "current.json"), `${JSON.stringify({ renderId, path: `${renderId}.mp4` }, null, 2)}\n`, "utf-8");

  return {
    renderId,
    outputPath,
    reportPath,
    durationSeconds: media.durationSeconds,
    fileSize: media.fileSize,
    audioCueCount: audioCues.length,
  };
}

export async function loadSoundCueSheet(filePath: string): Promise<SoundCueSheet> {
  return parseSoundCueSheet(JSON.parse(await readFile(filePath, "utf-8")));
}
