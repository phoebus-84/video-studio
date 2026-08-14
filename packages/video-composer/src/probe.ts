// ---------------------------------------------------------------------------
// Media probe and normalization
// ---------------------------------------------------------------------------

import { runProcess } from "./process-runner.js";

export interface MediaProbe {
  path: string;
  type: "image" | "audio" | "video" | "unknown";
  format: string;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  sampleRate: number | null;
  channels: number | null;
  codec: string | null;
  fileSize: number;
  /** Whether the video can be seamlessly looped (first and last frames identical). */
  loopable: boolean | null;
  raw: Record<string, unknown> | null;
}

export interface NormalizeOptions {
  width?: number;
  height?: number;
  fps?: number;
  fit?: "cover" | "contain" | "stretch";
  audioSampleRate?: number;
}

export interface NormalizeResult {
  outputPath: string;
  changes: NormalizationChange[];
  probe: MediaProbe;
}

export interface NormalizationChange {
  field: string;
  from: string | number;
  to: string | number;
  reason: string;
}

// ── Probe ──────────────────────────────────────────────────────────────────

export async function probeMedia(
  filePath: string,
  fileSize: number,
): Promise<MediaProbe> {
  const result = await runProcess("ffprobe", [
    "-v", "quiet", "-print_format", "json",
    "-show_format", "-show_streams", filePath,
  ]);

  const empty: MediaProbe = {
    path: filePath, type: "unknown" as const, format: "unknown",
    durationSec: null, width: null, height: null, fps: null,
    sampleRate: null, channels: null, codec: null, fileSize,
    loopable: null, raw: null,
  };

  if (result.exitCode !== 0) return empty;

  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(result.stdout); } catch { return empty; }

  const streams = (raw.streams as any[]) ?? [];
  const format = raw.format as any;
  const firstStream = streams[0];

  if (!firstStream) return empty;

  const codec = firstStream.codec_name ?? null;
  let type: MediaProbe["type"] = "unknown";
  let width: number | null = null;
  let height: number | null = null;
  let fps: number | null = null;
  let sampleRate: number | null = null;
  let channels: number | null = null;

  if (firstStream.codec_type === "video") {
    type = "video";
    width = firstStream.width ?? null;
    height = firstStream.height ?? null;
  const fpsStr = String(firstStream.r_frame_rate ?? firstStream.avg_frame_rate ?? "0");
    if (fpsStr && typeof fpsStr === "string") {
      const parts = fpsStr.split("/");
      if (parts.length === 2 && parts[0] && parts[1]) {
        fps = Number(parts[0]) / Number(parts[1]);
      }
    }
  } else if (firstStream.codec_type === "audio") {
    type = "audio";
    sampleRate = firstStream.sample_rate ? Number(firstStream.sample_rate) : null;
    channels = firstStream.channels ?? null;
  } else {
    type = "image";
    width = firstStream.width ?? null;
    height = firstStream.height ?? null;
  }

  const durationSec = format?.duration ? Number(format.duration) : null;
  const formatName = format?.format_name?.split(",")[0] ?? "unknown";

  return {
    path: filePath, type, format: formatName, durationSec,
    width, height, fps, sampleRate, channels, codec, fileSize,
    loopable: type === "video" ? null : null, // Set by caller: requires frame comparison
    raw,
  };
}

// ── Normalize ──────────────────────────────────────────────────────────────

export async function normalizeMedia(
  assetPath: string,
  fileSize: number,
  outputDir: string,
  options: NormalizeOptions = {},
): Promise<NormalizeResult> {
  const probe = await probeMedia(assetPath, fileSize);
  const changes: NormalizationChange[] = [];
  const tw = options.width ?? 1920;
  const th = options.height ?? 1080;
  const tfps = options.fps ?? 30;
  const tsr = options.audioSampleRate ?? 48000;

  if (probe.type === "unknown") {
    return { outputPath: assetPath, changes, probe };
  }

  let needs = false;
  if ((probe.type === "image" || probe.type === "video") && (probe.width !== tw || probe.height !== th)) needs = true;
  if (probe.type === "video" && probe.fps !== tfps) needs = true;
  if (probe.type === "audio" && probe.sampleRate !== tsr) needs = true;
  if (!needs) return { outputPath: assetPath, changes, probe };

  const ext = probe.format === "unknown" ? "mp4" : probe.format;
  const outPath = `${outputDir}/normalized-${Date.now()}.${ext}`;
  const args: string[] = [];

  if (probe.type === "image" || probe.type === "video") {
    args.push("-i", assetPath);
    if (probe.width !== tw || probe.height !== th) {
      args.push("-vf", `scale=${tw}:${th}:force_original_aspect_ratio=increase,crop=${tw}:${th}`);
    }
    if (probe.type === "video" && probe.fps !== tfps) {
      const vi = args.indexOf("-vf");
      if (vi >= 0) args[vi + 1] += `,fps=${tfps}`;
      else { args.push("-vf", `fps=${tfps}`); }
    }
  } else if (probe.type === "audio") {
    args.push("-i", assetPath, "-ar", String(tsr));
  }

  args.push("-y", outPath);
  await runProcess("ffmpeg", args);

  if (probe.width !== tw) changes.push({ field: "width", from: probe.width!, to: tw, reason: "target" });
  if (probe.height !== th) changes.push({ field: "height", from: probe.height!, to: th, reason: "target" });
  if (probe.fps !== tfps) changes.push({ field: "fps", from: probe.fps!, to: tfps, reason: "target" });
  if (probe.sampleRate !== tsr) changes.push({ field: "sampleRate", from: probe.sampleRate!, to: tsr, reason: "target" });

  const normProbe = await probeMedia(outPath, 0);
  return { outputPath: outPath, changes, probe: normProbe };
}
