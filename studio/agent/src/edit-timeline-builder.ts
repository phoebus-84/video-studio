// ---------------------------------------------------------------------------
// An episode's edit timeline, built from what is on disk (avg-tk7.6)
// ---------------------------------------------------------------------------
// The studio no longer runs FFmpeg to compose an episode. It writes a
// studio.video/v1alpha2 edit timeline — the reviewable account of what the
// render will be — and @av/remotion-composer renders it (ADR-0036).
//
// This builder decides nothing the old FFmpeg path did not already decide:
// the same scene images in the same order for the same lengths, the same
// narration. What it adds is what the compose-video skill always promised:
// captions from the narration manifest, short crossfades between scenes, and
// the loudness and safe zone of an output profile.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { validateTimeline } from "@av/remotion-composer";
import { validateEditTimeline } from "@studio/contracts/src/edit-timeline.mjs";
import { outputProfile } from "@studio/contracts/src/output-profiles.mjs";
import { naturalSegmentOrder, readWavFacts, validateNarrationManifest } from "./narration-manifest.js";
import { resolveSceneFrames } from "./scene-images.js";

export const TIMELINE_FPS = 30;
/** Frames a crossfade between two scenes lasts, centred on their boundary. */
export const CROSSFADE_FRAMES = 12;
export const DEFAULT_PROFILE = "youtube-1920x1080";
/** Where the timeline lives in an episode. */
export const EDIT_TIMELINE_PATH = "artifacts/edit-timeline.json";

const MANIFEST_PATH = "artifacts/narration/narration-manifest.json";
const FULL_NARRATION_PATH = "artifacts/narration/narration-full.wav";
const SCENE_WAV = /^(?:s|scene-?)\d+[a-z]?\.wav$/i;

export interface BuildProblem {
  code: string;
  message: string;
  path?: string;
}

export interface BuildOptions {
  episodeRef: { channel: string; series: string; episode: string };
  /** An output profile id of the contracts' catalog. */
  profile?: string;
}

export type BuildResult =
  | { ok: true; timeline: EditTimelineDoc; warnings: string[] }
  | { ok: false; problems: BuildProblem[] };

/** The timeline as this builder writes it (the contracts own the full type). */
export interface EditTimelineDoc {
  apiVersion: "studio.video/v1alpha2";
  kind: "EditTimeline";
  episodeRef: { channel: string; series: string; episode: string };
  revision: number;
  fps: number;
  durationInFrames: number;
  resolution: { width: number; height: number };
  profile: Record<string, unknown> & { id: string; width: number; height: number };
  assets: Record<string, { path: string; hash: string; kind: "image" | "audio" }>;
  tracks: Array<Record<string, unknown> & { id: string; items: Array<Record<string, unknown>> }>;
  metadata: { builtBy: string; inputs: Record<string, string> };
}

const frames = (seconds: number) => Math.round(seconds * TIMELINE_FPS);

/** One audio file and when it plays, in seconds of the timeline. */
interface AudioSpan {
  id: string;
  path: string;
  startSeconds: number;
  durationSeconds: number;
}

/**
 * Build the edit timeline of an episode.
 *
 * Reads files only; writes nothing. Every file it reads is listed with its
 * hash in `metadata.inputs`, which is how a later render knows whether the
 * timeline still describes the episode.
 */
export function buildEditTimeline(episodeDir: string, options: BuildOptions): BuildResult {
  try {
    return build(episodeDir, options);
  } catch (error) {
    if (error instanceof Problem) return { ok: false, problems: [error.problem] };
    throw error;
  }
}

/** A file the build needs could not be read: reported as a problem, not a crash. */
class Problem extends Error {
  constructor(readonly problem: BuildProblem) {
    super(problem.message);
  }
}

