// ---------------------------------------------------------------------------
// Scene spine
// ---------------------------------------------------------------------------
// The ordered list of scenes in an episode: which segments exist, in what
// order, and how long each runs.
//
// This used to come from `artifacts/episode.json` alone. That file is created
// once, empty, with O_EXCL when the episode workspace is authored, and nothing
// in the agent, the pipelines or the runtime ever wrote scenes back into it.
// The studio builds its entire scene list from that array and layers narration,
// assets and captions onto each entry, so an episode with eleven finished
// images, eleven narration clips and a rendered MP4 displayed nothing at all:
// the enrichment was correct, but it had no scenes to enrich.
//
// So the spine is derived rather than required. Every stage of production
// already leaves an ordered record of the segments behind -- the timing
// document, the narration manifest, the image files themselves -- and any one
// of them is enough to know what the scenes are. `episode.json` keeps its
// authority where it is the only source: the curated fields a human or the
// agent chose, which nothing else on disk knows.
// ---------------------------------------------------------------------------

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { loadNarrationManifest, naturalSceneOrder } from "../runtime/narration-manifest.js";

/** A scene as the studio consumes it, before narration/asset enrichment. */
export interface SpineScene {
  id: string;
  index: number;
  kind: string;
  durationSeconds: number;
  startSeconds: number;
  /** Curated fields pass through untouched; the studio and agent add their own. */
  [key: string]: unknown;
}

/** Where the ordered segment list came from, most authoritative first. */
export type SpineOrigin =
  | "episode.json"
  | "timing.json"
  | "narration-manifest"
  | "assets"
  | "none";

/** Everything on disk that says something about the scenes. */
export interface SpineSources {
  /** Parsed `artifacts/episode.json`: an array of scenes or `{ scenes }`. */
  episodeJson?: unknown;
  /** Parsed `artifacts/timing.json`, in either dialect. */
  timing?: unknown;
  /** Parsed `artifacts/art-direction.json`, which holds the image prompts. */
  artDirection?: unknown;
  /** Canonical narration manifest entries, in order. */
  narration?: Array<{
    segmentId: string;
    text?: string;
    durationSeconds: number;
    pauseAfterMs: number;
  }>;
  /** Scene IDs recovered from asset filenames, already in natural order. */
  assetIds?: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** `episode.json` is an array of scenes, or an object wrapping one. */
export function episodeScenes(episodeJson: unknown): Record<string, unknown>[] {
  const raw = Array.isArray(episodeJson)
    ? episodeJson
    : asArray(asRecord(episodeJson)?.scenes);
  return raw.map(asRecord).filter((s): s is Record<string, unknown> => s !== null);
}

/**
 * Timing entries keyed by segment ID.
 *
 * Two dialects are in the wild and both are read. The runtime executor writes
 * `segments[]` with `id`/`startSec`/`durationSec`; the agent's compose path
 * writes `scenes[]` with `sceneId`/`startSeconds`/`durationSeconds`. Reading
 * only one of them makes an episode's durations silently zero, which the
 * studio renders as scenes that exist but have no length.
 */
export function timingBySegment(
  timing: unknown,
): Map<string, { startSeconds?: number; durationSeconds?: number }> {
  const doc = asRecord(timing);
  const rows = doc ? [...asArray(doc.scenes), ...asArray(doc.segments)] : [];
  const out = new Map<string, { startSeconds?: number; durationSeconds?: number }>();
  for (const raw of rows) {
    const row = asRecord(raw);
    if (!row) continue;
    const id = str(row.sceneId) ?? str(row.id) ?? str(row.segmentId);
    if (!id || out.has(id)) continue;
    out.set(id, {
      startSeconds: num(row.startSeconds) ?? num(row.startSec),
      durationSeconds: num(row.durationSeconds) ?? num(row.durationSec),
    });
  }
  return out;
}

/** Image prompts from `art-direction.json`, keyed by scene ID. */
export function promptsByScene(artDirection: unknown): Map<string, string> {
  const doc = asRecord(artDirection);
  const out = new Map<string, string>();
  for (const raw of asArray(doc?.scenes)) {
    const row = asRecord(raw);
    const id = row && (str(row.id) ?? str(row.sceneId));
    const prompt = row && (str(row.prompt) ?? str(row.instruct));
    if (id && prompt && !out.has(id)) out.set(id, prompt);
  }
  return out;
}

/** Which source names the segments, and in what order. */
export function sceneSpineOrigin(sources: SpineSources): SpineOrigin {
  if (episodeScenes(sources.episodeJson).length > 0) return "episode.json";
  if (timingBySegment(sources.timing).size > 0) return "timing.json";
  if ((sources.narration ?? []).length > 0) return "narration-manifest";
  if ((sources.assetIds ?? []).length > 0) return "assets";
  return "none";
}

/**
 * Build the ordered scene list from whatever production has left on disk.
 *
 * `episode.json` wins when it names scenes, because it is the only source that
 * can carry a decision -- a title someone wrote, a prompt they edited. Its
 * entries are merged, not replaced: a curated scene keeps every field it has
 * and gains only what it is missing.
 */
export function deriveSceneSpine(sources: SpineSources): SpineScene[] {
  const curated = episodeScenes(sources.episodeJson);
  const curatedById = new Map<string, Record<string, unknown>>();
  curated.forEach((scene, i) => {
    const id = str(scene.id) ?? `s${i + 1}`;
    if (!curatedById.has(id)) curatedById.set(id, scene);
  });

  const timing = timingBySegment(sources.timing);
  const prompts = promptsByScene(sources.artDirection);
  const narration = sources.narration ?? [];
  const narrationById = new Map(narration.map((entry) => [entry.segmentId, entry]));

  const origin = sceneSpineOrigin(sources);
  let ids: string[];
  switch (origin) {
    case "episode.json":
      ids = curated.map((scene, i) => str(scene.id) ?? `s${i + 1}`);
      break;
    case "timing.json":
      ids = [...timing.keys()];
      break;
    case "narration-manifest":
      ids = narration.map((entry) => entry.segmentId);
      break;
    case "assets":
      ids = sources.assetIds ?? [];
      break;
    default:
      return [];
  }

  // Narration durations exclude the pause that follows them, so the running
  // start has to add it back. This matches how the runtime lays out timing.
  let narrationClock = 0;
  const narrationStart = new Map<string, number>();
  for (const entry of narration) {
    narrationStart.set(entry.segmentId, narrationClock);
    narrationClock += entry.durationSeconds + entry.pauseAfterMs / 1000;
  }

  let fallbackClock = 0;
  return ids.map((id, index) => {
    const scene = curatedById.get(id) ?? {};
    const timed = timing.get(id);
    const spoken = narrationById.get(id);

    const durationSeconds =
      num(scene.durationSeconds)
      ?? timed?.durationSeconds
      ?? spoken?.durationSeconds
      ?? 0;
    const startSeconds =
      num(scene.startSeconds)
      ?? timed?.startSeconds
      ?? narrationStart.get(id)
      ?? fallbackClock;
    fallbackClock = startSeconds + durationSeconds;

    const derived: SpineScene = {
      ...scene,
      id,
      index,
      kind: str(scene.kind) ?? "image",
      durationSeconds,
      startSeconds,
    };

    // Narration text is what the scene is about; the art direction prompt is
    // how it was drawn. Both are only filled in where nobody has curated one.
    const intent = str(scene.intent) ?? spoken?.text;
    if (intent) derived.intent = intent;
    const instruct = str(scene.instruct) ?? prompts.get(id);
    if (instruct) derived.instruct = instruct;

    return derived;
  });
}

// ── Reading the sources off disk ────────────────────────────────────────────

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm"]);

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    return undefined;
  }
}

