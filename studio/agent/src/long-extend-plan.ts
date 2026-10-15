// ---------------------------------------------------------------------------
// The plan of a long version: a finished looping master repeated for hours,
// under a music-only soundtrack made from a handful of pieces. Pure: the tool
// (long-extend-tools.ts) measures the pieces and runs ffmpeg; this decides
// which piece plays where, how each one joins the next, and how the hours are
// cut into chunks that render in parallel and join sample-exact.
//
// Ported from the plan that made 03-cahokia-notte's approved 1 h version
// (assets/audio/music-1h.plan.py): pieces drawn from a shuffled bag, never the
// same twice in a row; whole pieces mostly, sometimes a long section; joined
// by a 3–6 s crossfade or a 1–3 s gap; each levelled to the same loudness.
// ---------------------------------------------------------------------------

export const SAMPLE_RATE = 48_000;
/** Seconds of soundtrack one ffmpeg renders; chunks run in parallel. */
export const CHUNK_SECONDS = 600;
/** Loudness each piece is levelled to before the mix is mastered. */
export const PIECE_TARGET_LUFS = -18;
export const MASTER = { lufs: -17, truePeak: -1, fadeIn: 3, fadeOut: 6, codec: "aac", bitrate: "192k" } as const;
/** A piece shorter than this cannot carry a crossfade on both ends. */
export const MIN_PIECE_SECONDS = 15;

export interface Piece {
  /** Name in the plan, from the file name. */
  id: string;
  /** Path relative to the episode. */
  source: string;
  /** The playable stretch: [in, out] seconds, without silent head and tail. */
  region: [number, number];
  measuredLufs: number;
}

export type Transition = { type: "crossfade"; seconds: number } | { type: "gap"; seconds: number } | null;

export interface Clip {
  piece: string;
  source: string;
  in: number;
  out: number;
  len: number;
  /** Where it starts on the soundtrack, seconds. */
  at: number;
  end: number;
  gainDb: number;
  fadeIn: number;
  fadeOut: number;
  transition: Transition;
}

export interface Chunk {
  index: number;
  /** Absolute sample window [startSample, endSample) of the soundtrack. */
  startSample: number;
  endSample: number;
  /** Indexes into the plan's clips that sound inside the window. */
  clips: number[];
}

export interface MusicPlan {
  seed: number;
  durationSeconds: number;
  sampleRate: number;
  clips: Clip[];
  chunks: Chunk[];
  occurrences: Record<string, number>;
}

