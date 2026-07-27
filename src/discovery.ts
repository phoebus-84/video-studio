/**
 * FFmpeg/ffprobe discovery and version parsing.
 *
 * Searches PATH for ffmpeg, then finds ffprobe alongside it.
 * Parses `ffmpeg -version`, `ffmpeg -codecs`, and `ffmpeg -filters`.
 */

import { join, normalize } from "node:path";
import { getSpawn } from "./process-factory.js";
import type {
  CodecCapability,
  CodecEntry,
  FfmpegInfo,
  FfmpegParsedVersion,
  FilterEntry,
  ProcessOptions,
} from "./types.js";
import { FfmpegNotFoundError } from "./types.js";
import { runProcess } from "./process-runner.js";

const FFMPEG_BIN = process.platform === "win32" ? "ffmpeg.EXE" : "ffmpeg";
const FFPROBE_BIN = process.platform === "win32" ? "ffprobe.EXE" : "ffprobe";

/**
 * Discover ffmpeg (and sibling ffprobe) by searching PATH.
 * Returns null if not found.
 */
export async function discoverFfmpeg(): Promise<FfmpegInfo | null> {
  const ffmpegPath = await findOnPath(FFMPEG_BIN);
  if (!ffmpegPath) return null;

  const dir = normalize(join(ffmpegPath, ".."));
  const ffprobePath = join(dir, FFPROBE_BIN);

  return buildFfmpegInfo(ffmpegPath, ffprobePath);
}

/**
 * Discover ffmpeg or throw.
 */
export async function discoverFfmpegOrThrow(): Promise<FfmpegInfo> {
  const info = await discoverFfmpeg();
  if (!info) throw new FfmpegNotFoundError();
  return info;
}

/**
 * Build FfmpegInfo from known binary paths.
 * Calls ffmpeg -version, -codecs, and -filters.
 */
export async function buildFfmpegInfo(
  ffmpegPath: string,
  ffprobePath: string,
): Promise<FfmpegInfo> {
  const processOpts: ProcessOptions = { captureStderr: true };

  const [versionRaw, codecsRaw, filtersRaw] = await Promise.all([
    runProcess(ffmpegPath, ["-version"], processOpts),
    runProcess(ffmpegPath, ["-codecs"], processOpts),
    runProcess(ffmpegPath, ["-filters"], processOpts),
  ]);

  const version = versionRaw.stdout.trim();
  const parsed = parseVersion(version);

  return {
    path: ffmpegPath,
    ffprobePath,
    version,
    parsed,
    codecs: parseCodecs(codecsRaw.stdout),
    filters: parseFilters(filtersRaw.stdout),
  };
}

/**
 * Parse `ffmpeg -version` output into semver components.
 */
export function parseVersion(raw: string): FfmpegParsedVersion | null {
  const m = raw.match(/ffmpeg version\s+(\d+)\.(\d+)(?:\.(\d+))?/i);
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: m[3] ? parseInt(m[3], 10) : 0,
    raw: m[0],
  };
}

/**
 * Parse `ffmpeg -codecs` output.
 * Format: " D.VIL. vp9              Google VP9 (decoders: vp9 ...)"
 * Leading flags: D=decode, E=encode, V=video, A=audio, S=subtitle, D=data,
 *                I=intra-only, L=lossy, S=lossless (context-dependent)
 */
export function parseCodecs(raw: string): CodecEntry[] {
  const lines = raw.split("\n");
  // Header line ends with "-------"
  let headerSeen = false;
  const codecs: CodecEntry[] = [];

  for (const line of lines) {
    if (!headerSeen) {
      if (/^[\s]*-------/.test(line)) {
        headerSeen = true;
      }
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const entry = parseCodecLine(trimmed);
    if (entry) codecs.push(entry);
  }
  return codecs;
}

function parseCodecLine(line: string): CodecEntry | null {
  // Format from ffmpeg -codecs:
  // " DEV.LS h264  H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10"
  // 6 flag characters: decode, encode, type, intra, lossy, lossless
  // Each flag is a letter or '.'
  const m = line.match(
    /^\s*([ D.])([ E.])([VASD.])([ I.])([ L.])([ S.])\s+(\S+)\s+(.+)$/,
  );
  if (!m) return null;

  const [, decodeFlag, encodeFlag, typeFlag, intraFlag, lossyFlag, losslessFlag, name, description] = m;

  const capabilities: CodecCapability[] = [];
  if (decodeFlag === "D") capabilities.push("decode");
  if (encodeFlag === "E") capabilities.push("encode");
  if (intraFlag === "I") capabilities.push("intra");
  if (lossyFlag === "L") capabilities.push("lossy");
  if (losslessFlag === "S") capabilities.push("lossless");

  let type: CodecEntry["type"] = "unknown";
  switch (typeFlag) {
    case "V": type = "video"; break;
    case "A": type = "audio"; break;
    case "S": type = "subtitle"; break;
    case "D": type = "data"; break;
  }

  return {
    name,
    description: description.trim(),
    type,
    capabilities,
  };
}

/**
 * Parse `ffmpeg -filters` output.
 * Format: "... TSC overlay          Overlay a video on top of another"
 * Leading flags: T=timeline, S=slice, C=command
 */
export function parseFilters(raw: string): FilterEntry[] {
  const lines = raw.split("\n");
  let headerSeen = false;
  const filters: FilterEntry[] = [];

  for (const line of lines) {
    if (!headerSeen) {
      if (/^[\s]*-------/.test(line)) {
        headerSeen = true;
      }
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const entry = parseFilterLine(trimmed);
    if (entry) filters.push(entry);
  }
  return filters;
}

function parseFilterLine(line: string): FilterEntry | null {
  // Format from ffmpeg -filters:
  // " T.. scale           V->V       Scale the input video."
  // "TSC overlay          VV->V      Overlay a video on top of another."
  // 3 flag positions: timeline(T), slice(S), command(C), or '.'/space
  const m = line.match(/^\s*([ T.])([ S.])([ C.])\s+(\S+)\s+\S+\s+(.+)$/);
  if (!m) return null;

  const [, tFlag, sFlag, cFlag, name, description] = m;
  return {
    name,
    description: description.trim(),
    timeline: tFlag === "T",
    slice: sFlag === "S",
    command: cFlag === "C",
  };
}

/**
 * Search for a binary on PATH using `which`/`where` semantics.
 * Returns absolute path or null.
 */
async function findOnPath(bin: string): Promise<string | null> {
  // On all platforms, `command -v` gives the path
  const result = await tryRun(
    process.platform === "win32" ? "cmd" : "/bin/sh",
    process.platform === "win32"
      ? ["/c", `where ${bin}`]
      : ["-c", `command -v ${bin}`],
  );
  if (!result) return null;

  const firstLine = result.trim().split("\n")[0].trim();
  if (!firstLine || firstLine.startsWith("where ")) return null;

  // `command -v` is authoritative; skip fs.access to allow testing with fakes
  return firstLine;
}

async function tryRun(
  cmd: string,
  args: string[],
): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = getSpawn()(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    proc.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.on("error", () => resolve(null));
    proc.on("close", (code) => {
      resolve(code === 0 ? stdout : null);
    });
  });
}
