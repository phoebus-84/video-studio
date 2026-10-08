// ---------------------------------------------------------------------------
// Procedural sound: ambiences, effects, applause and a music bed at $0 (avg-jur)
// ---------------------------------------------------------------------------
// A series short needs room sounds, effects, applause and music. Nothing paid
// or downloaded: each sound is synthesized here from seeded noise and
// oscillators, so the same request always gives the same bytes, and the WAV
// carries a receipt of how it was made. They are stand-ins a person can hear
// as what they name, not recordings; a channel that has real ones uses those.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";

export const SOUND_KINDS = [
  "wind", "sea", "rain", "fire", "steam", "birds", "thunder",
  "applause", "whoosh", "shimmer", "music-bed",
] as const;
export type SoundKind = (typeof SOUND_KINDS)[number];

/** What each kind is, for the tool's description. */
export const SOUND_DESCRIPTIONS: Record<SoundKind, string> = {
  wind: "gusting wind",
  sea: "waves breaking on a shore",
  rain: "steady rain with drops",
  fire: "a crackling hearth",
  steam: "hissing steam or vapour",
  birds: "a flock's chirps",
  thunder: "a roll of thunder",
  applause: "a small hall applauding",
  whoosh: "a passing whoosh (entrances, teleports)",
  shimmer: "a bright magical shimmer (apparitions)",
  "music-bed": "a soft sustained chord that slowly breathes, in a key",
};

export const MUSIC_KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export type MusicKey = (typeof MUSIC_KEYS)[number];

export interface SoundRequest {
  kind: SoundKind;
  durationSeconds: number;
  /** Any string: the same seed gives the same sound. */
  seed: string;
  /** Peak level, 0–1. */
  gain?: number;
  /** music-bed only. */
  key?: MusicKey;
  /** music-bed only. */
  mode?: "major" | "minor";
}

export const SAMPLE_RATE = 48_000;
export const MAX_SECONDS = 180;

