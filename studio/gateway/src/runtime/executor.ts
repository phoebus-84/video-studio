// ── Stage handlers ─────────────────────────────────────────────────────────
//
// What the gateway can perform, and nothing about when. Orchestration — what
// runs, in what order, under what lease, and whether the result counted — moved
// to the execution service in @studio/runtime; this file used to own all of it.
//
// These handlers still write artifacts, which ADR-0027 does not literally
// permit. Their home is avg-qr4.4's capability adapters.

import * as fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import type { EpisodeRef } from "../runtime/client.js";
import { loadNarrationManifest, naturalSceneOrder, type NarrationTimingEntry } from "./narration-manifest.js";

export interface StageContext {
  episodeDir: string;
  ref: EpisodeRef;
  log: (msg: string) => void;
}

export async function handleIllustrations(ctx: StageContext): Promise<string[]> {
  // Images already exist under assets/images/ — check and report
  const assetsDir = path.join(ctx.episodeDir, "assets", "images");
  const framesDir = path.join(ctx.episodeDir, "artifacts", "frames");
  const outputs: string[] = [];

  try {
    const files = await fs.readdir(assetsDir);
    const jpgs = files.filter((f) => f.endsWith(".jpg") || f.endsWith(".png"));
    for (const jpg of jpgs) {
      // Copy to frames directory (illustrations/ contract location)
      await fs.mkdir(framesDir, { recursive: true });
      const src = path.join(assetsDir, jpg);
      const dst = path.join(framesDir, jpg.replace(/\.jpg$/, ".png"));
      if (!(await exists(dst))) {
        await fs.copyFile(src, dst);
      }
      outputs.push(dst);
    }
    ctx.log(`  illustrations: ${jpgs.length} images ready`);
  } catch {
    ctx.log(`  illustrations: no images found (skipped)`);
  }
  return outputs;
}

async function narrationEntries(ctx: StageContext, sceneText: string[]): Promise<NarrationTimingEntry[]> {
  const canonical = await loadNarrationManifest(ctx.episodeDir);
  if (canonical) {
    const measured = [];
    for (let index = 0; index < canonical.entries.length; index++) {
      const entry = canonical.entries[index]!;
      const resolved = path.isAbsolute(entry.wavPath)
        ? entry.wavPath
        : path.join(ctx.episodeDir, entry.wavPath);
      let duration = entry.durationSeconds;
      try { duration = getWavDuration(resolved); } catch { /* retain immutable measured metadata */ }
      measured.push({ ...entry, durationSeconds: duration, text: entry.text ?? sceneText[index] });
    }
    return measured;
  }
  const narrationDir = path.join(ctx.episodeDir, "artifacts", "narration");
  const files = (await fs.readdir(narrationDir))
    .filter((file) => /^(?:s|scene-?)\d+[a-z]?\.wav$/i.test(file))
    .sort(naturalSceneOrder);
  if (files.length > 0) {
    ctx.log("  narration: DEPRECATED legacy WAV filename order; write narration-manifest.json");
  }
  return files.map((file, index) => ({
    segmentId: file.replace(/\.wav$/i, ""),
    wavPath: path.join("artifacts", "narration", file),
    durationSeconds: getWavDuration(path.join(narrationDir, file)),
    pauseAfterMs: 0,
    text: sceneText[index],
  }));
}

