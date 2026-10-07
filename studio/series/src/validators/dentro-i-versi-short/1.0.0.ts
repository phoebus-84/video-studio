// dentro-i-versi-short@1.0.0 (validator) — released: never edit this file; add dentro-i-versi-short/<next>.ts instead.
//
// The mechanical rules of the Dentro i versi short, checked on the timeline
// that is about to be rendered — hand edits included — with what the
// compiler makes of the same inputs as the reference. A hand edit may move
// an effect or a light; it may not change the verses on screen, the kits,
// the voice, the profile or the loop (teleport in and out). Everything this
// version does is in this file, and its golden cases fail if its findings
// ever change.

import { layoutUnit } from "@studio/contracts/src/narration-takes.mjs";
import type { EditTimeline, Finding, SeriesValidator, ValidateInput } from "../../types.js";

/** 25 s at 30 fps. */
const MIN_FRAMES = 750;
/** 90 s at 30 fps. */
const MAX_FRAMES = 2700;
/** The kits of the format, at the versions this release draws with. */
const KITS = ["museum-hall", "room-effect", "verse-plate", "interprete", "lower-third", "title-chip", "brand-mark"].map((n) => `${n}@1.0.0`);
const APPARITIONS = new Set(["apparizione", "fantasma"]);
const APPARITION_COUNT = 2;
const APPARITION_SECONDS = 5;
/** Between the end of the title and the first word of the poem. */
const TITLE_PAUSE: [number, number] = [0.8, 1.4];

interface Data {
  verses: { text: string }[];
}

type Item = Record<string, any>;

const collapse = (text: string) => text.trim().split(/\s+/).join(" ");

