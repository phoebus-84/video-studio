// Checking a recipe and placing its clips: "after" resolved, crossfades turned
// into overlaps with matching fades, every number checked. Nothing is
// rendered here.

import { AudioEditError } from "./errors.js";
import type { Clip, Placement, Recipe } from "./types.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

const bad = (path: string, message: string): never => {
  throw new AudioEditError("bad-recipe", `${path}: ${message}`, path);
};
const nonNegative = (v: unknown, path: string) => {
  if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) bad(path, "must be a number ≥ 0");
};
const finite = (v: unknown, path: string) => {
  if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v))) bad(path, "must be a number");
};

/** Every problem the recipe's shape has, as an error on the first one. */
export function checkRecipe(recipe: Recipe): void {
  if (!recipe || typeof recipe !== "object") bad("$", "not a recipe");
  const { output, tracks, master } = recipe;
  if (output?.sampleRate !== undefined && ![8000, 16000, 22050, 24000, 32000, 44100, 48000, 96000].includes(output.sampleRate)) bad("$.output.sampleRate", "not a usual rate");
  if (output?.channels !== undefined && output.channels !== 1 && output.channels !== 2) bad("$.output.channels", "must be 1 or 2");
  if (!Array.isArray(tracks) || tracks.length === 0) bad("$.tracks", "needs at least one track");
  const trackIds = new Set<string>();
  tracks.forEach((track, t) => {
    const tp = `$.tracks[${t}]`;
    if (!ID.test(track.id ?? "")) bad(`${tp}.id`, "letters, digits, . _ - (at most 64)");
    if (trackIds.has(track.id)) bad(`${tp}.id`, `"${track.id}" is used twice`);
    trackIds.add(track.id);
    finite(track.gain, `${tp}.gain`);
    if (!Array.isArray(track.clips) || track.clips.length === 0) bad(`${tp}.clips`, "needs at least one clip");
    const clipIds = new Set<string>();
    track.clips.forEach((clip, c) => {
      const cp = `${tp}.clips[${c}]`;
      if (!ID.test(clip.id ?? "")) bad(`${cp}.id`, "letters, digits, . _ - (at most 64)");
      if (clipIds.has(clip.id)) bad(`${cp}.id`, `"${clip.id}" is used twice in its track`);
      clipIds.add(clip.id);
      if (typeof clip.source !== "string" || !clip.source) bad(`${cp}.source`, "names no file");
      nonNegative(clip.in, `${cp}.in`);
      nonNegative(clip.out, `${cp}.out`);
      if (clip.in !== undefined && clip.out !== undefined && clip.out <= clip.in) bad(`${cp}.out`, "must come after in");
      if (clip.at !== "after") nonNegative(clip.at, `${cp}.at`);
      if (clip.at === "after" && c === 0) bad(`${cp}.at`, "the first clip of a track has nothing to come after");
      finite(clip.gain, `${cp}.gain`);
      nonNegative(clip.fadeIn, `${cp}.fadeIn`);
      nonNegative(clip.fadeOut, `${cp}.fadeOut`);
      nonNegative(clip.crossfade, `${cp}.crossfade`);
      if (clip.crossfade && c === 0) bad(`${cp}.crossfade`, "the first clip of a track has nothing to cross into");
      if (clip.crossfade && clip.at !== "after") bad(`${cp}.crossfade`, 'a crossfade overlaps the clip before: it needs at: "after"');
      if (clip.automation !== undefined) {
        if (!Array.isArray(clip.automation) || clip.automation.length === 0) bad(`${cp}.automation`, "a list of [seconds, dB] points");
        let last = -1;
        clip.automation.forEach((pt, k) => {
          if (!Array.isArray(pt) || pt.length !== 2 || !pt.every((n) => typeof n === "number" && Number.isFinite(n))) bad(`${cp}.automation[${k}]`, "a [seconds, dB] point");
          if (pt[0] < 0 || pt[0] <= last) bad(`${cp}.automation[${k}]`, "times must start at 0 or later and grow");
          last = pt[0];
        });
      }
    });
  });
  tracks.forEach((track, t) => {
    if (!track.duck) return;
    if (!trackIds.has(track.duck.under) || track.duck.under === track.id) bad(`$.tracks[${t}].duck.under`, "names no other track");
    if (typeof track.duck.gain !== "number" || !(track.duck.gain < 0)) bad(`$.tracks[${t}].duck.gain`, "a negative number of dB");
    nonNegative(track.duck.attack, `$.tracks[${t}].duck.attack`);
    nonNegative(track.duck.release, `$.tracks[${t}].duck.release`);
  });
  if (master) {
    finite(master.gain, "$.master.gain");
    if (master.loudness !== undefined && (typeof master.loudness !== "number" || master.loudness > -5 || master.loudness < -70)) bad("$.master.loudness", "LUFS between -70 and -5");
    if (master.truePeak !== undefined && (typeof master.truePeak !== "number" || master.truePeak > 0 || master.truePeak < -9)) bad("$.master.truePeak", "dBTP between -9 and 0");
    nonNegative(master.trim?.head, "$.master.trim.head");
    nonNegative(master.trim?.tail, "$.master.trim.tail");
    nonNegative(master.fadeIn, "$.master.fadeIn");
    nonNegative(master.fadeOut, "$.master.fadeOut");
  }
}

