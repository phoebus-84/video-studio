// ---------------------------------------------------------------------------
// Rendering an episode through its edit timeline (avg-tk7.6, ADR-0036)
// ---------------------------------------------------------------------------
// `artifacts/edit-timeline.json` is the reviewable account of a render. It is
// rebuilt from the episode's material when that material changed, and is
// otherwise rendered exactly as it stands — a hand edit, on the web or on
// disk, is never overwritten. Renders are immutable: output/<render-id>.mp4
// with a sibling report, and output/current.json moved last.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { renderTimeline, type RenderResult } from "@av/remotion-composer";
import {
  buildEditTimeline,
  DEFAULT_PROFILE,
  EDIT_TIMELINE_PATH,
  type BuildOptions,
  type BuildProblem,
  type EditTimelineDoc,
} from "./edit-timeline-builder.js";

const LABEL = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The builder refused the episode; `problems` say why. */
export class TimelineBuildError extends Error {
  constructor(readonly problems: BuildProblem[]) {
    super(`the edit timeline cannot be built: ${problems.map((p) => `${p.code}${p.path ? ` at ${p.path}` : ""}: ${p.message}`).join("; ")}`);
    this.name = "TimelineBuildError";
  }
}

const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const serialize = (timeline: unknown) => `${JSON.stringify(timeline, null, 2)}\n`;

/** Write through a temporary file, so no reader ever sees half a document. */
function writeAtomically(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text, "utf-8");
  renameSync(temp, path);
}

export interface WrittenTimeline {
  timeline: EditTimelineDoc;
  /** sha256 hex of the file as written. */
  hash: string;
  warnings: string[];
}

/** Build the timeline and write it to artifacts/edit-timeline.json. */
export function writeEditTimeline(episodeDir: string, options: BuildOptions): WrittenTimeline {
  const built = buildEditTimeline(episodeDir, options);
  if (!built.ok) throw new TimelineBuildError(built.problems);
  const text = serialize(built.timeline);
  writeAtomically(join(episodeDir, EDIT_TIMELINE_PATH), text);
  return { timeline: built.timeline, hash: sha256(text), warnings: built.warnings };
}

export interface CurrentTimeline extends WrittenTimeline {
  /** Why it was rebuilt, or null when the timeline on disk was used as it is. */
  rebuilt: string | null;
}

/**
 * The timeline to render: the one on disk when it still describes the
 * episode's material and the profile asked for, otherwise a fresh one.
 */
export function currentEditTimeline(episodeDir: string, options: BuildOptions): CurrentTimeline {
  const path = join(episodeDir, EDIT_TIMELINE_PATH);
  let stored: { text: string; doc: any } | null = null;
  let unreadable: string | null = null;
  if (existsSync(path)) {
    const text = readFileSync(path, "utf-8");
    try {
      stored = { text, doc: JSON.parse(text) };
    } catch (error) {
      unreadable = `${EDIT_TIMELINE_PATH} is not JSON (${(error as Error).message})`;
    }
  }

  const profile = options.profile ?? stored?.doc?.profile?.id ?? DEFAULT_PROFILE;
  const fresh = buildEditTimeline(episodeDir, { ...options, profile });
  if (!fresh.ok) throw new TimelineBuildError(fresh.problems);

  let reason: string | null = unreadable;
  if (!stored && !reason) reason = "there was no timeline yet";
  if (stored && !reason && stored.doc?.profile?.id !== profile) {
    reason = `the profile changed from ${stored.doc?.profile?.id ?? "none"} to ${profile}`;
  }
  if (stored && !reason) {
    const before: Record<string, string> = stored.doc?.metadata?.inputs ?? {};
    const after = fresh.timeline.metadata.inputs;
    const changes = [
      ...Object.keys(after).filter((p) => p in before && before[p] !== after[p]).map((p) => `${p} changed`),
      ...Object.keys(after).filter((p) => !(p in before)).map((p) => `${p} added`),
      ...Object.keys(before).filter((p) => !(p in after)).map((p) => `${p} removed`),
    ];
    if (changes.length > 0) reason = changes.join(", ");
  }

  if (reason === null && stored) {
    return { timeline: stored.doc, hash: sha256(stored.text), warnings: fresh.warnings, rebuilt: null };
  }
  const text = serialize(fresh.timeline);
  writeAtomically(path, text);
  return { timeline: fresh.timeline, hash: sha256(text), warnings: fresh.warnings, rebuilt: reason };
}

export interface EpisodeRenderOptions extends BuildOptions {
  /** Lowercase kebab-case; the render id starts with it. */
  label?: string;
  onProgress?: (progress: number) => void;
}

export interface EpisodeRender {
  renderId: string;
  outputPath: string;
  reportPath: string;
  rebuilt: string | null;
  warnings: string[];
  result: RenderResult;
}

/**
 * Render the episode's current timeline to output/<render-id>.mp4.
 *
 * The video is written beside its final name and renamed when complete; the
 * report follows; output/current.json moves last. A failure leaves output/
 * as it was. The caller serialises renders of one episode (current.json).
 */
export async function renderEpisode(episodeDir: string, options: EpisodeRenderOptions): Promise<EpisodeRender> {
  const label = options.label ?? "render";
  if (!LABEL.test(label)) throw new Error(`label "${label}" must be lowercase kebab-case`);
  const current = currentEditTimeline(episodeDir, options);

  const outputDir = join(episodeDir, "output");
  mkdirSync(outputDir, { recursive: true });
  const renderId = `${label}-${Date.now()}-${current.hash.slice(0, 8)}`;
  const outputPath = join(outputDir, `${renderId}.mp4`);
  const partialPath = join(outputDir, `.${renderId}.partial.mp4`);
  const reportPath = join(outputDir, `${renderId}.report.json`);

  let result: RenderResult;
  try {
    result = await renderTimeline({
      timeline: current.timeline,
      assetRoot: episodeDir,
      outputPath: partialPath,
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    });
    renameSync(partialPath, outputPath);
  } catch (error) {
    rmSync(partialPath, { force: true });
    throw error;
  }
  result = { ...result, path: outputPath };

  writeAtomically(reportPath, serialize({
    renderId,
    createdAt: new Date().toISOString(),
    timeline: { path: EDIT_TIMELINE_PATH, hash: `sha256:${current.hash}` },
    ...(current.rebuilt ? { rebuilt: current.rebuilt } : {}),
    ...(current.warnings.length > 0 ? { warnings: current.warnings } : {}),
    render: { ...result, path: `${renderId}.mp4` },
  }));
  writeAtomically(join(outputDir, "current.json"), serialize({ renderId, path: `${renderId}.mp4` }));

  return { renderId, outputPath, reportPath, rebuilt: current.rebuilt, warnings: current.warnings, result };
}