/** A 32-bit seed from a string (FNV-1a), so an episode's default is stable. */
export function seedFrom(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, and the same sequence on every machine. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const uniform = (rnd: () => number, a: number, b: number) => a + (b - a) * rnd();

/** The gain that brings a piece to the common level; bounded so a near-silent file cannot be blown up. */
export function levelGain(measuredLufs: number, target = PIECE_TARGET_LUFS): number {
  if (!Number.isFinite(measuredLufs)) return 0;
  return r2(Math.min(12, Math.max(-24, target - measuredLufs)));
}

export function planMusic(pieces: Piece[], durationSeconds: number, seed: number, sampleRate = SAMPLE_RATE): MusicPlan {
  if (pieces.length < 2) throw new Error("a long soundtrack needs at least two music pieces, so that no piece follows itself");
  if (new Set(pieces.map((p) => p.id)).size !== pieces.length) throw new Error("two music pieces have the same name");
  for (const p of pieces) {
    if (p.region[1] - p.region[0] < MIN_PIECE_SECONDS) throw new Error(`${p.source} plays for ${(p.region[1] - p.region[0]).toFixed(1)} s, less than ${MIN_PIECE_SECONDS} s`);
  }
  if (!(durationSeconds > 0)) throw new Error("the duration must be positive");

  const rnd = random(seed);
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const clips: Clip[] = [];
  let bag: string[] = [];
  let last: string | null = null;
  let t = 0;
  while (t < durationSeconds) {
    if (bag.length === 0) {
      bag = pieces.map((p) => p.id);
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [bag[i], bag[j]] = [bag[j]!, bag[i]!];
      }
      // A new bag must not open with the piece the last one closed on.
      if (bag[0] === last) bag.push(bag.shift()!);
    }
    const piece = byId.get(bag.shift()!)!;
    const [a, b] = piece.region;
    const length = b - a;
    let s = a;
    let e = b;
    if (!(rnd() < 0.7 || length < 60)) {
      const section = uniform(rnd, 0.6, 0.85) * length;
      s = uniform(rnd, a, b - section);
      e = s + section;
    }
    const naturalIn = Math.abs(s - a) < 1e-6;
    const naturalOut = Math.abs(e - b) < 1e-6;
    let at = 0;
    let transition: Transition = null;
    if (clips.length > 0) {
      const crossfade = rnd() < 0.6;
      const crossfadeSeconds = r2(uniform(rnd, 3, 6));
      const gapSeconds = r2(uniform(rnd, 1, 3));
      // Near the end a gap would leave silence under the closing fade: cross instead.
      if (crossfade || t + gapSeconds >= durationSeconds - MASTER.fadeOut) {
        at = t - crossfadeSeconds;
        transition = { type: "crossfade", seconds: crossfadeSeconds };
      } else {
        at = t + gapSeconds;
        transition = { type: "gap", seconds: gapSeconds };
      }
    }
    at = r3(at);
    s = r3(s);
    e = r3(e);
    const clip: Clip = {
      piece: piece.id,
      source: piece.source,
      in: s,
      out: e,
      len: r3(e - s),
      at,
      end: r3(at + (e - s)),
      gainDb: levelGain(piece.measuredLufs),
      fadeIn: naturalIn ? 0.3 : 3,
      fadeOut: naturalOut ? 2.5 : 4,
      transition,
    };
    if (transition?.type === "crossfade") {
      clip.fadeIn = Math.max(clip.fadeIn, transition.seconds);
      const previous = clips[clips.length - 1]!;
      previous.fadeOut = Math.max(previous.fadeOut, transition.seconds);
    }
    clips.push(clip);
    t = clip.end;
    last = piece.id;
  }

  // The last clip ends exactly where the soundtrack does; the master's fade-out closes it.
  const tail = clips[clips.length - 1]!;
  if (tail.end > durationSeconds) {
    tail.out = r3(tail.in + (durationSeconds - tail.at));
    tail.len = r3(tail.out - tail.in);
    tail.end = durationSeconds;
    tail.fadeOut = Math.max(0, Math.min(tail.fadeOut, tail.len - tail.fadeIn));
  }

  const occurrences: Record<string, number> = Object.fromEntries(pieces.map((p) => [p.id, 0]));
  for (const c of clips) occurrences[c.piece]! += 1;
  return { seed, durationSeconds, sampleRate, clips, chunks: chunkPlan(clips, durationSeconds, sampleRate), occurrences };
}

/**
 * Cuts the soundtrack into windows of CHUNK_SECONDS, in samples: chunk k ends
 * on the sample chunk k+1 starts on, and the last ends on the soundtrack's.
 * Every clip is placed by its absolute first sample, so a clip that crosses a
 * seam renders the same samples on both sides of it.
 */
export function chunkPlan(clips: Clip[], durationSeconds: number, sampleRate = SAMPLE_RATE, chunkSeconds = CHUNK_SECONDS): Chunk[] {
  const total = Math.round(durationSeconds * sampleRate);
  const step = Math.round(chunkSeconds * sampleRate);
  const chunks: Chunk[] = [];
  for (let start = 0, index = 0; start < total; start += step, index++) {
    const end = Math.min(start + step, total);
    const inside = clips
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => clipStartSample(c, sampleRate) < end && clipStartSample(c, sampleRate) + clipSamples(c, sampleRate) > start)
      .map(({ i }) => i);
    chunks.push({ index, startSample: start, endSample: end, clips: inside });
  }
  return chunks;
}

export const clipStartSample = (c: Clip, sampleRate = SAMPLE_RATE) => Math.round(c.at * sampleRate);
export const clipSamples = (c: Clip, sampleRate = SAMPLE_RATE) => Math.round(c.len * sampleRate);

/**
 * The ffmpeg inputs and filter graph of one chunk. Each clip is decoded from
 * its own in-point, conformed, levelled, faded over its whole length, and only
 * then shifted to the window — delayed when it starts inside, trimmed when it
 * started before — so the samples it contributes do not depend on the window.
 */
