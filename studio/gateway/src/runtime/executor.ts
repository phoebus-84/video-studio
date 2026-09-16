// ── Stage Executor ─────────────────────────────────────────────────────────
//
// Autopilot: when the gateway receives POST /api/.../execute,
// this loops through runnable stages, invoking tools and writing artifacts.
//
// For MVP: generates artifacts directly rather than calling Pi agent.
// Each stage handler is a function that takes the episode context
// and produces the required output files.

import * as fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import type { RuntimeClient, EpisodeRef } from "../runtime/client.js";
import { loadNarrationManifest, naturalSceneOrder, type NarrationTimingEntry } from "./narration-manifest.js";
import { episodePath } from "@studio/contracts/src/layout.mjs";
import { appendJournalEvent, parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { createDefaultLoader, resolvePipeline, type StageGates } from "@studio/runtime";
import { hashArtifacts, buildGateReview, deriveGateState } from "@studio/contracts/src/gate-review.mjs";
import { builtinPipelinesPath } from "./client.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface StageResult {
  stageId: string;
  status: "completed" | "failed" | "skipped" | "blocked" | "awaiting_approval";
  outputs: string[];
  durationMs: number;
  error?: string;
}

export interface ExecutionReport {
  episodeSlug: string;
  pipeline: string;
  stages: StageResult[];
  totalDurationMs: number;
  summary: string;
}

// ── Stage handlers ──────────────────────────────────────────────────────────

interface StageContext {
  episodeDir: string;
  ref: EpisodeRef;
  log: (msg: string) => void;
}

type StageHandler = (ctx: StageContext) => Promise<string[]>;

