import type { NarrationTimingEntry } from "@studio/adapters";

export interface NarrationRerunImpact {
  segmentId: string;
  replacementAttemptId: string;
  stale: string[];
  affected: string[];
  preserved: string[];
}

/**
 * Compute minimal downstream invalidation for one accepted-attempt replacement.
 * Neighbor raw attempts, quality reports, and transforms remain immutable/current.
 */
export function planNarrationSegmentRerun(
  entries: readonly NarrationTimingEntry[],
  segmentId: string,
  replacementAttemptId: string,
  options: { durationChanged: boolean },
): NarrationRerunImpact {
  const index = entries.findIndex((entry) => entry.segmentId === segmentId);
  if (index < 0) throw new Error(`unknown narration segment ${segmentId}`);
  if (!replacementAttemptId) throw new Error("replacement attempt ID is required");
  const affected = new Set<string>([
    "narration-manifest.json",
    "narration-full.wav",
    "mastering-report.json",
    "final-render",
  ]);
  if (options.durationChanged) {
    affected.add("timing.json");
    for (const entry of entries.slice(index)) affected.add(`caption:${entry.segmentId}`);
  }
  const preserved = entries
    .filter((entry) => entry.segmentId !== segmentId)
    .flatMap((entry) => [
      `attempt:${entry.acceptedAttemptId ?? entry.segmentId}`,
      `quality:${entry.segmentId}`,
      `transform:${entry.segmentId}`,
    ]);
  if (!options.durationChanged) preserved.push("timing.json", `caption:${segmentId}`);
  return {
    segmentId,
    replacementAttemptId,
    stale: [`accepted-attempt:${segmentId}`],
    affected: [...affected],
    preserved,
  };
}