/** Where every clip lands, given its source's duration. */
export function place(recipe: Recipe, durations: Record<string, number>): Placement[] {
  checkRecipe(recipe);
  const out: Placement[] = [];
  recipe.tracks.forEach((track, t) => {
    let previous: Placement | undefined;
    let beforePrevious: Placement | undefined;
    track.clips.forEach((clip: Clip, c) => {
      const cp = `$.tracks[${t}].clips[${c}]`;
      const length = durations[clip.source];
      if (length === undefined) throw new AudioEditError("missing-source", `${cp}.source: ${clip.source} has no known duration`, `${cp}.source`);
      const from = clip.in ?? 0;
      const to = clip.out ?? length;
      if (from >= length) bad(`${cp}.in`, `${from} s is past the end of ${clip.source} (${r6(length)} s)`);
      if (to > length + 1e-3) bad(`${cp}.out`, `${to} s is past the end of ${clip.source} (${r6(length)} s)`);
      const span = Math.min(to, length) - from;
      const crossfade = clip.crossfade ?? 0;
      if (crossfade > 0 && previous && (crossfade > span || crossfade > previous.end - previous.start)) {
        bad(`${cp}.crossfade`, `${crossfade} s is longer than a clip it joins`);
      }
      const start = clip.at === "after" ? previous!.end - crossfade : clip.at;
      if (start < 0) bad(`${cp}.crossfade`, "would start the clip before the output does");
      const placed: Placement = {
        track: track.id, clip: clip.id, source: clip.source, in: r6(from), out: r6(from + span),
        start: r6(start), end: r6(start + span), fadeIn: r6(Math.max(clip.fadeIn ?? 0, crossfade)), fadeOut: r6(clip.fadeOut ?? 0),
      };
      if (crossfade > 0 && previous) {
        previous.fadeOut = r6(Math.max(previous.fadeOut, crossfade));
        // The clip before now fades both ways: its fades must still fit it.
        if (previous.fadeIn + previous.fadeOut > previous.end - previous.start + 1e-6) bad(`${cp}.crossfade`, `with the crossfade before it, ${previous.clip}'s fades are longer than ${previous.clip}`);
      }
      // A crossfade overlaps one clip, never two.
      if (beforePrevious && placed.start < beforePrevious.end - 1e-6) bad(`${cp}.crossfade`, `reaches back into ${beforePrevious.clip}, two clips before`);
      if (placed.fadeIn + placed.fadeOut > span + 1e-6) bad(`${cp}`, "its fades are longer than the clip");
      out.push(placed);
      beforePrevious = previous;
      previous = placed;
    });
  });
  return out;
}
