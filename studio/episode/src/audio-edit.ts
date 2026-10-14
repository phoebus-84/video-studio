// ---------------------------------------------------------------------------
// Audio editing in a workspace (avg-8hs.5)
// ---------------------------------------------------------------------------
// A recipe here may name takes as sources, cut on words, and reshape pauses;
// it is resolved to @av/audio-edit's time-only recipe:
// - a cut on a word falls at the quietest point of the gap beside it, never
//   inside a word;
// - a pause lengthened gets the take's own room tone (its quietest stretch,
//   repeated with crossfades) inserted at its quietest point; a pause
//   shortened loses time there, never closer than 40 ms to a word.
// The file is rendered, and <output>.edit.json beside it records the recipe,
// what it resolved to, every input and the output by hash, where each clip
// went, the report, and the words the output carries — carried through the
// edit from the takes' timings, so an edited take needs no new alignment.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { quietestPoint, renderRecipe, scan, type Clip, type Master, type Recipe, type Track } from "@av/audio-edit";
import { EDIT_SUFFIX, PEAKS_SUFFIX, validateAudioEdit, type AudioEditPlacement, type AudioEditRecord } from "@studio/contracts/src/audio-edits.mjs";

export type WordRef = number | string | { word: number | string; occurrence?: number };
export interface WordAnchor { word: number | string; occurrence?: number; edge: "start" | "end" }

export interface EditClip extends Omit<Clip, "source" | "in" | "out"> {
  source: { take: string } | { path: string };
  in?: number | WordAnchor;
  out?: number | WordAnchor;
}
export interface EditTrack extends Omit<Track, "clips"> { clips: EditClip[] }
export interface EditRecipe {
  /** Where the file goes, relative to the workspace: assets/takes, assets/sounds or artifacts/audio. */
  output: { path: string; sampleRate?: number; channels?: 1 | 2 };
  tracks: EditTrack[];
  /** Pauses after words of a take, to this many seconds. */
  pauses?: { take: string; after: WordRef; seconds: number }[];
  master?: Master;
}

export class EditError extends Error {
  constructor(readonly code: "bad-recipe" | "no-such-take" | "audio-changed" | "no-timing" | "stale-timing" | "no-such-word" | "no-room", message: string, readonly path?: string) {
    super(message);
    this.name = "EditError";
  }
}

const TAKES_PATH = "artifacts/narration/takes.json";
const OUTPUT_DIRS = ["assets/takes/", "assets/sounds/", "artifacts/audio/"];
/** Gaps narrower than this hold no clean cut. */
const MIN_GAP = 0.02;
/** A shortened pause keeps at least this much on each side. */
const WORD_GUARD = 0.04;
/** The crossfade at a cut inside a take, and between room-tone repeats. */
const SPLICE = 0.012;
const ROOM_TONE = 0.2;

const sha256 = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const norm = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

interface TakeInfo {
  id: string;
  path: string;
  words: { text: string; start: number; end: number }[];
  duration: number;
  rms: number[];
  /** It has a timing, but not of this audio, or not readable. */
  stale?: boolean;
}

/** A file the recipe names, inside the workspace once links are followed. */
function inside(dir: string, path: string, where: string): string {
  const full = resolve(dir, path);
  if (isAbsolute(path) || !existsSync(full)) throw new EditError("bad-recipe", `${where}: ${path} is not a file of this workspace`, where);
  const real = realpathSync(full);
  if (!real.startsWith(realpathSync(dir) + sep)) throw new EditError("bad-recipe", `${where}: ${path} leads out of this workspace`, where);
  return real;
}

