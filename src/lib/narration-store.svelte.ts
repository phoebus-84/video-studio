import type { NarrationSegment, VoiceProfile } from "$lib/narration-types";

class NarrationStore {
  segments = $state<NarrationSegment[]>([]);
  voice = $state<VoiceProfile | null>(null);
  playingId = $state<string | null>(null);

  load(segments: NarrationSegment[], voice: VoiceProfile) {
    this.segments = segments;
    this.voice = voice;
    this.playingId = null;
  }

  markPlaying(segmentId: string | null) {
    this.playingId = segmentId;
  }

  totalDuration = $derived(
    this.segments.reduce(
      (sum, s) => sum + (s.durationSeconds ?? 0),
      0,
    ),
  );

  readyCount = $derived(
    this.segments.filter((s) => s.status === "ready").length,
  );
}

export const narration = new NarrationStore();