/** JSON with sorted keys: equal values give equal text whatever their key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validate(input: ValidateInput): Finding[] {
  const { timeline, compiled } = input;
  const data = input.spec.data as unknown as Data;
  const findings: Finding[] = [];
  const error = (code: string, path: string, message: string) => findings.push({ code, severity: "error", path, message });
  const warning = (code: string, path: string, message: string) => findings.push({ code, severity: "warning", path, message });

  // Every visual item with the track and item index that locates it.
  const visual: { item: Item; path: string }[] = [];
  timeline.tracks.forEach((track, i) => {
    if (track.type === "visual") (track.items as Item[]).forEach((item, j) => visual.push({ item, path: `$.tracks[${i}].items[${j}]` }));
  });
  const kitOf = (item: Item) => `${item.kit?.name}@${item.kit?.version}`;
  const withKit = (name: string) => visual.filter(({ item }) => item.kit?.name === name);

  // ── Errors ────────────────────────────────────────────────────────────────
  if (canonical(timeline.profile) !== canonical(compiled.profile)) {
    error("profile-changed", "$.profile", `the profile is ${timeline.profile.id}; this template renders ${compiled.profile.id}`);
  }
  if (timeline.fps !== compiled.fps) {
    error("fps-changed", "$.fps", `the timeline plays at ${timeline.fps} fps; this template renders ${compiled.fps}`);
  }
  const frames = timeline.durationInFrames;
  if (frames < MIN_FRAMES || frames > MAX_FRAMES) {
    error("duration-range", "$.durationInFrames", `${(frames / 30).toFixed(1)} s is outside 25–90 s: the poem and its applause decide the length, not the timeline`);
  }

  // Every track of the format plays.
  timeline.tracks.forEach((track, i) => {
    if (track.hidden || track.muted) {
      error("hidden-track", `$.tracks[${i}]`, `track "${track.id}" is ${track.hidden ? "hidden" : "muted"}: every track of this format plays`);
    }
  });

  for (const { item, path } of visual) {
    if (item.kit && !KITS.includes(kitOf(item))) {
      error("forbidden-kit", `${path}.kit`, `"${item.id}" uses ${kitOf(item)}; this format draws only with ${KITS.join(", ")}`);
    }
  }

  // The verses on screen are the spec's, every one of them (UP-59).
  const verses = data.verses.map((v) => collapse(v.text));
  const plates = withKit("verse-plate");
  for (const { item, path } of plates) {
    const text = collapse(String(item.props?.text ?? ""));
    if (!verses.includes(text)) error("verse-text", `${path}.props.text`, `"${text}" is not a verse of the poem: change the spec, not the plate`);
  }
  // Counted: a refrain said twice needs two plates.
  const shown = new Map<string, number>();
  for (const { item } of plates) {
    const text = collapse(String(item.props?.text ?? ""));
    shown.set(text, (shown.get(text) ?? 0) + 1);
  }
  verses.forEach((text, k) => {
    const left = shown.get(text) ?? 0;
    if (left === 0) error("missing-verse", `$.data.verses[${k}]`, `verse ${k + 1} ("${text}") has no plate`);
    else shown.set(text, left - 1);
  });

  // The actor arrives and leaves by teleport: first and last frame are the empty hall.
  const actors = withKit("interprete");
  if (actors.length === 0) error("missing-actor", "$.tracks", "no interprete: the poem is recited by the actor");
  for (const { item, path } of actors) {
    const teleport = item.props?.teleport;
    if (!teleport?.in || !teleport?.out) {
      error("missing-teleport", `${path}.props.teleport`, `"${item.id}" does not teleport ${!teleport?.in ? "in" : "out"}: the first and the last frame are the empty hall`);
      continue;
    }
    // Times are from the item's start: the actor arrives after the first frame and is gone by the last.
    const end = item.duration / timeline.fps;
    if (teleport.in.at < 0) {
      error("loop-broken", `${path}.props.teleport.in`, `"${item.id}" arrives at ${teleport.in.at} s: the first frame must be the empty hall`);
    }
    if (teleport.out.at + teleport.out.dur > end) {
      error("loop-broken", `${path}.props.teleport.out`, `"${item.id}" is still leaving at ${(teleport.out.at + teleport.out.dur).toFixed(2)} s, after its last frame (${end.toFixed(2)} s): the last frame must be the empty hall`);
    }
  }

  // The voice is the takes, laid out as recorded.
  const voiceOf = (t: EditTimeline) => (t.tracks.find((track) => track.id === "voice")?.items ?? []) as Item[];
  const voiceAt = timeline.tracks.findIndex((track) => track.id === "voice");
  const voice = voiceOf(timeline);
  const reference = voiceOf(compiled);
  // The voice track itself — its gain, its ducking — is the compiler's too (hidden and muted are hidden-track).
  const trackOnly = (t: EditTimeline | undefined, i: number) => {
    const { items: _items, hidden: _hidden, muted: _muted, ...rest } = (t?.tracks[i] ?? {}) as Record<string, unknown>;
    return canonical(rest);
  };
  const compiledVoiceAt = compiled.tracks.findIndex((track) => track.id === "voice");
  if (voiceAt !== -1 && compiledVoiceAt !== -1 && trackOnly(timeline, voiceAt) !== trackOnly(compiled, compiledVoiceAt)) {
    error("altered-voice", `$.tracks[${voiceAt}]`, "the voice track's gain or ducking was changed: the voice plays as recorded");
  }
  if (voice.length !== reference.length) {
    error("altered-voice", voiceAt === -1 ? "$.tracks" : `$.tracks[${voiceAt}]`, `the voice has ${voice.length} items; the takes are laid out in ${reference.length}`);
  } else {
    voice.forEach((item, j) => {
      const want = reference[j]!;
      const moved = item.from !== want.from || item.duration !== want.duration || item.asset !== want.asset
        || (item.trimStart ?? 0) !== (want.trimStart ?? 0);
      const reworked = ["gain", "fadeIn", "fadeOut", "transitionIn", "transitionOut"].filter((k) => item[k] !== undefined);
      if (moved || reworked.length > 0) {
        error("altered-voice", `$.tracks[${voiceAt}].items[${j}]`,
          moved
            ? `"${item.id}" is not where the takes put it (frame ${want.from}, ${want.duration} frames, ${want.asset}): takes are never cut or moved`
            : `"${item.id}" sets ${reworked.join(", ")}: takes are never reworked`);
      }
    });
  }

  // ── Warnings ──────────────────────────────────────────────────────────────
  // Two apparitions, each long enough to be seen (UP-58).
  const apparitions = withKit("room-effect").filter(({ item }) => APPARITIONS.has(item.props?.effect));
  if (apparitions.length !== APPARITION_COUNT) {
    warning("apparitions", "$.tracks", `${apparitions.length} apparitions; the format has ${APPARITION_COUNT}`);
  }
  for (const { item, path } of apparitions) {
    const seconds = Number(item.props?.end ?? 0) - Number(item.props?.start ?? 0);
    if (seconds < APPARITION_SECONDS) {
      warning("apparition-short", `${path}.props`, `"${item.id}" stays ${seconds.toFixed(1)} s, under ${APPARITION_SECONDS} s`);
    }
  }

  // About a second between the title and the poem.
  const unit = input.narration.units.find((u) => u.id === "recital");
  const laid = unit ? layoutUnit(input.narration, "recital", input.timings) : null;
  if (unit && laid && !("problems" in laid)) {
    const titleText = input.narration.takes.find((t) => t.id === unit.sequence[0]?.take)?.text ?? "";
    const n = titleText.split(/\s+/).filter(Boolean).length;
    const words = laid.layout.timing.words;
    if (n > 0 && words.length > n) {
      const pause = words[n]!.start - words[n - 1]!.end;
      if (pause < TITLE_PAUSE[0] || pause > TITLE_PAUSE[1]) {
        warning("title-pause", "$.units", `${pause.toFixed(2)} s between the title and the poem; the format wants ${TITLE_PAUSE[0]}–${TITLE_PAUSE[1]} s`);
      }
    }
  }

  return findings;
}

export const validator: SeriesValidator = {
  id: "dentro-i-versi-short",
  version: "1.0.0",
  description: "The Dentro i versi short's mechanical rules, on the timeline about to be rendered: 25–90 s, its kits only, every verse on its plate as written, the actor teleporting in and out, the voice untouched.",
  validate,
};