/**
 * Scene IDs recovered from the asset files themselves.
 *
 * The last resort, and the only one that works for an episode whose images
 * were generated before any timing or narration existed. A filename is a scene
 * ID only if it looks like one; `manifest.json` sitting beside the images is
 * not scene `manifest`.
 */
export async function discoverAssetIds(episodeDir: string): Promise<string[]> {
  const dirs: Array<[string, Set<string>]> = [
    [path.join(episodeDir, "assets", "images"), IMAGE_EXTENSIONS],
    [path.join(episodeDir, "assets", "tapes"), VIDEO_EXTENSIONS],
  ];
  const files: string[] = [];
  for (const [dir, extensions] of dirs) {
    try {
      for (const entry of await fs.readdir(dir)) {
        if (!extensions.has(path.extname(entry).toLowerCase())) continue;
        if (!/^(?:s|scene-?)\d+[a-z]?\./i.test(entry)) continue;
        files.push(entry);
      }
    } catch { /* directory absent */ }
  }
  const ids = files.sort(naturalSceneOrder).map((f) => f.slice(0, f.lastIndexOf(".")));
  return [...new Set(ids)];
}

/** Collect every on-disk source of scene ordering for one episode. */
export async function readSpineSources(episodeDir: string): Promise<SpineSources> {
  const artifacts = path.join(episodeDir, "artifacts");
  const [episodeJson, timing, artDirection, manifest, assetIds] = await Promise.all([
    readJson(path.join(artifacts, "episode.json")),
    readJson(path.join(artifacts, "timing.json")),
    readJson(path.join(artifacts, "art-direction.json")),
    loadNarrationManifest(episodeDir).catch(() => null),
    discoverAssetIds(episodeDir),
  ]);
  return {
    episodeJson,
    timing,
    artDirection,
    narration: manifest?.entries,
    assetIds,
  };
}

/** The episode's scenes, from whichever sources exist. */
export async function readSceneSpine(episodeDir: string): Promise<SpineScene[]> {
  return deriveSceneSpine(await readSpineSources(episodeDir));
}

/**
 * Write a derived spine into `artifacts/episode.json`.
 *
 * Deriving the scenes is enough to display them, but not enough to edit them:
 * the studio saves a prompt by loading that file, finding the scene by ID and
 * assigning to it, so an empty file means the assignment finds nothing and the
 * edit is dropped without an error. Materialising the spine once gives those
 * writes somewhere to land.
 *
 * Only ever fills a gap. An episode.json that already names scenes is left
 * exactly as it is, so nothing curated can be overwritten by a derivation, and
 * calling this twice changes nothing the second time.
 */
export async function materializeSceneSpine(episodeDir: string): Promise<SpineScene[] | null> {
  const sources = await readSpineSources(episodeDir);
  if (sceneSpineOrigin(sources) === "episode.json") return null;

  const scenes = deriveSceneSpine(sources);
  if (scenes.length === 0) return null;

  const existing = asRecord(sources.episodeJson);
  const document = Array.isArray(sources.episodeJson) || sources.episodeJson === undefined
    ? { scenes }
    : { ...existing, scenes };

  const target = path.join(episodeDir, "artifacts", "episode.json");
  // Written through a temporary file: a reader that catches this mid-write
  // would otherwise parse a truncated document and see no scenes at all,
  // which is the very failure this repairs.
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf-8");
  await fs.rename(temporary, target);
  return scenes;
}
