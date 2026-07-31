import fs from "node:fs/promises";
import path from "node:path";

export interface NarrationTimingEntry {
  segmentId: string;
  wavPath: string;
  text?: string;
  durationSeconds: number;
  pauseAfterMs: number;
  acceptedAttemptId?: string;
}

export interface LoadedNarrationManifest {
  source: "canonical" | "legacy";
  entries: NarrationTimingEntry[];
  finalWavPath?: string;
  warning?: string;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Read canonical camelCase or worker snake_case manifests during migration. */
export async function loadNarrationManifest(episodeDir: string): Promise<LoadedNarrationManifest | null> {
  const narrationDir = path.join(episodeDir, "artifacts", "narration");
  const candidates = [
    path.join(narrationDir, "narration-manifest.json"),
    path.join(narrationDir, "mastering-report.json"),
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(await fs.readFile(candidate, "utf8")) as Record<string, unknown>;
      const manifest = objectValue(parsed.manifest) ?? parsed;
      const rawEntries = manifest.entries;
      if (!Array.isArray(rawEntries) || rawEntries.length === 0) continue;
      const captions = Array.isArray(manifest.captions) ? manifest.captions : [];
      const textBySegment = new Map<string, string>();
      for (const rawCue of captions) {
        const cue = objectValue(rawCue);
        if (!cue) continue;
        const id = stringValue(cue.segmentId ?? cue.segment_id);
        const text = stringValue(cue.text);
        if (id && text && !textBySegment.has(id)) textBySegment.set(id, text);
      }
      const entries = rawEntries.map((raw, index): NarrationTimingEntry => {
        const entry = objectValue(raw);
        if (!entry) throw new Error(`narration entry ${index} is not an object`);
        const wav = objectValue(entry.wav);
        if (!wav) throw new Error(`narration entry ${index} has no WAV artifact`);
        const segmentId = stringValue(entry.segmentId ?? entry.segment_id);
        const wavPath = stringValue(wav.path);
        const duration = numberValue(wav.durationSeconds ?? wav.duration_seconds);
        if (!segmentId || !wavPath || duration === undefined || duration <= 0) {
          throw new Error(`narration entry ${index} lacks segment ID/path/measured duration`);
        }
        return {
          segmentId,
          wavPath,
          text: textBySegment.get(segmentId),
          durationSeconds: duration,
          pauseAfterMs: numberValue(entry.pauseAfterMs ?? entry.pause_after_ms) ?? 0,
          acceptedAttemptId: stringValue(entry.acceptedAttemptId ?? entry.accepted_attempt_id),
        };
      });
      const finalWav = objectValue(manifest.finalWav ?? manifest.final_wav);
      return {
        source: "canonical",
        entries,
        finalWavPath: finalWav ? stringValue(finalWav.path) : undefined,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
  return null;
}

export function naturalSceneOrder(left: string, right: string): number {
  const leftMatch = /^(?:s|scene-?)(\d+)([a-z]?)\./i.exec(left);
  const rightMatch = /^(?:s|scene-?)(\d+)([a-z]?)\./i.exec(right);
  if (leftMatch && rightMatch) {
    const number = Number(leftMatch[1]) - Number(rightMatch[1]);
    if (number !== 0) return number;
    return leftMatch[2]!.localeCompare(rightMatch[2]!);
  }
  return left.localeCompare(right, undefined, { numeric: true });
}
