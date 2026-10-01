// The narration segments captions and timing are both derived from, in the
// order the narration manifest gives them — the one place that order is read.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AdapterContext } from "../descriptor.js";
import { loadNarrationManifest, naturalSceneOrder, type NarrationTimingEntry } from "../narration-manifest.js";
import { getWavDuration } from "../wav.js";

export async function narrationEntries(ctx: AdapterContext, sceneText: string[]): Promise<NarrationTimingEntry[]> {
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

export function parseScriptScenes(script: string): string[] {
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
