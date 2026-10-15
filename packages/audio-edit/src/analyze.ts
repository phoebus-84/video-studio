// What a file sounds like, measured: its loudness (EBU R128: integrated,
// range, true peak), its silences, its clipped samples, and per 10 ms its
// peaks (for drawing the waveform) and its RMS (for finding quiet points).
// The PCM is read once, as a stream: a long ambience never sits whole in memory.

import { spawn } from "node:child_process";
import { AudioEditError } from "./errors.js";
import { FFMPEG, run } from "./media.js";

export const WINDOW = 0.01;

export interface Loudness {
  integrated: number;
  range: number;
  truePeak: number;
}

export interface Scan {
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  /** Samples at or above full scale (|x| ≥ 0.999), all channels. */
  clipped: number;
  /** Per WINDOW: [min, max] of the channels' mix. */
  peaks: [number, number][];
  /** Per WINDOW: RMS of the channels' mix. */
  rms: number[];
}

export interface Analysis extends Scan {
  loudness: Loudness;
  silences: [number, number][];
}

const num = (re: RegExp, text: string) => {
  const m = re.exec(text);
  return m ? Number(m[1]) : Number.NaN;
};

/** EBU R128 of a file, or of a stretch of it. */
export async function loudness(file: string, range?: { from: number; to: number }): Promise<Loudness> {
  const trim = range ? ["-ss", String(range.from), "-to", String(range.to)] : [];
  try {
    const { stderr } = await run(FFMPEG(), ["-hide_banner", "-nostats", ...trim, "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { maxBuffer: 64 * 1024 * 1024 });
    const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
    return {
      integrated: num(/I:\s+(-?[\d.]+|-inf) LUFS/, summary),
      range: num(/LRA:\s+(-?[\d.]+) LU/, summary),
      truePeak: num(/Peak:\s+(-?[\d.]+|-inf) dBFS/, summary),
    };
  } catch (error) {
    throw new AudioEditError("bad-audio", `${file}: loudness not measurable: ${(error as Error).message.split("\n")[0]}`);
  }
}

/** Silences of at least `minSeconds` below `noiseDb`. */
export async function silences(file: string, noiseDb = -50, minSeconds = 0.05): Promise<[number, number][]> {
  const { stderr } = await run(FFMPEG(), ["-hide_banner", "-nostats", "-i", file, "-af", `silencedetect=noise=${noiseDb}dB:d=${minSeconds}`, "-f", "null", "-"], { maxBuffer: 64 * 1024 * 1024 });
  const out: [number, number][] = [];
  let start: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = /silence_start: (-?[\d.]+)/.exec(line);
    if (s) start = Math.max(0, Number(s[1]));
    const e = /silence_end: ([\d.]+)/.exec(line);
    if (e && start !== null) {
      out.push([start, Number(e[1])]);
      start = null;
    }
  }
  if (start !== null) out.push([start, Number.POSITIVE_INFINITY]);
  return out;
}

/** The file's samples, scanned once: peaks, RMS, clipping. */
export async function scan(file: string, options: { sampleRate?: number; channels?: number } = {}): Promise<Scan> {
  const sampleRate = options.sampleRate ?? 48000;
  const channels = options.channels ?? 1;
  const per = Math.round(sampleRate * WINDOW);
  const ff = spawn(FFMPEG(), ["-hide_banner", "-nostats", "-v", "error", "-i", file, "-ac", String(channels), "-ar", String(sampleRate), "-f", "f32le", "-"], { stdio: ["ignore", "pipe", "pipe"] });
  const peaks: [number, number][] = [];
  const rms: number[] = [];
  let clipped = 0;
  let count = 0;
  let lo = Infinity;
  let hi = -Infinity;
  let sq = 0;
  let inWindow = 0;
  let carry: Buffer = Buffer.alloc(0);
  let stderr = "";
  ff.stderr.on("data", (d) => (stderr += d));
  for await (const chunk of ff.stdout as AsyncIterable<Buffer>) {
    const buf: Buffer = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    const frameBytes = 4 * channels;
    const whole = buf.length - (buf.length % frameBytes);
    for (let o = 0; o < whole; o += frameBytes) {
      let mixed = 0;
      for (let c = 0; c < channels; c++) {
        const x = buf.readFloatLE(o + 4 * c);
        if (Math.abs(x) >= 0.999) clipped++;
        mixed += x;
      }
      mixed /= channels;
      if (mixed < lo) lo = mixed;
      if (mixed > hi) hi = mixed;
      sq += mixed * mixed;
      count++;
      if (++inWindow === per) {
        peaks.push([lo, hi]);
        rms.push(Math.sqrt(sq / per));
        lo = Infinity; hi = -Infinity; sq = 0; inWindow = 0;
      }
    }
    carry = Buffer.from(buf.subarray(whole));
  }
  const code: number = await new Promise((resolve) => ff.on("close", resolve));
  if (code !== 0) throw new AudioEditError("bad-audio", `${file}: ${stderr.trim().split("\n")[0] || `ffmpeg exited ${code}`}`);
  if (inWindow > 0) {
    peaks.push([lo, hi]);
    rms.push(Math.sqrt(sq / inWindow));
  }
  return { durationSeconds: count / sampleRate, sampleRate, channels, clipped, peaks, rms };
}

/** Everything at once. */
export async function analyzeAudio(file: string, options: { sampleRate?: number; channels?: number } = {}): Promise<Analysis> {
  const [scanned, loud, quiet] = await Promise.all([scan(file, options), loudness(file), silences(file)]);
  return { ...scanned, loudness: loud, silences: quiet.map(([s, e]) => [s, Math.min(e, scanned.durationSeconds)]) };
}

/** The quietest point between two times, by RMS over `smooth` seconds: where a cut or an insert hurts least. */
export function quietestPoint(rms: number[], from: number, to: number, smooth = 0.03): number {
  const a = Math.max(0, Math.floor(from / WINDOW));
  const b = Math.min(rms.length - 1, Math.ceil(to / WINDOW));
  if (b < a) return (from + to) / 2;
  const half = Math.max(0, Math.round(smooth / WINDOW / 2));
  let best = a;
  let bestValue = Infinity;
  for (let i = a; i <= b; i++) {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(rms.length - 1, i + half); j++) { s += rms[j]!; n++; }
    const v = s / n;
    if (v < bestValue) { bestValue = v; best = i; }
  }
  return Math.min(to, Math.max(from, (best + 0.5) * WINDOW));
}
