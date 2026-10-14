// ---------------------------------------------------------------------------
// From a provider's words to a take's WordTiming words (avg-8hs.2)
// ---------------------------------------------------------------------------
// Every aligner returns its own tokens: Qwen drops punctuation, a provider
// may split or merge a word, and the word before a pause tends to swallow
// it. A WordTiming's words are the written text's own tokens. This maps the
// provider's words onto them letter by letter, keeps each word out of the
// silences ffmpeg measures, and makes none shorter than 80 ms — the same for
// every provider, measured on a real recital in the spike (ADR-0038).
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type AlignErrorCode =
  | "no-such-take"
  | "no-edit"
  | "audio-changed"
  | "no-language"
  | "worker-unreachable"
  | "model-unavailable"
  | "aligner-failed"
  | "too-long"
  | "unsupported-language"
  | "bad-audio"
  | "empty-text"
  | "no-key"
  | "auth"
  | "quota"
  | "rate-limited"
  | "bad-request"
  | "server"
  | "unreachable"
  | "uncertain"
  | "budget"
  | "alignment-mismatch";

/** Why a take could not be aligned; nothing was written. */
export class AlignError extends Error {
  constructor(readonly code: AlignErrorCode, message: string) {
    super(message);
    this.name = "AlignError";
  }
}

export interface RawWord {
  text: string;
  start: number;
  end: number;
}

export interface TimedWord {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

/** More than this share of tokens without a word is a failed alignment. */
export const MAX_UNMAPPED_SHARE = 0.1;
/** No word is shorter (seconds). */
export const MIN_WORD_SECONDS = 0.08;
/** What ffmpeg's silencedetect counts as silence. */
export const SILENCE = { noise: "-35dB", seconds: 0.1 } as const;

/** Letters and digits only, lower case, without accents: what two spellings of one word share. */
const letters = (s: string) => [...s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()].filter((c) => /[\p{L}\p{N}]/u.test(c));

/** How far ahead a misread stretch may run before the two texts agree again. */
const RESYNC = 12;
const WINDOW = 3;

/**
 * Pair the letters of the text with the letters of the provider's words, in
 * order; where they disagree (a misheard word), skip ahead on either side to
 * the nearest point where three letters agree again.
 */
function pairLetters(a: string[], b: string[]): [number, number][] {
  const pairs: [number, number][] = [];
  const agree = (i: number, j: number) => {
    for (let k = 0; k < WINDOW; k++) if (i + k >= a.length || j + k >= b.length || a[i + k] !== b[j + k]) return k > 0 && (i + k >= a.length || j + k >= b.length);
    return true;
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i++, j++]);
      continue;
    }
    let best: [number, number] | null = null;
    for (let total = 1; total <= 2 * RESYNC && !best; total++) {
      for (let di = 0; di <= Math.min(total, RESYNC) && !best; di++) {
        const dj = total - di;
        if (dj <= RESYNC && agree(i + di, j + dj)) best = [di, dj];
      }
    }
    // No agreement close by: a substitution, letter for letter.
    const [di, dj] = best ?? [1, 1];
    if (!best) pairs.push([i, j]);
    i += di;
    j += dj;
  }
  return pairs;
}

/**
 * The written text's tokens, each with the time of the provider words its
 * letters matched. A provider word matched by several tokens is shared
 * between them by length; a token nothing matched takes the gap between its
 * neighbours with confidence 0. Throws `alignment-mismatch` when more than
 * one token in ten found no word.
 */