export function chunkGraph(plan: MusicPlan, chunk: Chunk, resolve: (source: string) => string, headroomDb = 0): { inputs: string[]; graph: string } {
  const sr = plan.sampleRate;
  const inputs: string[] = [];
  const lines: string[] = [];
  const labels: string[] = [];
  const windowSamples = chunk.endSample - chunk.startSample;
  const format = `aresample=${sr},aformat=sample_fmts=fltp:sample_rates=${sr}:channel_layouts=stereo`;
  chunk.clips.forEach((ci, n) => {
    const c = plan.clips[ci]!;
    const length = clipSamples(c, sr);
    const fadeIn = Math.max(1, Math.round(c.fadeIn * sr));
    const fadeOut = Math.max(1, Math.round(c.fadeOut * sr));
    inputs.push("-ss", c.in.toFixed(3), "-t", c.len.toFixed(3), "-i", resolve(c.source));
    const steps = [
      format,
      "highpass=f=80",
      `volume=${c.gainDb}dB`,
      `apad=whole_len=${length}`,
      `atrim=end_sample=${length}`,
      "asetpts=PTS-STARTPTS",
      `afade=t=in:ns=${fadeIn}:curve=qsin`,
      `afade=t=out:ss=${length - fadeOut}:ns=${fadeOut}:curve=qsin`,
    ];
    const offset = clipStartSample(c, sr) - chunk.startSample;
    if (offset > 0) steps.push(`adelay=delays=${offset}S:all=1`);
    else if (offset < 0) steps.push(`atrim=start_sample=${-offset}`, "asetpts=PTS-STARTPTS");
    lines.push(`[${n}:a]${steps.join(",")}[m${n}]`);
    labels.push(`[m${n}]`);
  });
  // The window, its head room, and the loudness the master's gain is computed from.
  const tail = `apad=whole_len=${windowSamples},atrim=end_sample=${windowSamples},volume=${headroomDb}dB,ebur128=peak=true`;
  if (labels.length === 0) {
    // A window no clip reaches (cannot happen with a contiguous plan, but a silent window is still a window).
    lines.push(`anullsrc=r=${sr}:cl=stereo,${tail}[mix]`);
  } else {
    lines.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0:duration=longest,${tail}[mix]`);
  }
  return { inputs, graph: lines.join(";\n") };
}

/**
 * The loudness of a whole made of measured parts: integrated loudness is a
 * mean of energy, so parts combine by their energy weighted by length. Close
 * to what one pass would measure (gating aside) and lets the parts be
 * measured in parallel. True peak is the parts' highest.
 */
export function combineLoudness(parts: Array<{ seconds: number; integrated: number; truePeak: number }>): { integrated: number; truePeak: number } {
  let energy = 0;
  let seconds = 0;
  let truePeak = Number.NEGATIVE_INFINITY;
  for (const p of parts) {
    if (Number.isFinite(p.integrated)) {
      energy += p.seconds * 10 ** (p.integrated / 10);
      seconds += p.seconds;
    }
    if (Number.isFinite(p.truePeak)) truePeak = Math.max(truePeak, p.truePeak);
  }
  return { integrated: seconds > 0 ? 10 * Math.log10(energy / seconds) : Number.NEGATIVE_INFINITY, truePeak };
}

/** The master's audio chain over the joined chunks: gain to the target, a limiter only if the peaks need one, the fades. */
export function masterChain(mix: { integrated: number; truePeak: number }, durationSeconds: number): { gainDb: number; limiter: boolean; filter: string } {
  const gainDb = r2(MASTER.lufs - mix.integrated);
  // alimiter is a sample-peak limiter: set it 1 dB under the true-peak ceiling for the inter-sample overs and the encoder.
  const limiter = mix.truePeak + gainDb > MASTER.truePeak - 0.5;
  const ceiling = (10 ** ((MASTER.truePeak - 1) / 20)).toFixed(4);
  const steps = [
    `volume=${gainDb}dB`,
    ...(limiter ? [`alimiter=limit=${ceiling}:attack=5:release=80:level=disabled:latency=1`] : []),
    `afade=t=in:st=0:d=${MASTER.fadeIn}:curve=qsin`,
    `afade=t=out:st=${r3(durationSeconds - MASTER.fadeOut)}:d=${MASTER.fadeOut}:curve=qsin`,
  ];
  return { gainDb, limiter, filter: steps.join(",") };
}

/** "1", "2.5", "0.25": the hours in a file name. */
export function hoursLabel(durationSeconds: number): string {
  return String(Math.round((durationSeconds / 3600) * 100) / 100);
}