function build(episodeDir: string, options: BuildOptions): BuildResult {
  const profileId = options.profile ?? DEFAULT_PROFILE;
  const profile = outputProfile(profileId);
  if (!profile) {
    return { ok: false, problems: [{ code: "unknown-profile", message: `no output profile "${profileId}"` }] };
  }

  const inputs: Record<string, string> = {};
  const read = (relative: string): Buffer => {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(episodeDir, relative));
    } catch (error) {
      throw new Problem({ code: "missing-asset", path: relative, message: `${relative} cannot be read: ${(error as Error).message}` });
    }
    inputs[relative] = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    return bytes;
  };
  const warnings: string[] = [];

  // ── Scenes ────────────────────────────────────────────────────────────────
  const scenes = resolveSceneFrames(episodeDir);
  if (scenes.length === 0) {
    return { ok: false, problems: [{ code: "no-scenes", message: "no scene images in assets/images (s1.png, s4a.jpg, …)" }] };
  }
  if (existsSync(join(episodeDir, "artifacts/timing.json"))) read("artifacts/timing.json");

  // ── Narration and captions ────────────────────────────────────────────────
  let manifest: Record<string, any> | null = null;
  if (existsSync(join(episodeDir, MANIFEST_PATH))) {
    try {
      manifest = JSON.parse(read(MANIFEST_PATH).toString("utf-8"));
    } catch (error) {
      return { ok: false, problems: [{ code: "bad-manifest", message: `${MANIFEST_PATH} is not JSON: ${(error as Error).message}` }] };
    }
  }
  const manifestProblems = manifest ? validateNarrationManifest(manifest) : [];
  if (manifest && manifestProblems.length > 0) {
    warnings.push(`${MANIFEST_PATH} is not canonical, so the render has no captions: ${manifestProblems.join("; ")}`);
  }

  const audio: AudioSpan[] = [];
  const wavSeconds = (relative: string) => {
    read(relative);
    try {
      return readWavFacts(join(episodeDir, relative), relative).durationSeconds;
    } catch (error) {
      throw new Problem({ code: "bad-narration", path: relative, message: (error as Error).message });
    }
  };
  // As canonicalNarrationPath reads it: either spelling, and an absolute path
  // inside the episode is recorded relative to it.
  const named = manifest?.finalWav?.path ?? manifest?.final_wav?.path;
  const finalWav = typeof named === "string" && isAbsolute(named) ? relative(episodeDir, named) : named;
  if (typeof finalWav === "string" && finalWav.length > 0) {
    if (finalWav.startsWith("..") || isAbsolute(finalWav)) {
      return { ok: false, problems: [{ code: "missing-narration", message: `the manifest's final WAV is outside the episode: ${named}` }] };
    }
    if (!existsSync(join(episodeDir, finalWav))) {
      return { ok: false, problems: [{ code: "missing-narration", message: `the manifest's final WAV is missing: ${finalWav}` }] };
    }
    audio.push({ id: "narration", path: finalWav, startSeconds: 0, durationSeconds: wavSeconds(finalWav) });
  } else if (existsSync(join(episodeDir, FULL_NARRATION_PATH))) {
    audio.push({ id: "narration", path: FULL_NARRATION_PATH, startSeconds: 0, durationSeconds: wavSeconds(FULL_NARRATION_PATH) });
  } else if (manifest && manifestProblems.length === 0) {
    // A manifest of segments with no assembled final: play its entries in
    // order, each followed by its pause, after the lead-in silence.
    let cursor = Number(manifest.leadInSilenceSeconds) || 0;
    for (const entry of manifest.entries as Array<Record<string, any>>) {
      const path = String(entry.wav.path);
      const seconds = wavSeconds(path);
      audio.push({ id: `narration-${entry.segmentId}`, path, startSeconds: cursor, durationSeconds: seconds });
      cursor += seconds + (Number(entry.pauseAfterMs) || 0) / 1000;
    }
  } else {
    const narrationDir = join(episodeDir, "artifacts", "narration");
    const files = existsSync(narrationDir)
      ? readdirSync(narrationDir).filter((f) => SCENE_WAV.test(f))
        .sort((a, b) => naturalSegmentOrder(a.replace(/\.wav$/i, ""), b.replace(/\.wav$/i, "")))
      : [];
    if (files.length > 0) {
      warnings.push("DEPRECATED: narration taken from scene WAV filenames; write narration-manifest.json");
      let cursor = 0;
      for (const file of files) {
        const path = `artifacts/narration/${file}`;
        const seconds = wavSeconds(path);
        audio.push({ id: `narration-${file.replace(/\.wav$/i, "")}`, path, startSeconds: cursor, durationSeconds: seconds });
        cursor += seconds;
      }
    }
  }

  // ── Frames ────────────────────────────────────────────────────────────────
  // Absolute times are rounded, never a start and a length separately, so
  // scenes that touch in seconds still touch in frames.
  const bounds: number[] = [0];
  let seconds = 0;
  for (const scene of scenes) {
    seconds += scene.durationSeconds;
    // A scene shorter than half a frame still gets one.
    bounds.push(Math.max(frames(seconds), bounds[bounds.length - 1]! + 1));
  }
  const audioEnd = Math.max(0, ...audio.map((a) => frames(a.startSeconds + a.durationSeconds)));
  const durationInFrames = Math.max(bounds[bounds.length - 1]!, audioEnd, 1);
  bounds[bounds.length - 1] = durationInFrames; // the last scene holds to the end

  // ── Assets and tracks ─────────────────────────────────────────────────────
  const assets: EditTimelineDoc["assets"] = {};
  const half = CROSSFADE_FRAMES / 2;
  const length = (i: number) => bounds[i + 1]! - bounds[i]!;
  const fades = (i: number) => i > 0 && length(i - 1) > CROSSFADE_FRAMES && length(i) > CROSSFADE_FRAMES;

  const sceneItems = scenes.map((scene, i) => {
    const path = `assets/images/${scene.file}`;
    read(path);
    const asset = `scene-${scene.id}`;
    assets[asset] = { path, hash: inputs[path]!, kind: "image" };
    const from = bounds[i]! - (fades(i) ? half : 0);
    const end = bounds[i + 1]! + (i + 1 < scenes.length && fades(i + 1) ? half : 0);
    return {
      id: asset,
      from,
      duration: end - from,
      kit: { name: "still", version: "1.0.0" },
      props: { src: { $asset: asset }, fit: "contain" },
      ...(fades(i) ? { transitionIn: { type: "crossfade", duration: CROSSFADE_FRAMES } } : {}),
    };
  });

  const tracks: EditTimelineDoc["tracks"] = [{ id: "scenes", type: "visual", z: 0, items: sceneItems }];

  // Captions in time order, each ending no later than the next begins: a
  // caption generator's cues may overlap or be shorter than a frame, and one
  // such cue must not make the whole episode unrenderable.
  const captions = manifest && manifestProblems.length === 0 && Array.isArray(manifest.captions) ? manifest.captions : [];
  const cues = (captions as Array<Record<string, any>>)
    .filter((c) => typeof c.text === "string" && c.text.trim() && Number(c.endSeconds) > Number(c.startSeconds))
    .map((c) => ({ text: String(c.text).trim(), from: frames(Number(c.startSeconds)), end: frames(Number(c.endSeconds)) }))
    .sort((a, b) => a.from - b.from);
  const captionItems: Array<Record<string, unknown>> = [];
  cues.forEach((cue, i) => {
    const end = Math.min(cue.end, cues[i + 1]?.from ?? Infinity, durationInFrames);
    if (end <= cue.from) return;
    captionItems.push({
      id: `caption-${captionItems.length + 1}`,
      from: cue.from,
      duration: end - cue.from,
      kit: { name: "captions", version: "1.1.0" },
      props: { text: cue.text, position: "bottom" },
    });
  });
  if (captionItems.length < cues.length) {
    warnings.push(`${cues.length - captionItems.length} caption(s) dropped: shorter than a frame once the next one starts, or after the end`);
  }
  if (captionItems.length > 0) tracks.push({ id: "captions", type: "visual", z: 10, items: captionItems });

  if (audio.length > 0) {
    tracks.push({
      id: "voice",
      type: "audio",
      items: audio.map((a) => {
        assets[a.id] = { path: a.path, hash: inputs[a.path]!, kind: "audio" };
        const from = frames(a.startSeconds);
        return { id: a.id, from, duration: Math.max(1, frames(a.startSeconds + a.durationSeconds) - from), asset: a.id };
      }),
    });
  }

  const timeline: EditTimelineDoc = {
    apiVersion: "studio.video/v1alpha2",
    kind: "EditTimeline",
    episodeRef: options.episodeRef,
    revision: 1,
    fps: TIMELINE_FPS,
    durationInFrames,
    resolution: { width: profile.width, height: profile.height },
    profile: structuredClone(profile) as unknown as EditTimelineDoc["profile"],
    assets,
    tracks,
    metadata: { builtBy: "studio/agent buildEditTimeline", inputs: Object.fromEntries(Object.entries(inputs).sort()) },
  };

  const problems: BuildProblem[] = [...validateEditTimeline(timeline)];
  if (problems.length === 0) {
    const composer = validateTimeline(timeline);
    if (!composer.ok) problems.push(...composer.problems);
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, timeline, warnings };
}
