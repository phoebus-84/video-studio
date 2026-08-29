/**
 * Waveforms drawn from the actual audio, not from a seeded random walk.
 *
 * The mockup drew a plausible-looking wave from a PRNG. That is fine for a
 * picture and wrong for a workbench: the whole reason to show a waveform is to
 * see where the silence is, where a segment runs long, and whether the take
 * clipped. A decorative wave answers none of that and quietly lies about all of
 * it.
 *
 * So the peaks come from decoding the file. The reduction below is separated
 * from the decoding so it can be tested without an AudioContext.
 */

export interface Waveform {
  /** Per-bucket peak magnitude, 0–1. */
  peaks: Float32Array;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
}

/**
 * Reduce samples to one peak per bucket.
 *
 * Peak rather than mean: averaging flattens transients, so a clipped snare and
 * a soft one look identical. The peak is what the eye needs here.
 */
export function peaksFrom(samples: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(buckets);
  if (buckets <= 0 || samples.length === 0) return out;

  const width = samples.length / buckets;

  for (let i = 0; i < buckets; i++) {
    const start = Math.floor(i * width);
    const end = Math.min(Math.floor((i + 1) * width), samples.length);
    let peak = 0;
    for (let j = start; j < end; j++) {
      const value = samples[j]!;
      const magnitude = value < 0 ? -value : value;
      if (magnitude > peak) peak = magnitude;
    }
    out[i] = peak;
  }

  return out;
}

/**
 * An SVG path for a symmetric waveform in a `0 0 width height` viewBox.
 *
 * Drawn as one closed polygon (top edge left-to-right, bottom edge back) so it
 * fills cleanly at any size rather than as N separate bars that alias when the
 * container resizes.
 */
export function peaksToPath(
  peaks: Float32Array,
  width: number,
  height: number,
): string {
  if (peaks.length === 0) return "";

  const mid = height / 2;
  const step = width / Math.max(peaks.length - 1, 1);
  const top: string[] = [];
  const bottom: string[] = [];

  for (let i = 0; i < peaks.length; i++) {
    const x = (i * step).toFixed(2);
    /* A floor keeps silence visible as a hairline instead of a gap in the
       shape, which would read as missing audio rather than quiet audio. */
    const amplitude = Math.max(peaks[i]! * mid, 0.5);
    top.push(`${x},${(mid - amplitude).toFixed(2)}`);
    bottom.unshift(`${x},${(mid + amplitude).toFixed(2)}`);
  }

  return `M${top.join("L")}L${bottom.join("L")}Z`;
}

/** Mix every channel down to one, so the drawn shape reflects what you hear. */
export function mixToMono(buffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = buffer;
  if (numberOfChannels === 1) return buffer.getChannelData(0);

  const mono = new Float32Array(length);
  for (let c = 0; c < numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      mono[i] = mono[i]! + data[i]! / numberOfChannels;
    }
  }
  return mono;
}

/**
 * Decode audio bytes into a waveform.
 *
 * Takes the bytes rather than a URL on purpose. Re-fetching the object URL the
 * player is using races that URL's revocation — the viewer would intermittently
 * report a file it had just successfully loaded as undecodable. The caller
 * already has the bytes; passing them costs nothing and removes the race.
 *
 * Note that `decodeAudioData` detaches the buffer it is given, so the caller
 * must not reuse it afterwards.
 *
 * Returns null when the bytes cannot be decoded — an unsupported codec, or a
 * file that is not audio at all. The viewer says so rather than drawing a flat
 * line, which would be indistinguishable from silence.
 */
export async function decodeWaveform(
  bytes: ArrayBuffer,
  buckets = 480,
): Promise<Waveform | null> {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;

    const context = new Ctor();
    try {
      const buffer = await context.decodeAudioData(bytes);
      return {
        peaks: peaksFrom(mixToMono(buffer), buckets),
        durationSeconds: buffer.duration,
        sampleRate: buffer.sampleRate,
        channels: buffer.numberOfChannels,
      };
    } finally {
      /* Browsers cap concurrent AudioContexts; leaking one per file opened
         would eventually stop decoding altogether. */
      void context.close();
    }
  } catch {
    return null;
  }
}

/** mm:ss.d, the resolution that matters when checking timing drift. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00.0";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}
