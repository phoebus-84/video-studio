/** Runtime projection of the canonical workspace-contract NarrationManifest. */
export interface CanonicalNarrationManifest {
  schemaVersion: "0.1.0";
  entries: Array<{
    segmentId: string;
    acceptedAttemptId: string;
    wav: { path: string; durationSeconds: number; contentHash: string };
    pauseAfterMs: number;
  }>;
  finalWav: { path: string; durationSeconds: number; contentHash: string };
  captions: Array<{
    segmentId: string;
    index: number;
    startSeconds: number;
    endSeconds: number;
    text: string;
  }>;
}

export interface NarrationCompositionInput {
  audioPath: string;
  durationSeconds: number;
  orderedSegmentIds: string[];
  captions: Array<{ text: string; start: number; duration: number }>;
}

/**
 * Consume canonical measured order/timing. No filename sorting or stale sidecar
 * duration is permitted on this path.
 */
export function narrationCompositionInput(
  manifest: CanonicalNarrationManifest,
): NarrationCompositionInput {
  if (manifest.schemaVersion !== "0.1.0" || manifest.entries.length === 0) {
    throw new Error("invalid or empty canonical narration manifest");
  }
  const ids = manifest.entries.map((entry) => entry.segmentId);
  if (new Set(ids).size !== ids.length) throw new Error("duplicate narration segment ID");
  let cursor = 0;
  for (const entry of manifest.entries) {
    if (!(entry.wav.durationSeconds > 0) || entry.pauseAfterMs < 0) {
      throw new Error(`invalid measured narration timing for ${entry.segmentId}`);
    }
    cursor += entry.wav.durationSeconds + entry.pauseAfterMs / 1000;
  }
  const tolerance = 1 / 24_000;
  if (Math.abs(cursor - manifest.finalWav.durationSeconds) > tolerance) {
    throw new Error(
      `manifest duration ${cursor.toFixed(6)} does not match final WAV ${manifest.finalWav.durationSeconds.toFixed(6)}`,
    );
  }
  const captions = [...manifest.captions]
    .sort((left, right) => left.index - right.index)
    .map((cue) => {
      if (!ids.includes(cue.segmentId) || cue.startSeconds < 0 || cue.endSeconds <= cue.startSeconds || cue.endSeconds > manifest.finalWav.durationSeconds + tolerance) {
        throw new Error(`invalid canonical caption cue ${cue.index}`);
      }
      return { text: cue.text, start: cue.startSeconds, duration: cue.endSeconds - cue.startSeconds };
    });
  return {
    audioPath: manifest.finalWav.path,
    durationSeconds: manifest.finalWav.durationSeconds,
    orderedSegmentIds: ids,
    captions,
  };
}