async function handleIllustrations(ctx: StageContext): Promise<string[]> {
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

async function handleCaptions(ctx: StageContext): Promise<string[]> {
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

async function handleTiming(ctx: StageContext): Promise<string[]> {
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

async function handleQa(ctx: StageContext): Promise<string[]> {
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

// ── Handler registry ────────────────────────────────────────────────────────
//
// safety-review and continuity-check are deliberately absent. They used to be
// here and wrote literal findings — a wolf, eight scenes, four passing checks —
// without opening any file belonging to the episode. A stage with a review gate
// and no real checker must stop, not invent a pass; see the dispatcher below.

export const HANDLERS: Record<string, StageHandler> = {
  "illustrations": handleIllustrations,
  "captions": handleCaptions,
  "timing": handleTiming,
  "qa": handleQa,
};

// ── Gates ───────────────────────────────────────────────────────────────────

/** What the manifest declares about a stage: its gates and what it is built on. */
interface StageDeclaration {
  gates: StageGates;
  dependsOn: string[];
}

/** Gates and dependencies for every stage in a pipeline, by stage id. */
async function loadGates(
  pipeline: string,
  libraryRoot: string,
  log: (msg: string) => void,
): Promise<Map<string, StageDeclaration> | null> {
  try {
    // `|| undefined` rather than the bare call: builtinPipelinesPath() returns
    // "" when package resolution fails, and createDefaultLoader's `??` does not
    // fall back on an empty string — so AVG_BUILTIN_PIPELINES, the operator's
    // escape hatch, would be dead exactly when it is needed.
    const loader = createDefaultLoader(libraryRoot, builtinPipelinesPath() || undefined);
    const resolved = await resolvePipeline(loader, pipeline);
    return new Map(resolved.stages.map((s) => [
      s.definition.id,
      { gates: s.definition.gates, dependsOn: s.definition.dependsOn ?? [] },
    ]));
  } catch (err) {
    // Fail closed and loudly. Not knowing what a stage's gates are is not the
    // same as a stage having none, and guessing "none" is how fabricated
    // reviews got reported as completions in the first place.
    log(`Autopilot: cannot read gates for pipeline "${pipeline}" — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Every declared output must exist and have bytes in it.
 *
 * A report file is not proof a review happened, and an empty file is not proof
 * of anything at all. Returns an error message, or null when the outputs hold up.
 */
async function validateOutputs(episodeDir: string, outputs: string[]): Promise<string | null> {
  if (outputs.length === 0) return "the stage produced no outputs";
  for (const file of outputs) {
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      return `declared output "${path.relative(episodeDir, file)}" was not written`;
    }
    if (stat.size === 0) {
      return `declared output "${path.relative(episodeDir, file)}" is empty`;
    }
  }
  return null;
}

/** The episode's journal, or no events at all when it has none yet. */
async function readJournal(episodeDir: string): Promise<unknown[]> {
  try {
    return parseJournal(await fs.readFile(path.join(episodeDir, JOURNAL_RELATIVE_PATH), "utf-8"));
  } catch {
    // An episode that has never been run has no journal. Absence of events is
    // not an outstanding review.
    return [];
  }
}

/**
 * Why a stage may not run yet, named after the dependency that is holding it.
 *
 * A halt at a review gate has to survive the next POST /execute, and nothing
 * else makes it. `studio/runtime/src/cli.ts` decides which stage is pending
 * purely from whether output files exist, and discovery counts a file as
 * present regardless of size; neither reads the journal, which is the only
 * place approval lives. So the second invocation is offered the stage after the
 * one that stopped awaiting review, and would build on an artifact nobody
 * accepted — precisely what stopping was for.
 *
 * Direct dependencies only. A blocked parent stops the run, so transitivity is
 * inherited rather than walked. `approved` and `none` do not block: most stages
 * have never had a review requested, and blocking on `none` would deadlock
 * every pipeline at its first stage.
 */
async function blockingDependency(
  episodeDir: string,
  dependsOn: string[],
): Promise<string | null> {
  if (dependsOn.length === 0) return null;
  const events = await readJournal(episodeDir);
  if (events.length === 0) return null;
  for (const depId of dependsOn) {
    const state = await deriveGateState(events, depId, episodeDir);
    if (state.state === "requested") {
      return `"${depId}" is awaiting review`;
    }
    if (state.state === "invalidated") {
      return `"${depId}" has an invalidated review: ${state.reason}`;
    }
  }
  return null;
}

/** Ask for a review of what a stage produced, naming it by hash. */
async function requestReview(
  episodeDir: string,
  ref: EpisodeRef,
  stageId: string,
  outputs: string[],
  note: string,
): Promise<void> {
  let hashed: Awaited<ReturnType<typeof hashArtifacts>> = [];
  try {
    hashed = await hashArtifacts(episodeDir, outputs.map((o) => path.relative(episodeDir, o)));
  } catch {
    // A request that cannot name its artifacts is still a request; it simply
    // names none. It can never be satisfied by an approval, which is correct.
    hashed = [];
  }
  await appendJournalEvent(episodeDir, {
    type: "approval-requested",
    actor: "gateway",
    episode: ref,
    stageId,
    detail: buildGateReview({
      stageId,
      decision: "requested",
      actor: "gateway",
      outputs: hashed,
      note,
    }),
  });
}

// ── Executor ────────────────────────────────────────────────────────────────

export async function runAutopilot(
  runtime: RuntimeClient,
  ref: EpisodeRef,
  pipeline: string,
  libraryRoot: string,
  log: (msg: string) => void,
): Promise<ExecutionReport> {
  const startMs = Date.now();
  // Layout 2 puts a series inside `series/` and an episode inside `episodes/`.
  // Joining the four names by hand pointed every stage at a directory that
  // does not exist, so each handler wrote its artifact beside the episode.
  const episodeDir = episodePath(libraryRoot, ref.channel, ref.series, ref.episode);
  const ctx: StageContext = { episodeDir, ref, log };
  const gates = await loadGates(pipeline, libraryRoot, log);
  const results: StageResult[] = [];

  log(`Autopilot: ${ref.channel}/${ref.series}/${ref.episode} (${pipeline})`);

  // Run up to 20 stages (safety limit)
  const seen = new Set<string>();
  // Whether the runtime ever actually told us there was nothing left to do,
  // as opposed to erroring or returning something this loop could not parse.
  // Both leave `results` empty, and only the first is a finished episode — an
  // unreachable `vpr run` must not read the same as one.
  let sawCompletion = false;
  let haltReason: string | null = null;
  for (let i = 0; i < 20; i++) {
    // Get next runnable stage from runtime
    const runResult = await runtime.run(ref, undefined, false, pipeline);
    if (!runResult.ok && !runResult.data) {
      // The runtime itself failed to answer — not the same as "no more
      // stages". Recorded so the summary can say so instead of guessing done.
      haltReason = runResult.error ?? "runtime returned no result";
      log(`Autopilot: ${haltReason}`);
      break;
    }

    // Try to extract the stage info from the runtime output
    const stageData = runResult.data as Record<string, unknown> | undefined;
    const stage = stageData?.stage as Record<string, unknown> | undefined;
    const stageId = stage?.id as string | undefined;

    if (!stageId) {
      const stdout = runResult.stdout ?? "";
      if (stageData?.completed === true || stdout.includes("All stages complete") || runResult.stdout?.includes("completed")) {
        log("Autopilot: all stages complete!");
        sawCompletion = true;
        break;
      }
      haltReason = `runtime returned an unparsable result — ${stdout.slice(0, 200)}`;
      log(`Autopilot: unknown stage — ${stdout.slice(0, 200)}`);
      break;
    }

    // Guard against infinite loops
    if (seen.has(stageId)) {
      log(`Autopilot: stage "${stageId}" already executed — stopping`);
      break;
    }
    seen.add(stageId);

    const declaration = gates?.get(stageId);

    // 1. Not knowing a stage's gates is not the same as a stage having none.
    // Guessing "none" is how fabricated reviews got reported as completions.
    // This precedes the handler lookup and the handler call, so a stage whose
    // gates could not be read never executes — a gate you cannot read covers
    // execution as much as acceptance.
    if (!declaration) {
      const why = `gates for "${stageId}" could not be read`;
      log(`Autopilot: ${why} — blocked`);
      await requestReview(episodeDir, ref, stageId, [], why);
      results.push({ stageId, status: "blocked", outputs: [], durationMs: 0, error: why });
      break;
    }

    const { gates: stageGates, dependsOn } = declaration;
    const gated = !stageGates.autopilot || stageGates.review !== "none";

    // 2. A stage this one is built on is awaiting review, or its review no
    // longer matches what is on disk. The gateway leaves a halted stage's
    // outputs in place and records approval only in the journal, which the
    // runtime never reads — so without this the halt lasts exactly one
    // invocation, and the next /execute happily builds on an artifact nobody
    // accepted.
    const blocking = await blockingDependency(episodeDir, dependsOn);
    if (blocking) {
      const why = `"${stageId}" cannot run: ${blocking}`;
      log(`Autopilot: ${why} — blocked`);
      await requestReview(episodeDir, ref, stageId, [], why);
      results.push({ stageId, status: "blocked", outputs: [], durationMs: 0, error: why });
      break;
    }

    // 3. The manifest says this may not run unattended.
    if (!stageGates.autopilot) {
      log(`Autopilot: "${stageId}" declares autopilot: false — approval requested`);
      await requestReview(episodeDir, ref, stageId, [], `${stageId} declares autopilot: false`);
      results.push({ stageId, status: "blocked", outputs: [], durationMs: 0,
        error: "Stage declares autopilot: false and may not run unattended" });
      break;
    }

    const handler = HANDLERS[stageId];

    // 4. No checker behind a gated stage. A refusal, not a shrug.
    if (!handler) {
      if (gated) {
        const why = `"${stageId}" requires ${stageGates.review} review and has no checker`;
        log(`Autopilot: ${why} — blocked`);
        await requestReview(episodeDir, ref, stageId, [], why);
        results.push({ stageId, status: "blocked", outputs: [], durationMs: 0, error: why });
      } else {
        log(`Autopilot: no handler for "${stageId}" — skipping`);
        results.push({ stageId, status: "skipped", outputs: [], durationMs: 0,
          error: "No handler registered" });
      }
      break;
    }

    const stageStart = Date.now();
    // What happened to this episode is recorded as it happens. The journal had
    // a schema, a route and a tool, and no writer: a complete production left
    // it at zero bytes, so afterwards nothing could say which stages ran, how
    // long they took or which one failed.
    await appendJournalEvent(episodeDir, {
      type: "stage-started", actor: "runtime", episode: ref, stageId,
    });
    try {
      const outputs = await handler(ctx);

      // 5. File existence is discovery, not completion.
      const invalid = await validateOutputs(episodeDir, outputs);
      if (invalid) {
        results.push({ stageId, status: "failed", outputs: [], durationMs: Date.now() - stageStart,
          error: invalid });
        await appendJournalEvent(episodeDir, {
          type: "stage-failed", actor: "runtime", episode: ref, stageId,
          detail: { durationMs: Date.now() - stageStart, error: invalid },
        });
        log(`Autopilot: ${stageId} FAILED — ${invalid}`);
        break;
      }

      const relative = outputs.map((o) => path.relative(episodeDir, o));

      // 6. Ran, but not accepted. The test is the declared review, never
      // `stageGates && ...`: a missing gate record must not read as "no review
      // required" — that check is above, and it blocks.
      if (stageGates.review !== "none") {
        const why = `${stageId} requires ${stageGates.review} review`;
        await requestReview(episodeDir, ref, stageId, outputs, why);
        results.push({ stageId, status: "awaiting_approval", outputs, durationMs: Date.now() - stageStart });
        await appendJournalEvent(episodeDir, {
          type: "attempt-recorded", actor: "runtime", episode: ref, stageId,
          detail: { durationMs: Date.now() - stageStart, outputs: relative },
        });
        log(`Autopilot: ${why} — awaiting review, stopping`);
        break;
      }

      // 7. Ungated and its outputs hold up.
      results.push({ stageId, status: "completed", outputs, durationMs: Date.now() - stageStart });
      await appendJournalEvent(episodeDir, {
        type: "stage-completed", actor: "runtime", episode: ref, stageId,
        detail: { durationMs: Date.now() - stageStart, outputs: relative },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        stageId,
        status: "failed",
        outputs: [],
        durationMs: Date.now() - stageStart,
        error: message,
      });
      await appendJournalEvent(episodeDir, {
        type: "stage-failed",
        actor: "runtime",
        episode: ref,
        stageId,
        detail: { durationMs: Date.now() - stageStart, error: message },
      });
      log(`Autopilot: ${stageId} FAILED — stopping`);
      break; // Stop on failure
    }
  }

  const totalMs = Date.now() - startMs;
  const count = (status: StageResult["status"]) => results.filter((r) => r.status === status).length;
  const parts = [
    `${count("completed")} completed`,
    `${count("failed")} failed`,
  ];
  // A run that halted at a gate is not a run that finished.
  if (count("awaiting_approval") > 0) parts.push(`${count("awaiting_approval")} awaiting review`);
  if (count("blocked") > 0) parts.push(`${count("blocked")} blocked`);

  return {
    episodeSlug: `${ref.channel}/${ref.series}/${ref.episode}`,
    pipeline,
    stages: results,
    totalDurationMs: totalMs,
    summary: results.length === 0
      ? sawCompletion
        ? `All stages already complete (${(totalMs / 1000).toFixed(1)}s)`
        : `No stage could be run: ${haltReason ?? "the runtime gave no reason"} (${(totalMs / 1000).toFixed(1)}s)`
      : `${parts.join(", ")}, ${results.length} total (${(totalMs / 1000).toFixed(1)}s)`,
  };
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