export async function handleCaptions(ctx: StageContext): Promise<string[]> {
  const captionsPath = path.join(ctx.episodeDir, "artifacts", "captions.srt");
  try {
    let scriptText = "";
    try { scriptText = await fs.readFile(path.join(ctx.episodeDir, "artifacts", "script.md"), "utf-8"); } catch { /* optional legacy fallback */ }
    const entries = await narrationEntries(ctx, parseScriptScenes(scriptText));
    if (entries.length === 0) {
      ctx.log("  captions: no narration segments found");
      return [];
    }
    let srt = "";
    let timeline = 0;
    entries.forEach((entry, index) => {
      const start = timeline;
      const end = start + entry.durationSeconds;
      srt += `${index + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n`;
      srt += wrapText(entry.text ?? `Segment ${entry.segmentId}`, 60) + "\n\n";
      timeline = end + entry.pauseAfterMs / 1000;
    });
    await fs.writeFile(captionsPath, srt);
    ctx.log(`  captions: ${entries.length} manifest-ordered segments, ${timeline.toFixed(1)}s total`);
    return [captionsPath];
  } catch (err) {
    ctx.log(`  captions: error — ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export async function handleTiming(ctx: StageContext): Promise<string[]> {
  const timingPath = path.join(ctx.episodeDir, "artifacts", "timing.json");
  try {
    const entries = await narrationEntries(ctx, []);
    let timeline = 0;
    const segments = entries.map((entry) => {
      const startSec = timeline;
      const endSec = startSec + entry.durationSeconds;
      timeline = endSec + entry.pauseAfterMs / 1000;
      return {
        id: entry.segmentId,
        acceptedAttemptId: entry.acceptedAttemptId,
        startSec,
        endSec,
        durationSec: entry.durationSeconds,
        pauseAfterSec: entry.pauseAfterMs / 1000,
      };
    });
    const timing = {
      source: (await loadNarrationManifest(ctx.episodeDir)) ? "narration-manifest" : "legacy-sidecars",
      totalDurationSec: timeline,
      segments,
      transitionSec: 0.5,
      fps: 30,
    };
    await fs.writeFile(timingPath, JSON.stringify(timing, null, 2));
    ctx.log(`  timing: ${segments.length} manifest-ordered segments, ${timeline.toFixed(1)}s total`);
    return [timingPath];
  } catch (err) {
    ctx.log(`  timing: error — ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * The render this episode last produced.
 *
 * QA looked for `artifacts/render/final.mp4`, a path nothing in the project
 * writes: the composer writes `artifacts/final.mp4` and canonical renders go to
 * `output/`. So QA never found a file, fell into its fallback, and wrote a
 * report with an empty check list and a "warn" verdict — a report about
 * nothing, indistinguishable from one about a video that had problems.
 */
async function findRender(episodeDir: string): Promise<string | null> {
  const candidates: Array<{ file: string; mtimeMs: number }> = [];
  try {
    const outDir = path.join(episodeDir, "output");
    for (const name of (await fs.readdir(outDir)).filter((f) => f.endsWith(".mp4"))) {
      const file = path.join(outDir, name);
      candidates.push({ file, mtimeMs: (await fs.stat(file)).mtimeMs });
    }
  } catch { /* no output directory */ }
  for (const relative of [["artifacts", "final.mp4"], ["artifacts", "render", "final.mp4"]]) {
    const file = path.join(episodeDir, ...relative);
    try {
      candidates.push({ file, mtimeMs: (await fs.stat(file)).mtimeMs });
    } catch { /* absent */ }
  }
  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.file ?? null;
}

export async function handleQa(ctx: StageContext): Promise<string[]> {
  const mp4Path = await findRender(ctx.episodeDir);
  const captionsPath = path.join(ctx.episodeDir, "artifacts", "captions.srt");
  const narrationPath = path.join(ctx.episodeDir, "artifacts", "narration", "narration-full.wav");

  if (!mp4Path) {
    // Say there is no render rather than reporting "warn" about a file that
    // was never there. A QA report that cannot name what it examined is not a
    // QA report.
    const report = {
      verdict: "fail",
      summary: "No render found to check: expected output/*.mp4 or artifacts/final.mp4",
      checks: [],
      timestamp: new Date().toISOString(),
    };
    const outPath = path.join(ctx.episodeDir, "artifacts", "qa-report.json");
    await fs.writeFile(outPath, JSON.stringify(report, null, 2));
    ctx.log("  qa: no render found");
    return [outPath];
  }

  // Run the full QA suite from ffmpeg-video-composer
  let report: Record<string, unknown>;

  try {
    // Imported as a package. This previously resolved a path relative to the
    // episode directory, three levels up into a sibling repository, which tied
    // the gateway to one on-disk layout.
    const { runQa } = await import("@av/video-composer");

    const qaReport = runQa(mp4Path, {
      // Resolved from PATH, not from a Homebrew Cellar glob. The previous
      // version only worked on an Apple-Silicon Mac with ffmpeg-full installed.
      ffprobePath: process.env.QA_FFPROBE ?? "ffprobe",
      ffmpegPath: process.env.QA_FFMPEG ?? "ffmpeg",
      captionsPath,
      narrationPath,
      minDurationSec: 30,
      maxDurationSec: 480,
    });

    report = {
      verdict: qaReport.verdict,
      summary: qaReport.summary,
      checks: qaReport.checks.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        expected: c.expected,
        actual: c.actual,
      })),
      timestamp: qaReport.timestamp,
    };

    ctx.log(`  qa: verdict=${qaReport.verdict} (${qaReport.checks.filter((c) => c.status === "fail").length} failures, ${qaReport.checks.filter((c) => c.status === "warn").length} warnings)`);
  } catch (err) {
    // The full suite is unavailable, so measure what can be measured rather
    // than reporting a verdict about a file nothing looked at. The Rome
    // episode's report claimed 92.477s for an 89.833s render and passed its
    // own 85–95 range: a check that never opened the file it named.
    ctx.log(`  qa: composer QA unavailable — ${err instanceof Error ? err.message : String(err)}`);
    let measured: number | null = null;
    try {
      const { execFileSync } = await import("node:child_process");
      measured = Number(execFileSync(process.env.QA_FFPROBE ?? "ffprobe", [
        "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4Path,
      ], { encoding: "utf-8" }).trim());
    } catch { /* ffprobe unavailable too */ }

    report = {
      verdict: "warn",
      summary: measured !== null
        ? `Full QA suite unavailable; duration measured from the render`
        : "Could not run full QA suite, and the render could not be measured",
      render: path.relative(ctx.episodeDir, mp4Path),
      checks: measured !== null && Number.isFinite(measured)
        ? [{
            id: "duration",
            name: "Render duration",
            status: "info",
            expected: "measured from the render",
            actual: `${measured.toFixed(3)}s`,
          }]
        : [],
      timestamp: new Date().toISOString(),
    };
  }

  const outPath = path.join(ctx.episodeDir, "artifacts", "qa-report.json");
  await fs.writeFile(outPath, JSON.stringify(report, null, 2));
  return [outPath];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatSrtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function wrapText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const mid = Math.floor(text.length / 2);
  const space = text.lastIndexOf(" ", mid);
  const split = space > 0 ? space : mid;
  return text.slice(0, split).trim() + "\n" + text.slice(split).trim();
}

