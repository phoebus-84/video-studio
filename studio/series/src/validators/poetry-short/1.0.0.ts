// poetry-short@1.0.0 (validator) — released: never edit this file; add poetry-short/<next>.ts instead.
//
// The mechanical rules of the poetry-short format, checked on the timeline
// that is about to be rendered — hand edits included — with what the
// compiler makes of the same inputs as the reference. A hand edit may move a
// picture change or split a caption; it may not touch the voice, the text,
// the profile or the effects. Everything this version does is in this file,
// and its golden cases fail if its findings ever change.

import type { EditTimeline, Finding, SeriesValidator, ValidateInput } from "../../types.js";

/** 10 s at 30 fps. */
const MIN_FRAMES = 300;
/** 60 s at 30 fps. */
const MAX_FRAMES = 1800;
/** A picture on screen for less than a second flashes. */
const FLASH_FRAMES = 30;
/** A picture held for more than 7 s with nothing changing. */
const LONG_FRAMES = 210;
const CROSSFADE = 12;
const CAPTION_CHARACTERS = 42;
const ALLOWED: Record<string, "visual" | "audio"> = { panels: "visual", captions: "visual", voice: "audio" };

interface PoetryShortData {
  narration: string;
  panels: { assetId: string }[];
  style: { captionKit: { name: string; version: string } };
}

type Track = EditTimeline["tracks"][number];
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
  const data = input.spec.data as unknown as PoetryShortData;
  const findings: Finding[] = [];
  const error = (code: string, path: string, message: string) => findings.push({ code, severity: "error", path, message });
  const warning = (code: string, path: string, message: string) => findings.push({ code, severity: "warning", path, message });

  const tracks = timeline.tracks;
  const indexOf = (id: string) => tracks.findIndex((t) => t.id === id);

  // ── The tracks the format is made of ──────────────────────────────────────
  const required = ["panels", "voice", ...(compiled.tracks.some((t) => t.id === "captions") ? ["captions"] : [])];
  for (const id of required) {
    const i = indexOf(id);
    if (i === -1 || tracks[i]!.type !== ALLOWED[id]) {
      error("missing-track", "$.tracks", `the ${ALLOWED[id]} track "${id}" is missing`);
    }
  }
  if (findings.length > 0) return findings;
  const panelsAt = indexOf("panels");
  const voiceAt = indexOf("voice");
  const captionsAt = indexOf("captions");
  const panels = tracks[panelsAt]!.items as Item[];
  const voice = tracks[voiceAt]!.items as Item[];
  const captions = captionsAt === -1 ? [] : (tracks[captionsAt]!.items as Item[]);

  // ── Errors ────────────────────────────────────────────────────────────────
  if (canonical(timeline.profile) !== canonical(compiled.profile)) {
    error("profile-changed", "$.profile", `the profile is ${timeline.profile.id}; this template renders ${compiled.profile.id}`);
  }

  const frames = timeline.durationInFrames;
  if (frames < MIN_FRAMES || frames > MAX_FRAMES) {
    error("duration-range", "$.durationInFrames",
      `${(frames / 30).toFixed(1)} s is outside 10–60 s: shorten or lengthen the narration or the hold, not the timeline`);
  }

  tracks.forEach((track: Track, i) => {
    if (ALLOWED[track.id] !== track.type) {
      error("extra-track", `$.tracks[${i}]`, `track "${track.id}" (${track.type}) is not part of this format: only panels, captions and voice`);
    }
  });

  tracks.forEach((track: Track, i) => {
    if (track.hidden || track.muted) {
      error("hidden-track", `$.tracks[${i}]`, `track "${track.id}" is ${track.hidden ? "hidden" : "muted"}: every track of this format plays`);
    }
  });

  const kitOf = (item: Item) => `${item.kit?.name}@${item.kit?.version}`;
  const captionKit = `${data.style.captionKit.name}@${data.style.captionKit.version}`;
  panels.forEach((item, j) => {
    if (kitOf(item) !== "still@1.0.0") {
      error("forbidden-kit", `$.tracks[${panelsAt}].items[${j}].kit`, `panel "${item.id}" uses ${kitOf(item)}; panels use still@1.0.0`);
    }
  });
  captions.forEach((item, j) => {
    if (kitOf(item) !== captionKit) {
      error("forbidden-kit", `$.tracks[${captionsAt}].items[${j}].kit`, `caption "${item.id}" uses ${kitOf(item)}; captions use ${captionKit}`);
    }
  });

  for (const [at, items] of [[panelsAt, panels], [captionsAt, captions]] as const) {
    items.forEach((item, j) => {
      const tin = item.transitionIn;
      if (item.transitionOut || (tin && (tin.type !== "crossfade" || tin.duration !== CROSSFADE))) {
        error("forbidden-transition", `$.tracks[${at}].items[${j}]`,
          `"${item.id}" has ${item.transitionOut ? "a transitionOut" : `a ${tin.type} of ${tin.duration} frames`}; only a 12-frame crossfade in`);
      }
    });
  }

  const reference = (compiled.tracks.find((t) => t.id === "voice")?.items ?? []) as Item[];
  if (voice.length !== reference.length) {
    error("altered-voice", `$.tracks[${voiceAt}]`, `the voice has ${voice.length} items; the takes are laid out in ${reference.length}`);
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

  const said = collapse([...captions].sort((a, b) => a.from - b.from).map((c) => String(c.props?.text ?? "")).join(" "));
  if (captionsAt !== -1 && said !== collapse(data.narration)) {
    error("text-not-voice", `$.tracks[${captionsAt}]`, `the captions say "${said}", not the narration: change the spec and the takes, not the captions`);
  }

  const shown = new Set(panels.map((item) => item.props?.src?.$asset));
  data.panels.forEach((panel, k) => {
    if (!shown.has(`image-${panel.assetId}`)) {
      error("missing-picture", `$.data.panels[${k}]`, `"${panel.assetId}" is never shown`);
    }
  });

  const spans = panels.map((item) => [item.from as number, (item.from as number) + (item.duration as number)] as const)
    .sort((a, b) => a[0] - b[0]);
  let covered = 0;
  for (const [from, end] of spans) {
    if (from > covered) break;
    covered = Math.max(covered, end);
  }
  if (covered < frames) {
    error("uncovered-frames", `$.tracks[${panelsAt}]`, `no picture from frame ${covered}: every frame shows a panel`);
  }

  // ── Warnings ──────────────────────────────────────────────────────────────
  panels.forEach((item, j) => {
    if (item.duration < FLASH_FRAMES) {
      warning("panel-flash", `$.tracks[${panelsAt}].items[${j}]`, `"${item.id}" is on screen for ${item.duration} frames, under a second`);
    }
  });
  panels.forEach((item, j) => {
    if (item.duration > LONG_FRAMES) {
      warning("panel-long", `$.tracks[${panelsAt}].items[${j}]`, `"${item.id}" holds for ${(item.duration / 30).toFixed(1)} s with nothing changing (over 7 s)`);
    }
  });
  captions.forEach((item, j) => {
    const text = String(item.props?.text ?? "");
    if (text.length > CAPTION_CHARACTERS) {
      warning("caption-long", `$.tracks[${captionsAt}].items[${j}]`, `"${text}" is ${text.length} characters, over 42`);
    }
  });

  return findings;
}

export const validator: SeriesValidator = {
  id: "poetry-short",
  version: "1.0.0",
  description: "The poetry-short format's mechanical rules, on the timeline about to be rendered: 10–60 s, its tracks and kits only, the voice and its text untouched.",
  validate,
};
