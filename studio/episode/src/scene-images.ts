// ---------------------------------------------------------------------------
// Scene images and how long each is on screen
// ---------------------------------------------------------------------------
// Choosing the images for an episode's render used to be one expression:
//
//     readdirSync(scenesDir).filter(f => f.match(/^s\d+\.jpg$/)).sort()
//
// which is wrong three times over. It matches only `.jpg`, so an episode drawn
// by gpt-image-2 -- which writes `.png` -- selected nothing and the compose
// tool reported "No scene images found" for eleven finished images sitting in
// the directory. It matches only bare numbers, so a scene split into `s4a` and
// `s4b` is dropped from the render without a word. And a lexicographic sort
// puts `s10` between `s1` and `s2`, so the moment an episode reaches ten scenes
// the render is silently out of order.
//
// Duration belongs here too, because it is what decides which image is on
// screen when. The composer asked ffmpeg for a flat 1/10 framerate: every scene
// held for exactly ten seconds regardless of the narration it carries, with
// `-shortest` cutting the tail off whatever did not fit.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { naturalSegmentOrder } from "./narration-manifest.js";

/** Fallback when nothing on disk says how long a scene runs. */
export const DEFAULT_SCENE_SECONDS = 10;

const IMAGE_PATTERN = /^(?:s|scene-?)\d+[a-z]?\.(?:png|jpe?g|webp)$/i;

export interface SceneFrame {
  /** Scene ID, e.g. `s1` or `s4a`. */
  id: string;
  /** Filename within `assets/images`. */
  file: string;
  /** Seconds this image is on screen. */
  durationSeconds: number;
}

function segmentId(file: string): string {
  return file.slice(0, file.lastIndexOf("."));
}

/**
 * The episode's scene images, in the order a person reads them.
 *
 * One image per scene: if a scene somehow has both a `.png` and a `.jpg`, the
 * first by extension order wins rather than the scene appearing twice.
 */
export function listSceneImages(episodeDir: string): string[] {
  const dir = join(episodeDir, "assets", "images");
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const byId = new Map<string, string>();
  for (const file of entries.filter((f) => IMAGE_PATTERN.test(f)).sort()) {
    const id = segmentId(file);
    if (!byId.has(id)) byId.set(id, file);
  }

  return [...byId.keys()].sort(naturalSegmentOrder).map((id) => byId.get(id)!);
}

/** Per-scene durations from `timing.json`, in either dialect. */
function timingDurations(episodeDir: string): Map<string, number> {
  const out = new Map<string, number>();
  try {
    const doc = JSON.parse(readFileSync(join(episodeDir, "artifacts", "timing.json"), "utf-8"));
    const rows = [
      ...(Array.isArray(doc?.scenes) ? doc.scenes : []),
      ...(Array.isArray(doc?.segments) ? doc.segments : []),
    ];
    for (const row of rows) {
      const id = row?.sceneId ?? row?.id ?? row?.segmentId;
      const duration = row?.durationSeconds ?? row?.durationSec;
      if (typeof id === "string" && typeof duration === "number" && duration > 0 && !out.has(id)) {
        out.set(id, duration);
      }
    }
  } catch { /* no timing document */ }
  return out;
}

/**
 * Per-scene durations from the narration manifest.
 *
 * A scene is on screen for as long as its line is spoken plus the pause that
 * follows, so the images advance with the audio rather than against it.
 */
function narrationDurations(episodeDir: string): Map<string, number> {
  const out = new Map<string, number>();
  const manifestPath = join(episodeDir, "artifacts", "narration", "narration-manifest.json");
  if (!existsSync(manifestPath)) return out;
  try {
    const doc = JSON.parse(readFileSync(manifestPath, "utf-8"));
    for (const entry of Array.isArray(doc?.entries) ? doc.entries : []) {
      const id = entry?.segmentId ?? entry?.segment_id;
      const spoken = entry?.wav?.durationSeconds ?? entry?.wav?.duration_seconds;
      if (typeof id === "string" && typeof spoken === "number" && spoken > 0) {
        out.set(id, spoken + (Number(entry?.pauseAfterMs ?? entry?.pause_after_ms) || 0) / 1000);
      }
    }
  } catch { /* unreadable manifest */ }
  return out;
}

/**
 * The images to render and how long each one holds.
 *
 * Timing wins over narration, because a timing document is a decision about
 * the episode while the narration is only evidence about one segment. A scene
 * that neither describes falls back to a fixed hold, which at least keeps it on
 * screen instead of dropping it.
 */
export function resolveSceneFrames(episodeDir: string): SceneFrame[] {
  const timing = timingDurations(episodeDir);
  const narration = narrationDurations(episodeDir);

  return listSceneImages(episodeDir).map((file) => {
    const id = segmentId(file);
    return {
      id,
      file,
      durationSeconds: timing.get(id) ?? narration.get(id) ?? DEFAULT_SCENE_SECONDS,
    };
  });
}
