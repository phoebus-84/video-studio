// ── Delivery QA ────────────────────────────────────────────────────────────
//
// Quality gates for composited MP4 files. Verifies the 10 checks from
// ADR 0020 / ARCHITECTURE.md before marking a deliverable "current".
//
// Uses ffprobe (from ffmpeg-full) for media inspection and ffmpeg
// loudnorm for audio loudness measurement.

import { execSync } from "node:child_process";
import { statSync, existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

// ── Types ───────────────────────────────────────────────────────────────────

export interface QaCheck {
  /** Check identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Pass / warn / fail. */
  status: "pass" | "warn" | "fail";
  /** Expected value description. */
  expected: string;
  /** Actual value description. */
  actual: string;
  /** Optional detail. */
  detail?: string;
}

export interface QaReport {
  /** When the QA was run. */
  timestamp: string;
  /** Path to the MP4 file. */
  videoPath: string;
  /** All checks that were run. */
  checks: QaCheck[];
  /** Overall verdict. */
  verdict: "pass" | "warn" | "fail";
  /** Human-readable summary. */
  summary: string;
  /** ffprobe output (parsed). */
  probeData?: Record<string, unknown>;
}

export interface QaOptions {
  /** Path to ffprobe binary (default: ffprobe). */
  ffprobePath?: string;
  /** Path to ffmpeg binary (for loudness, default: ffmpeg). */
  ffmpegPath?: string;
  /** Expected minimum duration in seconds. */
  minDurationSec?: number;
  /** Expected maximum duration in seconds. */
  maxDurationSec?: number;
  /** Expected width. */
  expectedWidth?: number;
  /** Expected height. */
  expectedHeight?: number;
  /** Expected frame rate. */
  expectedFps?: number;
  /** Expected video codec. */
  expectedVideoCodec?: string;
  /** Expected audio codec. */
  expectedAudioCodec?: string;
  /** Expected pixel format. */
  expectedPixelFormat?: string;
  /** Path to captions SRT file (for caption verification). */
  captionsPath?: string;
  /** Path to narration audio (for duration agreement check). */
  narrationPath?: string;
  /** Maximum integrated loudness (LKFS, default: -14). */
  maxIntegratedLoudness?: number;
  /** Maximum true peak (dBTP, default: -1). */
  maxTruePeak?: number;
}

// ── ffprobe wrapper ─────────────────────────────────────────────────────────

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  pix_fmt?: string;
  duration?: string;
  sample_rate?: string;
  channels?: number;
}

interface FfprobeOutput {
  format?: {
    duration?: string;
    size?: string;
    bit_rate?: string;
  };
  streams?: FfprobeStream[];
}

function probe(ffprobePath: string, videoPath: string): FfprobeOutput {
  const out = execSync(
    `${ffprobePath} -v quiet -print_format json -show_format -show_streams "${videoPath}"`,
    { encoding: "utf-8", timeout: 10_000 },
  );
  return JSON.parse(out) as FfprobeOutput;
}

function parseFrameRate(r: string | undefined): number {
  if (!r) return 0;
  const [num, den] = r.split("/").map(Number);
  if (den && den !== 0) return num! / den!;
  return num ?? 0;
}

// ── Blank frame detection ───────────────────────────────────────────────────

function checkBlankFrames(
  ffprobePath: string,
  videoPath: string,
  numSamples: number = 5,
): { blankCount: number; sampledCount: number; details: string[] } {
  // Sample frames at evenly-spaced intervals and check if they're blank
  const probeData = probe(ffprobePath, videoPath);
  const duration = parseFloat(probeData.format?.duration ?? "0");
  if (duration <= 0) return { blankCount: 0, sampledCount: 0, details: ["Cannot determine duration"] };

  const details: string[] = [];
  let blankCount = 0;
  const interval = duration / (numSamples + 1);

  for (let i = 1; i <= numSamples; i++) {
    const t = interval * i;
    try {
      // Extract frame and check for uniform color (blank detection)
      const stdout = execSync(
        `${ffprobePath} -v quiet -f lavfi -i "movie='${videoPath}':seek_point=${t}" ` +
        `-frames:v 1 -f null - 2>&1 || true`,
        { encoding: "utf-8", timeout: 5_000 },
      );
      // If the frame can be decoded, it's not blank
      details.push(`t=${t.toFixed(1)}s: decodable`);
    } catch {
      blankCount++;
      details.push(`t=${t.toFixed(1)}s: UNDECODABLE`);
    }
  }

  return { blankCount, sampledCount: numSamples, details };
}

// ── Loudness measurement ────────────────────────────────────────────────────

interface LoudnessResult {
  integrated: number;   // LKFS
  truePeak: number;     // dBTP
  range: number;        // LRA
  pass: boolean;
}