/** The index of a word in a take, by index, by text, or by text and occurrence (1-based). */
function wordIndex(take: TakeInfo, ref: WordRef, where: string): number {
  const word = typeof ref === "object" ? ref.word : ref;
  const named = typeof ref === "object" ? ref.occurrence : undefined;
  const occurrence = named ?? 1;
  if (typeof word === "number") {
    if (!Number.isInteger(word) || word < 0 || word >= take.words.length) throw new EditError("no-such-word", `${where}: take "${take.id}" has no word ${word} (it has ${take.words.length})`, where);
    return word;
  }
  const matches = take.words.map((w, i) => (norm(w.text) === norm(word) ? i : -1)).filter((i) => i >= 0);
  if (matches.length === 0) throw new EditError("no-such-word", `${where}: take "${take.id}" never says «${word}»`, where);
  if (named === undefined && matches.length > 1) {
    throw new EditError("no-such-word", `${where}: take "${take.id}" says «${word}» ${matches.length} times: name it as { word: "${word}", occurrence: n }`, where);
  }
  const at = matches[occurrence - 1];
  if (at === undefined) throw new EditError("no-such-word", `${where}: take "${take.id}" says «${word}» only ${matches.length} times`, where);
  return at;
}

/** A gain curve seen from `offset` seconds into it: its value there becomes its first point. */
function shiftCurve(points: [number, number][], offset: number): [number, number][] {
  if (offset <= 0) return points;
  const at = (t: number) => {
    if (t <= points[0]![0]) return points[0]![1];
    for (let k = 1; k < points.length; k++) {
      const [t0, v0] = points[k - 1]!;
      const [t1, v1] = points[k]!;
      if (t < t1) return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
    return points[points.length - 1]![1];
  };
  return [[0, r6(at(offset))], ...points.filter(([t]) => t > offset + 1e-6).map(([t, v]) => [r6(t - offset), v] as [number, number])];
}

/** Where to cut beside a word: the quietest point of the gap before its start, or after its end. */
function cutAt(take: TakeInfo, anchor: WordAnchor, where: string, concerns: string[]): number {
  const i = wordIndex(take, anchor, where);
  const [from, to] = anchor.edge === "start"
    ? [i > 0 ? take.words[i - 1]!.end : 0, take.words[i]!.start]
    : [take.words[i]!.end, i + 1 < take.words.length ? take.words[i + 1]!.start : take.duration];
  if (to - from < MIN_GAP) {
    concerns.push(`${where}: no pause ${anchor.edge === "start" ? "before" : "after"} «${take.words[i]!.text}» in take "${take.id}" (${Math.round((to - from) * 1000)} ms): the cut may be heard`);
    return anchor.edge === "start" ? take.words[i]!.start : take.words[i]!.end;
  }
  return quietestPoint(take.rms, from, to);
}

/** The take's quietest stretch of ROOM_TONE seconds, inside a pause between words when it has one. */
function roomTone(take: TakeInfo, concerns: string[]): [number, number] {
  let best: [number, number] | null = null;
  let bestRms = Infinity;
  const windows = ROOM_TONE / 0.01;
  const consider = (from: number, to: number) => {
    for (let t = from; t + ROOM_TONE <= to; t += 0.01) {
      const a = Math.round(t / 0.01);
      let s = 0;
      for (let k = a; k < a + windows && k < take.rms.length; k++) s += take.rms[k]!;
      if (s < bestRms) { bestRms = s; best = [t, t + ROOM_TONE]; }
    }
  };
  for (let i = 1; i < take.words.length; i++) consider(take.words[i - 1]!.end + 0.03, take.words[i]!.start - 0.03);
  if (!best) {
    concerns.push(`take "${take.id}" has no pause of ${ROOM_TONE + 0.06} s between words: its room tone was taken from its quietest stretch anywhere, which may hold breath or speech`);
    consider(0, take.duration);
  }
  if (!best) throw new EditError("no-room", `take "${take.id}" has no ${ROOM_TONE} s of quiet to lengthen a pause with`);
  return best;
}

/**
 * Turn the workspace recipe into @av/audio-edit's: takes to their audio
 * files, words to seconds, pauses to splices and room tone.
 */
export async function resolveEdit(dir: string, recipe: EditRecipe): Promise<{ resolved: Recipe; takes: Map<string, TakeInfo>; clipTakes: Map<string, string>; roomOf: Map<string, string>; pieceOf: Map<string, string>; inputs: Record<string, string>; concerns: string[]; reshaped: { take: string; word: string; before: number; after: number; p: number; delta: number }[] }> {
  if (!recipe?.output?.path || !OUTPUT_DIRS.some((d) => recipe.output.path.startsWith(d)) || recipe.output.path.includes("..")) {
    throw new EditError("bad-recipe", `$.output.path: an edit writes into ${OUTPUT_DIRS.join(", ")}`, "$.output.path");
  }
  if (!Array.isArray(recipe.tracks) || recipe.tracks.length === 0 || !recipe.tracks.every((t) => t && Array.isArray(t.clips))) {
    throw new EditError("bad-recipe", "$.tracks: a list of tracks, each with its clips", "$.tracks");
  }
  const takesDoc = existsSync(join(dir, TAKES_PATH)) ? JSON.parse(readFileSync(join(dir, TAKES_PATH), "utf-8")) : { takes: [] };
  const takes = new Map<string, TakeInfo>();
  const inputs: Record<string, string> = {};
  const concerns: string[] = [];
  const read = (path: string, where: string) => {
    const full = inside(dir, path, where);
    const rel = relative(realpathSync(dir), full).split(sep).join("/");
    inputs[rel] = sha256(readFileSync(full));
    return rel;
  };
  const takeOf = async (id: string, where: string): Promise<TakeInfo> => {
    const known = takes.get(id);
    if (known) return known;
    const take = (takesDoc.takes ?? []).find((t: any) => t?.id === id);
    if (!take) throw new EditError("no-such-take", `${where}: ${TAKES_PATH} has no take "${id}"`, where);
    const audio = read(take.audio.path, where);
    if (inputs[audio] !== take.audio.hash) throw new EditError("audio-changed", `${where}: ${take.audio.path} is not the audio take "${id}" recorded: register the take again`, where);
    let words: TakeInfo["words"] = [];
    let stale = false;
    if (take.timing?.path) {
      const timingPath = read(take.timing.path, where);
      let timing: any = null;
      try { timing = JSON.parse(readFileSync(join(dir, timingPath), "utf-8")); } catch { /* stale below */ }
      if (inputs[timingPath] === take.timing.hash && timing?.audio?.hash === take.audio.hash && Array.isArray(timing?.words)) {
        words = timing.words.filter((w: any) => typeof w?.text === "string" && Number.isFinite(w.start) && Number.isFinite(w.end));
      } else stale = true;
    }
    const scanned = await scan(join(dir, audio));
    const info: TakeInfo = { id, path: audio, words, duration: scanned.durationSeconds, rms: scanned.rms, stale };
    takes.set(id, info);
    return info;
  };
  const needWords = (take: TakeInfo, where: string) => {
    if (take.stale) throw new EditError("stale-timing", `${where}: take "${take.id}"'s timing is not of its audio (or unreadable): align it again (pva_align_take)`, where);
    if (take.words.length === 0) throw new EditError("no-timing", `${where}: take "${take.id}" has no timing to cut on words: align it first (pva_align_take)`, where);
  };

  // Pauses, by take: where each falls, and how much it changes.
  const pausesByTake = new Map<string, { at: number; delta: number; where: string; word: string; used?: boolean }[]>();
  /** What each reshaped pause was and became, for the record. */
  const reshaped: { take: string; word: string; before: number; after: number; p: number; delta: number }[] = [];
  for (const [k, p] of (recipe.pauses ?? []).entries()) {
    const where = `$.pauses[${k}]`;
    if (typeof p.seconds !== "number" || !(p.seconds >= 0)) throw new EditError("bad-recipe", `${where}.seconds: a number of seconds ≥ 0`, where);
    const take = await takeOf(p.take, where);
    needWords(take, where);
    const i = wordIndex(take, p.after, `${where}.after`);
    if (i + 1 >= take.words.length) throw new EditError("no-such-word", `${where}.after: «${take.words[i]!.text}» is the last word: no pause after it`, where);
    const from = take.words[i]!.end;
    const to = take.words[i + 1]!.start;
    const current = Math.max(0, to - from);
    const at = current >= 2 * WORD_GUARD ? quietestPoint(take.rms, from + WORD_GUARD, to - WORD_GUARD) : (from + to) / 2;
    let delta = p.seconds - current;
    if (delta < 0) {
      const room = Math.max(0, current - 2 * WORD_GUARD);
      if (-delta > room) {
        concerns.push(`${where}: the pause after «${take.words[i]!.text}» can only shrink to ${(current - room).toFixed(2)} s without touching the words`);
        delta = -room;
      }
    }
    if (Math.abs(delta) >= 0.005) {
      pausesByTake.set(take.id, [...(pausesByTake.get(take.id) ?? []), { at, delta, where, word: take.words[i]!.text }]);
      reshaped.push({ take: take.id, word: take.words[i]!.text, before: r6(current), after: r6(current + delta), p: at, delta });
    }
  }

  // Clips: sources to paths, anchors to seconds, then split at the pauses they hold.
  const clipTakes = new Map<string, string>();
  /** Room-tone pieces: cut from a take, but carrying none of its words. */
  const roomOf = new Map<string, string>();
  /** Every piece a pause made, by "track/piece", to the clip it was cut from. */
  const pieceOf = new Map<string, string>();
  const tracks: Track[] = [];
  for (const [t, track] of recipe.tracks.entries()) {
    const clips: Clip[] = [];
    for (const [c, clip] of track.clips.entries()) {
      const where = `$.tracks[${t}].clips[${c}]`;
      const { source, in: from, out: to, ...rest } = clip;
      if ("take" in source) {
        const take = await takeOf(source.take, `${where}.source`);
        const cut = (v: number | WordAnchor | undefined, field: string) => {
          if (v === undefined || typeof v === "number") return v;
          needWords(take, `${where}.${field}`);
          return cutAt(take, v, `${where}.${field}`, concerns);
        };
        const a = cut(from, "in") ?? 0;
        const b = cut(to, "out") ?? take.duration;
        const pauses = (pausesByTake.get(take.id) ?? []).filter((p) => p.at > a + WORD_GUARD && p.at < b - WORD_GUARD).sort((x, y) => x.at - y.at);
        for (const p of pauses) p.used = true;
        // The clip in pieces: up to each pause, the room tone it gains (or the time it loses), on to the next.
        const pieces: { room: boolean; in: number; out: number }[] = [];
        let start = a;
        for (const p of pauses) {
          if (p.delta > 0) {
            pieces.push({ room: false, in: start, out: p.at });
            // Each room-tone piece overlaps the one before by SPLICE, and the take's next piece overlaps the last:
            // the pieces must add up to delta + SPLICE beyond their own overlaps.
            const [r0, r1] = roomTone(take, concerns);
            const need = p.delta + SPLICE;
            let filled = 0;
            while (filled < need - 1e-6) {
              const len = Math.max(Math.min(r1 - r0, need - filled + SPLICE), 2 * SPLICE + 0.001);
              pieces.push({ room: true, in: r0, out: r0 + len });
              filled += len - SPLICE;
            }
            start = p.at;
          } else {
            // The splice's own crossfade takes SPLICE: cut that much less.
            const removed = -p.delta - SPLICE;
            if (removed <= 0) continue;
            pieces.push({ room: false, in: start, out: p.at - removed / 2 });
            start = p.at + removed / 2;
          }
        }
        pieces.push({ room: false, in: start, out: b });
        // The clip's own placement and fade-in go to its first piece, its fade-out to its last, its gain to all;
        // its automation continues across the pieces, each shifted to where it starts.
        const { gain, fadeIn, fadeOut, automation, crossfade, at } = rest as Clip;
        let offset = 0;
        pieces.forEach((piece, k) => {
          const id = k === 0 ? clip.id : piece.room ? `${clip.id}.room${k}` : `${clip.id}.${k}`;
          const last = k === pieces.length - 1;
          clips.push({
            id, source: take.path, in: r6(piece.in), out: r6(piece.out),
            ...(k === 0 ? { at, ...(crossfade ? { crossfade } : {}), ...(fadeIn ? { fadeIn } : {}) } : { at: "after" as const, crossfade: SPLICE }),
            ...(gain ? { gain } : {}),
            ...(last && fadeOut ? { fadeOut } : {}),
            ...(automation?.length ? { automation: shiftCurve(automation, offset) } : {}),
          } as Clip);
          (piece.room ? roomOf : clipTakes).set(`${track.id}/${id}`, take.id);
          pieceOf.set(`${track.id}/${id}`, clip.id);
          offset += piece.out - piece.in - (k + 1 < pieces.length ? SPLICE : 0);
        });
      } else {
        const path = read(source.path, `${where}.source`);
        if (typeof from === "object" || typeof to === "object") throw new EditError("bad-recipe", `${where}: only a take's clip can cut on words`, where);
        clips.push({ ...rest, id: clip.id, source: path, ...(from !== undefined ? { in: from } : {}), ...(to !== undefined ? { out: to } : {}) } as Clip);
      }
    }
    tracks.push({ ...track, clips } as Track);
  }
  for (const [takeId, list] of pausesByTake) {
    for (const p of list) if (!p.used) concerns.push(`${p.where}: the pause after «${p.word}» in take "${takeId}" is in no clip of the recipe (or at a cut): nothing was reshaped`);
  }
  if (inputs[recipe.output.path] !== undefined || (takesDoc.takes ?? []).some((t: any) => t?.audio?.path === recipe.output.path)) {
    throw new EditError("bad-recipe", `$.output.path: ${recipe.output.path} is a file the edit reads, or a take's audio: write a new file`, "$.output.path");
  }
  const resolved: Recipe = {
    output: { ...(recipe.output.sampleRate ? { sampleRate: recipe.output.sampleRate } : {}), ...(recipe.output.channels ? { channels: recipe.output.channels } : {}) },
    tracks,
    ...(recipe.master ? { master: recipe.master } : {}),
  };
  return { resolved, takes, clipTakes, roomOf, pieceOf, inputs, concerns, reshaped };
}

/** The words the output carries: each take clip's words, moved to where the clip landed. */
function carriedWords(placements: AudioEditPlacement[], takes: Map<string, TakeInfo>, clipTakes: Map<string, string>, duration: number) {
  const out: { text: string; start: number; end: number }[] = [];
  for (const p of placements) {
    const takeId = clipTakes.get(`${p.track}/${p.clip}`);
    const take = takeId ? takes.get(takeId) : undefined;
    if (!take) continue;
    for (const w of take.words) {
      if (w.start >= p.in - 1e-6 && w.end <= p.out + 1e-6) {
        const start = r6(p.start + (w.start - p.in));
        const end = r6(p.start + (w.end - p.in));
        if (start >= 0 && end <= duration + 0.05) out.push({ text: w.text, start, end: Math.min(end, r6(duration)) });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Render a workspace recipe: the file, <output>.edit.json beside it, and
 * <output>.peaks.json (min/max per 10 ms) for drawing it.
 */
export async function editAudio(dir: string, recipe: EditRecipe, options: { now?: () => Date } = {}): Promise<{ record: AudioEditRecord; recordPath: string }> {
  const { resolved, takes, clipTakes, roomOf, pieceOf, inputs, concerns, reshaped } = await resolveEdit(dir, recipe);
  // The joins inside a clip a pause split are splices of its own room tone: measured against silence, never a jump to report.
  const ownSplice = (j: { track: string; before: string; after: string }) => {
    const a = pieceOf.get(`${j.track}/${j.before}`);
    return a !== undefined && a === pieceOf.get(`${j.track}/${j.after}`);
  };
  const outputPath = join(dir, recipe.output.path);
  const result = await renderRecipe(resolved, { root: dir, output: outputPath });
  const placements: AudioEditPlacement[] = result.placements.map((p) => {
    const take = clipTakes.get(`${p.track}/${p.clip}`) ?? roomOf.get(`${p.track}/${p.clip}`);
    return { ...p, ...(take ? { take } : {}) };
  });
  // Room-tone pieces carry no words; every other piece of a take does.
  const record: AudioEditRecord = {
    apiVersion: "studio.video/v1alpha1",
    kind: "AudioEdit",
    recipe: recipe as unknown as Record<string, unknown>,
    resolved: resolved as unknown as Record<string, unknown>,
    inputs,
    output: { path: recipe.output.path, hash: result.sha256, durationSeconds: r6(result.durationSeconds) },
    placements,
    report: {
      loudness: {
        integrated: Number.isFinite(result.loudness.integrated) ? result.loudness.integrated : null,
        range: Number.isFinite(result.loudness.range) ? result.loudness.range : null,
        truePeak: Number.isFinite(result.loudness.truePeak) ? result.loudness.truePeak : null,
      },
      normalization: result.normalization, clipped: result.clipped, headTrim: result.headTrim,
      joins: result.joins.filter((j) => !ownSplice(j)),
      concerns: [...concerns, ...result.concerns.filter((c) => !result.joins.some((j) => ownSplice(j) && c.includes(`(${j.track}: ${j.before} → ${j.after})`)))],
    },
    ...(takes.size > 0 ? { words: carriedWords(result.placements, takes, clipTakes, result.durationSeconds) } : {}),
    // Each reshaped pause where it falls: the end of the take's piece that stops at it.
    ...(reshaped.length > 0 ? { pauses: reshaped.flatMap((r) => {
      const slack = Math.max(0, -r.delta) / 2 + 0.002;
      const piece = result.placements.find((p) => clipTakes.get(`${p.track}/${p.clip}`) === r.take && Math.abs(p.out - r.p) <= slack);
      return piece ? [{ take: r.take, word: r.word, before: r.before, after: r.after, at: piece.end }] : [];
    }) } : {}),
    createdAt: (options.now?.() ?? new Date()).toISOString(),
  };
  const problems = validateAudioEdit(record);
  if (problems.length > 0) throw new Error(`the edit's record is not valid: ${problems.map((p) => `${p.path} ${p.message}`).join("; ")}`);
  const recordPath = `${recipe.output.path}${EDIT_SUFFIX}`;
  const write = (rel: string, text: string) => {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(`${full}.tmp`, text);
    renameSync(`${full}.tmp`, full);
  };
  write(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  const scanned = await scan(outputPath, { sampleRate: resolved.output.sampleRate ?? 48000 });
  write(`${recipe.output.path}${PEAKS_SUFFIX}`, `${JSON.stringify({ window: 0.01, peaks: scanned.peaks.map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000]) })}\n`);
  return { record, recordPath };
}

/** The edit record that made this file, by the file's hash; null when no edit made it. */
export function editRecordFor(dir: string, hash: string): { path: string; record: AudioEditRecord } | null {
  const found: { path: string; record: AudioEditRecord }[] = [];
  const walk = (rel: string) => {
    const full = join(dir, rel);
    if (!existsSync(full)) return;
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith(EDIT_SUFFIX)) {
        try {
          const record = JSON.parse(readFileSync(join(dir, child), "utf-8")) as AudioEditRecord;
          if (record?.output?.hash === hash && validateAudioEdit(record).length === 0) found.push({ path: child, record });
        } catch { /* not a record */ }
      }
    }
  };
  for (const root of ["assets", "artifacts"]) walk(root);
  return found[0] ?? null;
}
