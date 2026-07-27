import type { NarrationSegment, VoiceProfile } from "$lib/narration-types";

class NarrationStore {
  segments = $state<NarrationSegment[]>([]);
  voice = $state<VoiceProfile | null>(null);
  playingId = $state<string | null>(null);
  audioUrl = $state<string | null>(null);
  synthesizing = $state(false);
  error = $state<string | null>(null);

  private ttsUrl: string = localStorage.getItem("vs-tts-url") ?? "http://127.0.0.1:5197";
  private audioEl: HTMLAudioElement | null = null;

  load(segments: NarrationSegment[], voice: VoiceProfile) {
    this.segments = segments;
    this.voice = voice;
    this.playingId = null;
    this.audioUrl = null;
  }

  markPlaying(segmentId: string | null) {
    this.playingId = segmentId;
  }

  /** Synthesize a segment via the TTS worker and start playback. */
  async synthesizeAndPlay(segment: NarrationSegment) {
    this.synthesizing = true;
    this.error = null;
    this.markPlaying(segment.id);

    try {
      // Build text from segments or use the content field
      const text = (segment as any).text ?? (segment as any).content ?? `Segment ${segment.id}`;

      const res = await fetch(`${this.ttsUrl}/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voice: (this.voice?.name ?? "default"),
          speed: 1.0,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error((err as any).detail ?? `TTS error ${res.status}`);
      }

      const data = await res.json() as any;
      const wavPath = data.result?.wav_path;
      if (!wavPath) throw new Error("No WAV path in TTS response");

      // Fetch and play the WAV
      const audioRes = await fetch(`${this.ttsUrl}/voices/default/output/${wavPath.split("/").pop()}`);
      if (!audioRes.ok) throw new Error("Failed to fetch audio");

      const blob = await audioRes.blob();
      this.audioUrl = URL.createObjectURL(blob);

      // Play
      if (this.audioEl) {
        this.audioEl.pause();
        URL.revokeObjectURL(this.audioEl.src);
      }

      this.audioEl = new Audio(this.audioUrl);
      this.audioEl.onended = () => {
        this.markPlaying(null);
        this.audioUrl = null;
      };
      this.audioEl.onerror = () => {
        this.error = "Playback failed";
        this.markPlaying(null);
      };

      await this.audioEl.play();
      this.synthesizing = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Synthesis failed";
      this.synthesizing = false;
      this.markPlaying(null);
    }
  }

  stopPlayback() {
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl = null;
    }
    this.playingId = null;
    this.audioUrl = null;
    this.synthesizing = false;
    this.error = null;
  }

  totalDuration = $derived(
    this.segments.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0),
  );

  readyCount = $derived(
    this.segments.filter((s) => s.status === "ready").length,
  );
}

export const narration = new NarrationStore();