/** xorshift32 seeded by sha256: the same seed, the same noise. */
function random(seed: string): () => number {
  let state = createHash("sha256").update(seed).digest().readUInt32LE(0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
}

/** A one-pole low-pass, `hz` its corner. */
function lowpass(hz: number) {
  const a = Math.exp((-2 * Math.PI * hz) / SAMPLE_RATE);
  let y = 0;
  return (x: number) => (y = (1 - a) * x + a * y);
}

/** A one-pole high-pass, `hz` its corner. */
function highpass(hz: number) {
  const lp = lowpass(hz);
  return (x: number) => x - lp(x);
}

/** A band-pass made of the two. */
function bandpass(low: number, high: number) {
  const hp = highpass(low);
  const lp = lowpass(high);
  return (x: number) => lp(hp(x));
}

/** Smooth random movement between 0 and 1, changing about `hz` times a second. */
function drift(rand: () => number, hz: number) {
  let from = rand();
  let to = rand();
  let t = 0;
  const step = hz / SAMPLE_RATE;
  return () => {
    t += step;
    if (t >= 1) {
      t -= 1;
      from = to;
      to = rand();
    }
    const s = t * t * (3 - 2 * t);
    return from + (to - from) * s;
  };
}

/** The key's root between A2 and G#3, in semitones from A3 (220 Hz): MUSIC_KEYS counts from C, A is 9. */
const rootOf = (key: MusicKey) => (((MUSIC_KEYS.indexOf(key) - 9) % 12) + 12) % 12 - 12;
const hzOf = (semitonesFromA3: number) => 220 * Math.pow(2, semitonesFromA3 / 12);

/** One sample generator per kind; each returns roughly -1..1 before the final normalisation. */
function generator(req: SoundRequest, rand: () => number, total: number): (i: number) => number {
  const white = () => rand() * 2 - 1;
  switch (req.kind) {
    case "wind": {
      const body = bandpass(120, 900);
      const whistle = bandpass(700, 1600);
      const gust = drift(rand, 0.35);
      return () => {
        const g = 0.25 + 0.75 * gust();
        return body(white()) * 2.2 * g + whistle(white()) * 0.8 * g * g;
      };
    }
    case "sea": {
      const rumble = lowpass(350);
      const foam = bandpass(1200, 5000);
      const period = (6 + rand() * 3) * SAMPLE_RATE;
      return (i) => {
        const phase = (i % period) / period;
        const swell = Math.pow(Math.sin(Math.PI * phase), 2);
        const crash = phase > 0.35 && phase < 0.8 ? Math.exp(-(phase - 0.35) * 6) : 0;
        return rumble(white()) * (0.6 + 1.8 * swell) + foam(white()) * crash * 0.9;
      };
    }
    case "rain": {
      const hiss = bandpass(1500, 7000);
      let drop = 0;
      let dropDecay = 0;
      return () => {
        if (rand() < 0.0009) {
          drop = 0.5 + rand() * 0.5;
          dropDecay = 0.985 + rand() * 0.01;
        }
        drop *= dropDecay;
        return hiss(white()) * 0.55 + drop * white() * 0.6;
      };
    }
    case "fire": {
      const roar = lowpass(220);
      const flick = drift(rand, 2.5);
      let pop = 0;
      const popTone = bandpass(900, 4000);
      return () => {
        if (rand() < 0.00035) pop = 0.6 + rand() * 0.4;
        pop *= 0.992;
        return roar(white()) * 2.4 * (0.5 + 0.5 * flick()) + popTone(white() * pop) * 3;
      };
    }
    case "steam": {
      const hiss = bandpass(2500, 9000);
      return (i) => {
        const t = i / total;
        const swell = Math.min(1, t / 0.12) * Math.min(1, (1 - t) / 0.3);
        return hiss(white()) * 1.4 * swell;
      };
    }
    case "birds": {
      // Chirps: short upward FM sweeps at random moments.
      const chirps: { start: number; len: number; f0: number; f1: number }[] = [];
      // The first chirp comes at once, so even a short flock is heard.
      for (let at = Math.floor(rand() * 0.02 * SAMPLE_RATE), first = true; at < total; first = false) {
        if (!first) at += Math.floor((0.08 + rand() * 0.6) * SAMPLE_RATE);
        const len = Math.floor((0.05 + rand() * 0.1) * SAMPLE_RATE);
        const f0 = 2200 + rand() * 1800;
        chirps.push({ start: at, len, f0, f1: f0 * (1.15 + rand() * 0.5) });
      }
      let c = 0;
      let phase = 0;
      return (i) => {
        while (c < chirps.length && chirps[c]!.start + chirps[c]!.len < i) c++;
        const chirp = chirps[c];
        if (!chirp || i < chirp.start) return 0;
        const p = (i - chirp.start) / chirp.len;
        phase += (2 * Math.PI * (chirp.f0 + (chirp.f1 - chirp.f0) * p)) / SAMPLE_RATE;
        return Math.sin(phase) * Math.sin(Math.PI * p) * 0.8;
      };
    }
    case "thunder": {
      const rumble = lowpass(120);
      const crack = bandpass(300, 3000);
      const roll = drift(rand, 3);
      return (i) => {
        const t = i / SAMPLE_RATE;
        const env = Math.min(1, t / 0.08) * Math.exp(-t / (req.durationSeconds * 0.35));
        const crackEnv = Math.exp(-t / 0.25);
        return rumble(white()) * 5 * env * (0.5 + 0.5 * roll()) + crack(white()) * crackEnv * 0.9;
      };
    }
    case "applause": {
      // Many hands: each clap a short band-passed noise burst; density swells then thins.
      const clap = bandpass(800, 4500);
      let energy = 0;
      return (i) => {
        const t = i / total;
        const density = Math.min(1, t / 0.15) * Math.min(1, (1 - t) / 0.35);
        if (rand() < 0.012 * density) energy = Math.min(1.6, energy + 0.6 + rand() * 0.4);
        energy *= 0.993;
        return clap(white()) * energy * 1.6;
      };
    }
    case "whoosh": {
      // A noise band sweeping up then down, peaking at 40%.
      let low = 0;
      let band = 0;
      return (i) => {
        const t = i / total;
        const env = t < 0.4 ? Math.pow(t / 0.4, 2) : Math.pow((1 - t) / 0.6, 1.5);
        const hz = 300 + 3200 * env;
        const a = Math.exp((-2 * Math.PI * hz) / SAMPLE_RATE);
        low = (1 - a) * white() + a * low;
        band = low - band * 0.2;
        return band * 3 * env;
      };
    }
    case "shimmer": {
      // Bell-like partials at random high pitches, each ringing out.
      const voices: { start: number; hz: number; decay: number }[] = [];
      for (let at = 0; at < total; at += Math.floor((0.05 + rand() * 0.15) * SAMPLE_RATE)) {
        voices.push({ start: at, hz: 1200 + rand() * 2800, decay: 0.4 + rand() * 0.8 });
      }
      // Every voice has rung out 3.6 s after it starts: skip those, so a long shimmer stays cheap.
      const ringSamples = 3.6 * SAMPLE_RATE;
      let first = 0;
      return (i) => {
        while (first < voices.length && i - voices[first]!.start > ringSamples) first++;
        let s = 0;
        const t = i / total;
        const env = Math.min(1, t / 0.1) * Math.min(1, (1 - t) / 0.25);
        for (let v = first; v < voices.length && voices[v]!.start <= i; v++) {
          const voice = voices[v]!;
          const dt = (i - voice.start) / SAMPLE_RATE;
          s += Math.sin(2 * Math.PI * voice.hz * dt) * Math.exp(-dt / voice.decay) * 0.25;
        }
        return s * env;
      };
    }
    case "music-bed": {
      // A slow i–VI–III–VII (minor) or I–V–vi–IV (major) progression of soft triads, each chord ~6 s, crossfaded.
      const root = rootOf(req.key ?? "D");
      const minor = (req.mode ?? "minor") === "minor";
      // Each chord's frequencies once, not per sample.
      const progression = (minor ? [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]] : [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]])
        .map((chord) => chord.map((n) => 2 * Math.PI * hzOf(root + n)));
      const chordSeconds = 6;
      const breathe = drift(rand, 0.15);
      const soften = lowpass(1800);
      return (i) => {
        const t = i / SAMPLE_RATE;
        const at = t / chordSeconds;
        const k = Math.floor(at);
        const frac = at - k;
        const mix = frac > 0.8 ? (frac - 0.8) / 0.2 : 0;
        const voice = (chord: number[]) => chord.reduce((sum, w) =>
          sum + Math.sin(w * t) + 0.3 * Math.sin(w * 2 * t) + 0.12 * Math.sin(w * 3 * t), 0) / chord.length;
        const now = voice(progression[k % 4]!);
        const next = voice(progression[(k + 1) % 4]!);
        const fade = Math.min(1, t / 2) * Math.min(1, (req.durationSeconds - t) / 3);
        return soften((now * (1 - mix) + next * mix) * (0.75 + 0.25 * breathe())) * fade * 0.8;
      };
    }
  }
}

