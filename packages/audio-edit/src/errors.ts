export type AudioEditErrorCode = "bad-recipe" | "missing-source" | "bad-audio" | "ffmpeg-failed";

export class AudioEditError extends Error {
  constructor(readonly code: AudioEditErrorCode, message: string, readonly path?: string) {
    super(message);
    this.name = "AudioEditError";
  }
}
