import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AdapterContext, StageAdapter } from "../descriptor.js";

/**
 * The technical checks @av/video-composer's QA suite runs against the latest
 * render: resolution, duration, codecs, blank frames, loudness, captions and
 * narration sync. It is not a narrative, visual or safety review, and its
 * report does not claim to be one; the `qa` stage's human review gate is where
 * those happen.
 */
export const renderQa: StageAdapter = {
  id: "render-qa",
  summary: "Runs the composer's technical QA suite on the latest render and writes qa-report.json",
  capability: null,
  provider: "studio",
  produces: ["qa-report.json"],
  consumes: ["output.mp4"],
  requires: { system: ["ffprobe", "ffmpeg"] },
  perform: performQa,
};

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

async function performQa(ctx: AdapterContext): Promise<string[]> {
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
