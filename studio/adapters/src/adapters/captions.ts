import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { StageAdapter } from "../descriptor.js";
import { narrationEntries, parseScriptScenes } from "./narration-segments.js";

/**
 * SRT captions timed from the measured duration of each accepted narration
 * WAV, in manifest order (ADR-0019). Measuring is the `media.probe` work; no
 * provider is called.
 */
export const narrationCaptions: StageAdapter = {
  id: "narration-captions",
  summary: "Writes SRT captions timed from the measured narration WAVs, in narration-manifest order",
  capability: "media.probe",
  provider: "studio",
  produces: ["captions.srt"],
  consumes: ["narration-manifest.json"],
  requires: {},
  async perform(ctx) {
    const captionsPath = path.join(ctx.episodeDir, "artifacts", "captions.srt");
    try {
      // Caption text for a segment the manifest carries none for. Read when
      // present and not required, so it is not declared in `consumes`.
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
  },
};

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