export function mapToText(text: string, raw: RawWord[]): { words: TimedWord[]; unmapped: number[] } {
  const tokens = text.split(/\s+/).filter(Boolean);
  const tokenOf: number[] = [];
  const tokenLetters = tokens.flatMap((t, index) => letters(t).map((c) => (tokenOf.push(index), c)));
  const wordOf: number[] = [];
  const wordLetters = raw.flatMap((w, index) => letters(w.text).map((c) => (wordOf.push(index), c)));

  // shares[token] → Map(word → letters matched)
  const shares = tokens.map(() => new Map<number, number>());
  for (const [i, j] of pairLetters(tokenLetters, wordLetters)) {
    const share = shares[tokenOf[i]!]!;
    share.set(wordOf[j]!, (share.get(wordOf[j]!) ?? 0) + 1);
  }
  // Each word's span, cut between the tokens that matched it, by letters matched.
  const spans: { start: number; end: number }[][] = tokens.map(() => []);
  raw.forEach((word, k) => {
    const claimants = shares.flatMap((share, t) => (share.has(k) ? [[t, share.get(k)!] as const] : []));
    const total = claimants.reduce((sum, [, n]) => sum + n, 0);
    let at = word.start;
    for (const [t, n] of claimants) {
      const end = at + ((word.end - word.start) * n) / total;
      spans[t]!.push({ start: at, end });
      at = end;
    }
  });

  // A token with no letters (a dash, an ellipsis, a guillemet) is not said:
  // it is never unmatched, and it sits in the gap where it is written.
  const said = tokens.map((t) => letters(t).length > 0);
  const unmapped = tokens.flatMap((_, t) => (said[t] && spans[t]!.length === 0 ? [t] : []));
  const saidCount = said.filter(Boolean).length;
  if (unmapped.length > saidCount * MAX_UNMAPPED_SHARE) {
    throw new AlignError("alignment-mismatch", `${unmapped.length} of ${saidCount} words found no match in the aligner's words: is this the right text for this audio?`);
  }
  const words: TimedWord[] = tokens.map((t, i) => {
    const s = spans[i]!;
    if (s.length > 0) return { text: t, start: Math.min(...s.map((x) => x.start)), end: Math.max(...s.map((x) => x.end)) };
    return said[i] ? { text: t, start: Number.NaN, end: Number.NaN, confidence: 0 } : { text: t, start: Number.NaN, end: Number.NaN };
  });
  const placed = (x: TimedWord, i: number) => !Number.isNaN(x.start) && (said[i] || spans[i]!.length > 0);
  // Unmatched words fill the gap between their neighbours; unsaid tokens take no time in it.
  words.forEach((word, i) => {
    if (!Number.isNaN(word.start)) return;
    const before = words.slice(0, i).map((x, k) => [x, k] as const).reverse().find(([x, k]) => placed(x, k))?.[0];
    const after = words.slice(i + 1).map((x, k) => [x, k + i + 1] as const).find(([x, k]) => placed(x, k))?.[0];
    word.start = before?.end ?? after?.start ?? 0;
    word.end = said[i] ? after?.start ?? word.start : word.start;
  });
  // In order, never overlapping.
  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1]!;
    const word = words[i]!;
    word.start = Math.max(word.start, prev.end);
    word.end = Math.max(word.end, word.start);
  }
  return { words: words.map(round), unmapped };
}

const ms = (n: number) => Math.round(n * 1000) / 1000;
function round(w: TimedWord): TimedWord {
  return { ...w, start: ms(w.start), end: ms(w.end) };
}

/**
 * Keep every word out of the silences and at least MIN_WORD_SECONDS long:
 * a silence that falls in a word leaves it the side with more speech (an end
 * running into a pause is clipped, a start before one moves after it); a
 * short word takes time from a long neighbour.
 */
export function snapToSilences(input: TimedWord[], silences: [number, number][], durationSeconds: number): TimedWord[] {
  const words = input.map((w) => ({ ...w }));
  const said = (w: TimedWord) => letters(w.text).length > 0;
  for (const word of words) {
    if (!said(word)) continue;
    for (const [s, e] of silences) {
      if (e <= word.start || s >= word.end) continue;
      // A silence inside the word: the word is the side with more speech.
      const before = s - word.start;
      const after = word.end - e;
      if (before <= 0 && after <= 0) continue; // the whole word inside a silence: left to the aligner
      if (after > before) word.start = Math.max(word.start, e);
      else word.end = Math.min(word.end, s);
    }
  }
  words.forEach((word, i) => {
    if (!said(word) || word.end - word.start >= MIN_WORD_SECONDS) return;
    const next = words[i + 1];
    const prev = words[i - 1];
    if (next && next.end - next.start > 0.2) {
      word.end = word.start + MIN_WORD_SECONDS;
      next.start = Math.max(next.start, word.end);
    } else if (prev && prev.end - prev.start > 0.2) {
      word.start = Math.max(0, word.end - MIN_WORD_SECONDS);
      prev.end = Math.min(prev.end, word.start);
    } else {
      word.end = Math.min(durationSeconds, word.start + MIN_WORD_SECONDS);
      if (next) next.start = Math.max(next.start, word.end);
    }
  });
  // Nothing past the audio's end.
  for (const word of words) {
    word.end = Math.min(word.end, durationSeconds);
    word.start = Math.min(word.start, word.end);
  }
  return words.map(round);
}