/** The sound as 16-bit mono PCM WAV bytes. */
export function synthesizeSound(req: SoundRequest): Buffer {
  if (!SOUND_KINDS.includes(req.kind)) throw new Error(`unknown sound kind "${req.kind}"`);
  if (!Number.isFinite(req.durationSeconds) || req.durationSeconds < 0.2 || req.durationSeconds > MAX_SECONDS) {
    throw new Error(`durationSeconds must be from 0.2 to ${MAX_SECONDS}`);
  }
  const gain = req.gain ?? 0.5;
  if (!Number.isFinite(gain) || gain <= 0 || gain > 1) throw new Error("gain must be greater than 0 and at most 1");
  if (req.key !== undefined && !MUSIC_KEYS.includes(req.key)) throw new Error(`unknown key "${req.key}"`);

  const total = Math.round(req.durationSeconds * SAMPLE_RATE);
  const rand = random(`${req.kind}\u0000${req.seed}`);
  const next = generator(req, rand, total);
  // 5 ms fades so nothing clicks at the ends, then normalised to the requested peak.
  const fade = Math.min(Math.floor(0.005 * SAMPLE_RATE), Math.floor(total / 2));
  const samples = new Float32Array(total);
  let peak = 0;
  for (let i = 0; i < total; i++) {
    const edge = fade > 0 ? Math.min(1, i / fade, (total - 1 - i) / fade) : 1;
    const s = next(i) * edge;
    samples[i] = s;
    peak = Math.max(peak, Math.abs(s));
  }
  if (!(peak > 0) || !Number.isFinite(peak)) throw new Error(`the ${req.kind} came out silent: try another duration`);
  const scale = gain / peak;
  const out = Buffer.alloc(44 + total * 2);
  writeHeader(out, total);
  for (let i = 0; i < total; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]! * scale));
    out.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return out;
}

function writeHeader(buffer: Buffer, samples: number): void {
  const data = samples * 2;
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + data, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(data, 40);
}