/**
 * A WAV's duration, read from its own header.
 *
 * This used to estimate from file size against a hardcoded 24 kHz mono 16-bit —
 * right for the segments the voice worker emits, and wrong by a factor of two
 * for a 48 kHz mastered final. It also returned a flat five seconds whenever
 * the read failed, so a missing file produced a plausible number rather than an
 * error, and that number went on to shape the timeline, the captions and the
 * render.
 *
 * Chunks are walked rather than assumed at a fixed offset: a WAV may carry LIST
 * or fact chunks before its data, and the 44-byte guess reads those as audio.
 */
function getWavDuration(wavPath: string): number {
  const bytes = readFileSync(wavPath);
  if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${path.basename(wavPath)} is not a RIFF/WAVE file`);
  }

  let sampleRate = 0;
  let channels = 0;
  let sampleWidthBytes = 0;
  let dataBytes = 0;

  let cursor = 12;
  while (cursor + 8 <= bytes.length) {
    const id = bytes.toString("ascii", cursor, cursor + 4);
    const size = bytes.readUInt32LE(cursor + 4);
    const body = cursor + 8;
    if (id === "fmt " && body + 16 <= bytes.length) {
      channels = bytes.readUInt16LE(body + 2);
      sampleRate = bytes.readUInt32LE(body + 4);
      sampleWidthBytes = Math.ceil(bytes.readUInt16LE(body + 14) / 8);
    } else if (id === "data") {
      // A truncated file claims more data than it holds; trust the bytes.
      dataBytes = Math.min(size, bytes.length - body);
      break;
    }
    cursor = body + size + (size % 2);
  }

  const frameBytes = channels * sampleWidthBytes;
  if (!sampleRate || !frameBytes || !dataBytes) {
    throw new Error(`${path.basename(wavPath)} has no readable WAV format or data chunk`);
  }
  return dataBytes / (sampleRate * frameBytes);
}

function parseScriptScenes(script: string): string[] {
  // Extract text between scene markers or just split by paragraphs
  const lines = script.split("\n");
  const scenes: string[] = [];
  let current = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.match(/^(Scene|##|###|Narrator:|Speaker:)/i)) {
      if (current) scenes.push(current.trim());
      current = "";
    } else if (trimmed) {
      current += (current ? " " : "") + trimmed;
    }
  }
  if (current) scenes.push(current.trim());

  return scenes.length > 0 ? scenes : ["Narrator speaks."];
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}