/** The silences ffmpeg measures in the audio, the speech between them, and the audio's length. */
export async function measureSilences(audioPath: string): Promise<{ silences: [number, number][]; speech: [number, number][]; durationSeconds: number }> {
  let stderr: string;
  let durationSeconds: number;
  try {
    ({ stderr } = await exec("ffmpeg", ["-hide_banner", "-nostats", "-i", audioPath, "-af", `silencedetect=noise=${SILENCE.noise}:d=${SILENCE.seconds}`, "-f", "null", "-"], { maxBuffer: 16 * 1024 * 1024 }));
    const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audioPath]);
    durationSeconds = Number(stdout.trim());
  } catch (error) {
    throw new AlignError("bad-audio", `ffmpeg could not read ${audioPath}: ${(error as Error).message}`);
  }
  if (!(durationSeconds > 0)) throw new AlignError("bad-audio", `${audioPath} has no duration ffprobe can read`);
  const starts = [...stderr.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Math.max(0, Number(m[1])));
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const silences = starts.map((s, i): [number, number] => [ms(s), ms(ends[i] ?? durationSeconds)]);
  const speech: [number, number][] = [];
  let at = 0;
  for (const [s, e] of silences) {
    if (s - at > 0.02) speech.push([ms(at), ms(s)]);
    at = e;
  }
  if (durationSeconds - at > 0.02) speech.push([ms(at), ms(durationSeconds)]);
  return { silences, speech, durationSeconds };
}

/** Samples per second of a take's energy envelope. */
export const ENERGY_RATE = 30;
/** Decoded at this sample rate to measure it. */
const ENERGY_SAMPLE_RATE = 24000;
/** Frames quieter than this RMS (−50 dBFS) carry no voice: they neither set the scale nor move. */
const ENERGY_FLOOR = 10 ** (-50 / 20);
/** The scale is this percentile of the voiced frames, so one click or plosive does not flatten the rest. */
const ENERGY_PERCENTILE = 0.95;

/**
 * The voice's loudness over time — RMS per 1/30 s, divided by the 95th
 * percentile of the voiced frames and capped at 1 — for what moves with the
 * voice (an actor's mouth). Frames under −50 dBFS are 0; a take with none
 * above it is all 0. As many samples as the take lasts at ENERGY_RATE, the
 * last padded with silence.
 */
export async function measureEnergy(audioPath: string, durationSeconds: number): Promise<{ rate: number; values: number[] }> {
  let pcm: Buffer;
  try {
    ({ stdout: pcm } = await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", audioPath, "-ac", "1", "-ar", String(ENERGY_SAMPLE_RATE), "-f", "s16le", "-"],
      { encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 }));
  } catch (error) {
    throw new AlignError("bad-audio", `ffmpeg could not read ${audioPath}: ${(error as Error).message}`);
  }
  const step = ENERGY_SAMPLE_RATE / ENERGY_RATE;
  const total = pcm.length >> 1;
  const rms = Array.from({ length: Math.round(durationSeconds * ENERGY_RATE) }, (_, i) => {
    let sum = 0;
    const end = Math.min(total, (i + 1) * step);
    for (let j = i * step; j < end; j++) sum += (pcm.readInt16LE(j * 2) / 32768) ** 2;
    return end > i * step ? Math.sqrt(sum / (end - i * step)) : 0;
  });
  const voiced = rms.filter((v) => v >= ENERGY_FLOOR).sort((a, b) => a - b);
  const scale = voiced.length > 0 ? voiced[Math.min(voiced.length - 1, Math.floor(ENERGY_PERCENTILE * voiced.length))]! : 0;
  return { rate: ENERGY_RATE, values: rms.map((v) => (scale > 0 && v >= ENERGY_FLOOR ? ms(Math.min(1, v / scale)) : 0)) };
}