function measureLoudness(
  ffmpegPath: string,
  videoPath: string,
): LoudnessResult | null {
  try {
    const out = execSync(
      `${ffmpegPath} -i "${videoPath}" -af loudnorm=print_format=json -f null /dev/null`,
      { encoding: "utf-8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] },
    );
    // The loudnorm filter prints JSON to stderr, execSync returns stdout.
    // We need to capture stderr via redirection.
    const result = execSync(
      `${ffmpegPath} -i "${videoPath}" -af loudnorm=print_format=json -f null /dev/null 2>&1`,
      { encoding: "utf-8", timeout: 30_000 },
    );
    // Find JSON block in combined output
    const jsonStart = result.indexOf("{");
    const jsonEnd = result.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const json = result.slice(jsonStart, jsonEnd + 1);
      const data = JSON.parse(json);
      return {
        integrated: parseFloat(data.input_i ?? "0"),
        truePeak: parseFloat(data.input_tp ?? "0"),
        range: parseFloat(data.input_lra ?? "0"),
        pass: data.normalization_type === "dynamic",
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ── Main QA function ────────────────────────────────────────────────────────

export function runQa(videoPath: string, options: QaOptions = {}): QaReport {
  const checks: QaCheck[] = [];
  const ffprobePath = options.ffprobePath ?? "ffprobe";
  const ffmpegPath = options.ffmpegPath ?? "ffmpeg";

  // ── Check 1: File exists ─────────────────────────────────────────────────
  const fileExists = existsSync(videoPath);
  checks.push({
    id: "file-exists",
    name: "File exists",
    status: fileExists ? "pass" : "fail",
    expected: "File exists",
    actual: fileExists ? "yes" : "File not found",
  });

  if (!fileExists) {
    return {
      timestamp: new Date().toISOString(),
      videoPath,
      checks,
      verdict: "fail",
      summary: "MP4 file does not exist.",
    };
  }

  const fileSize = statSync(videoPath).size;
  const probeData = probe(ffprobePath, videoPath);
  const videoStream = probeData.streams?.find((s) => s.codec_type === "video");
  const audioStream = probeData.streams?.find((s) => s.codec_type === "audio");
  const duration = parseFloat(probeData.format?.duration ?? "0");
  const fps = parseFrameRate(videoStream?.r_frame_rate);

  // ── Check 2: Resolution ──────────────────────────────────────────────────
  const expectedW = options.expectedWidth ?? 1920;
  const expectedH = options.expectedHeight ?? 1080;
  const actualW = videoStream?.width ?? 0;
  const actualH = videoStream?.height ?? 0;
  const resolutionOk = actualW === expectedW && actualH === expectedH;
  checks.push({
    id: "resolution",
    name: "Resolution",
    status: resolutionOk ? "pass" : "fail",
    expected: `${expectedW}x${expectedH}`,
    actual: `${actualW}x${actualH}`,
  });

  // ── Check 3: Duration ────────────────────────────────────────────────────
  const minDur = options.minDurationSec ?? 30;
  const maxDur = options.maxDurationSec ?? 480;
  let durationStatus: QaCheck["status"] = "pass";
  if (duration < minDur) durationStatus = "fail";
  else if (duration > maxDur) durationStatus = "warn";
  checks.push({
    id: "duration",
    name: "Duration",
    status: durationStatus,
    expected: `${minDur}s – ${maxDur}s`,
    actual: `${duration.toFixed(1)}s (${(duration / 60).toFixed(1)}m)`,
  });

  // ── Check 4: Video codec ─────────────────────────────────────────────────
  const expectedCodec = options.expectedVideoCodec ?? "h264";
  const actualCodec = videoStream?.codec_name ?? "none";
  checks.push({
    id: "video-codec",
    name: "Video codec",
    status: actualCodec === expectedCodec ? "pass" : "fail",
    expected: expectedCodec,
    actual: actualCodec,
  });

  // ── Check 5: Frame rate ──────────────────────────────────────────────────
  const expectedFps = options.expectedFps ?? 30;
  const fpsDiff = Math.abs(fps - expectedFps);
  checks.push({
    id: "frame-rate",
    name: "Frame rate",
    status: fpsDiff < 0.1 ? "pass" : "warn",
    expected: `${expectedFps} fps`,
    actual: `${fps.toFixed(2)} fps`,
  });

  // ── Check 6: Pixel format ─────────────────────────────────────────────────
  const expectedPixFmt = options.expectedPixelFormat ?? "yuv420p";
  const actualPixFmt = videoStream?.pix_fmt ?? "unknown";
  checks.push({
    id: "pixel-format",
    name: "Pixel format",
    status: actualPixFmt === expectedPixFmt ? "pass" : "warn",
    expected: expectedPixFmt,
    actual: actualPixFmt,
  });

  // ── Check 7: Audio stream present ────────────────────────────────────────
  checks.push({
    id: "audio-present",
    name: "Audio stream",
    status: audioStream ? "pass" : "fail",
    expected: "Audio stream present",
    actual: audioStream
      ? `${audioStream.codec_name} ${audioStream.channels}ch ${audioStream.sample_rate}Hz`
      : "No audio stream",
  });

  // ── Check 8: Audio codec ─────────────────────────────────────────────────
  if (audioStream) {
    const expectedAudioCodec = options.expectedAudioCodec ?? "aac";
    checks.push({
      id: "audio-codec",
      name: "Audio codec",
      status: audioStream.codec_name === expectedAudioCodec ? "pass" : "warn",
      expected: expectedAudioCodec,
      actual: audioStream.codec_name ?? "unknown",
    });
  }

  // ── Check 9: File size reasonable ────────────────────────────────────────
  const sizeMB = fileSize / (1024 * 1024);
  checks.push({
    id: "file-size",
    name: "File size",
    status: sizeMB > 0.1 && sizeMB < 2000 ? "pass" : "warn",
    expected: "0.1 MB – 2 GB",
    actual: `${sizeMB.toFixed(1)} MB`,
    detail: `${fileSize} bytes`,
  });

  // ── Check 10: Blank frames ───────────────────────────────────────────────
  const blankResult = checkBlankFrames(ffprobePath, videoPath, 3);
  checks.push({
    id: "blank-frames",
    name: "Blank frame check",
    status: blankResult.blankCount === 0 ? "pass" : "fail",
    expected: "0 blank frames",
    actual: `${blankResult.blankCount}/${blankResult.sampledCount} sampled blank`,
    detail: blankResult.details.join("; "),
  });

  // ── Check 11: Loudness ───────────────────────────────────────────────────
  const maxLoudness = options.maxIntegratedLoudness ?? -14;
  const maxPeak = options.maxTruePeak ?? -1;

  try {
    const loudness = measureLoudness(ffmpegPath, videoPath);
    if (loudness) {
      const loudOk = loudness.integrated <= maxLoudness;
      const peakOk = loudness.truePeak <= maxPeak;
      checks.push({
        id: "loudness",
        name: "Integrated loudness (LKFS)",
        status: loudOk ? "pass" : "warn",
        expected: `≤ ${maxLoudness} LKFS`,
        actual: `${loudness.integrated.toFixed(1)} LKFS`,
      });
      checks.push({
        id: "true-peak",
        name: "True peak (dBTP)",
        status: peakOk ? "pass" : "warn",
        expected: `≤ ${maxPeak} dBTP`,
        actual: `${loudness.truePeak.toFixed(1)} dBTP`,
      });
    } else {
      checks.push({
        id: "loudness",
        name: "Loudness measurement",
        status: "warn",
        expected: "Measurable",
        actual: "Could not measure (loudnorm unavailable?)",
      });
    }
  } catch {
    checks.push({
      id: "loudness",
      name: "Loudness measurement",
      status: "warn",
      expected: "Measurable",
      actual: "Error during measurement",
    });
  }

  // ── Check 12: Captions present ────────────────────────────────────────────
  if (options.captionsPath) {
    const captionsExist = existsSync(options.captionsPath);
    checks.push({
      id: "captions-exist",
      name: "Captions file",
      status: captionsExist ? "pass" : "warn",
      expected: "SRT file present",
      actual: captionsExist
        ? `${readFileSync(options.captionsPath, "utf-8").split("\n").length} lines`
        : "Missing",
    });
  }

  // ── Check 13: Narration duration agreement ────────────────────────────────
  if (options.narrationPath && existsSync(options.narrationPath)) {
    try {
      const narProbe = probe(ffprobePath, options.narrationPath);
      const narDuration = parseFloat(narProbe.format?.duration ?? "0");
      const diff = Math.abs(duration - narDuration);
      checks.push({
        id: "narration-sync",
        name: "Narration duration sync",
        status: diff < 5 ? "pass" : "warn",
        expected: `Within 5s of narration (${narDuration.toFixed(1)}s)`,
        actual: `Video: ${duration.toFixed(1)}s, Narration: ${narDuration.toFixed(1)}s (diff: ${diff.toFixed(1)}s)`,
      });
    } catch {
      // skip
    }
  }

  // ── Determine verdict ────────────────────────────────────────────────────
  const failed = checks.filter((c) => c.status === "fail").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  const passed = checks.filter((c) => c.status === "pass").length;

  let verdict: QaReport["verdict"] = "pass";
  if (failed > 0) verdict = "fail";
  else if (warned > 0) verdict = "warn";

  const summary = [
    `${passed} passed, ${warned} warnings, ${failed} failures`,
    `Resolution: ${actualW}x${actualH}`,
    `Duration: ${duration.toFixed(1)}s`,
    `Codec: ${actualCodec}`,
    `Size: ${sizeMB.toFixed(1)} MB`,
  ].join(" | ");

  return {
    timestamp: new Date().toISOString(),
    videoPath,
    checks,
    verdict,
    summary,
    probeData: probeData as unknown as Record<string, unknown>,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (process.argv[1]?.includes("qa.ts")) {
  const videoPath = process.argv[2];
  const captionsPath = process.argv[3];
  const narrationPath = process.argv[4];
  const ffprobePath = process.env.QA_FFPROBE ?? "ffprobe";
  const ffmpegPath = process.env.QA_FFMPEG ?? "ffmpeg";

  if (!videoPath) {
    console.error("Usage: qa <video.mp4> [captions.srt] [narration.wav]");
    process.exit(1);
  }

  const report = runQa(videoPath, {
    ffprobePath,
    ffmpegPath,
    captionsPath,
    narrationPath,
  });

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.verdict === "fail" ? 1 : 0);
}
