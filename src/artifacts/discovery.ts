import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const LEGACY_PATHS: Record<string, string> = {
  "brief.md": "artifacts/brief.md",
  "script.md": "artifacts/script.md",
  "art-direction.json": "artifacts/art-direction.json",
  "narration.mp3": "artifacts/narration/narration-full.wav",
  "safety-report.json": "artifacts/safety-report.json",
  "illustrations/": "artifacts/frames",
  "captions.srt": "artifacts/captions.srt",
  "timing.json": "artifacts/timing.json",
  "continuity-report.json": "artifacts/continuity-report.json",
  "output.mp4": "artifacts/render/final.mp4",
  "qa-report.json": "artifacts/qa-report.json",
};

const CAPABILITY_PATHS: Record<string, string[]> = {
  "animated-visuals.mp4": ["assets/animation/visuals.mp4"],
  "final-video.mp4": ["output/current.json"],
  "output.mp4": ["output/current.json"],
};

function nonEmptyPath(candidate: string, directoryArtifact: boolean): boolean {
  if (!existsSync(candidate)) return false;
  if (!directoryArtifact) return true;
  try {
    return readdirSync(candidate).length > 0;
  } catch {
    return false;
  }
}

function currentRenderExists(episodeDir: string, pointerPath: string): boolean {
  try {
    const pointer = JSON.parse(readFileSync(pointerPath, "utf-8")) as { path?: unknown };
    if (typeof pointer.path !== "string" || path.isAbsolute(pointer.path) || pointer.path.includes("..")) return false;
    return existsSync(path.join(episodeDir, "output", pointer.path));
  } catch {
    return false;
  }
}

/**
 * Detect a stage artifact across canonical editorial, capability, and legacy
 * locations. Labels remain provider-neutral while adapters can materialize
 * media beneath assets/ or immutable output/ renders.
 */
export function artifactExists(episodeDir: string, label: string): boolean {
  const directoryArtifact = label.endsWith("/");
  const candidates = new Set<string>();
  if (LEGACY_PATHS[label]) candidates.add(LEGACY_PATHS[label]);
  for (const candidate of CAPABILITY_PATHS[label] ?? []) candidates.add(candidate);
  candidates.add(`artifacts/${label}`);
  candidates.add(`assets/${label}`);
  candidates.add(`output/${label}`);

  for (const relative of candidates) {
    const candidate = path.join(episodeDir, relative);
    if (relative === "output/current.json") {
      if (currentRenderExists(episodeDir, candidate)) return true;
    } else if (nonEmptyPath(candidate, directoryArtifact)) {
      return true;
    }
  }
  return false;
}
