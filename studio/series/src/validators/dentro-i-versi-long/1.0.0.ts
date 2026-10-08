// dentro-i-versi-long@1.0.0 (validator) — released: never edit this file; add dentro-i-versi-long/<next>.ts instead.
//
// The mechanical rules of the Dentro i versi long, checked on the timeline
// about to be rendered — hand edits included — with what the compiler makes
// of the same inputs as the reference. A hand edit may move a text or an
// effect; it may not change the profile, the loop, the kits, the look, the
// voices, or leave the lesson out of 240–600 s.

import type { Finding, SeriesValidator, ValidateInput } from "../../types.js";

/** 240 s and 600 s at 30 fps. */
const MIN_FRAMES = 7200;
const MAX_FRAMES = 18000;
/** The kits this release draws with, at their versions. */
const KITS = new Set([
  "room@1.0.0", "panel@1.1.0", "interprete@1.1.0", "verse-bar@1.0.0", "block-title@1.0.0", "figure-title@1.0.0", "chapter-opener@1.0.0",
  "cover@1.0.0", "warp@1.0.0", "brand-mark@2.0.0", "text-stack@1.0.0", "timeline@1.0.0", "story-fx@1.0.0", "word-tracks@1.0.0",
  "interlinear@1.0.0", "monitor-wall@1.0.0", "summary@1.0.0", "progress@1.0.0", "merge@1.0.0", "cards@1.0.0", "stack@1.0.0",
  "oxymoron@1.0.0", "simile@1.0.0", "syllables@1.0.0", "rhymes@1.0.0",
]);
const CHAPTERS = 5;

type Item = Record<string, any>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validate(input: ValidateInput): Finding[] {
  const { timeline, compiled } = input;
  const findings: Finding[] = [];
  const error = (code: string, path: string, message: string) => findings.push({ code, severity: "error", path, message });
  const warning = (code: string, path: string, message: string) => findings.push({ code, severity: "warning", path, message });

  const visual: { item: Item; path: string }[] = [];
  const audio: { item: Item; path: string }[] = [];
  timeline.tracks.forEach((track, i) => {
    const list = track.type === "visual" ? visual : audio;
    (track.items as Item[]).forEach((item, j) => list.push({ item, path: `$.tracks[${i}].items[${j}]` }));
  });

  // ── Errors ────────────────────────────────────────────────────────────────
  if (canonical(timeline.profile) !== canonical(compiled.profile)) {
    error("profile-changed", "$.profile", `the profile is ${timeline.profile.id}; this template renders ${compiled.profile.id}`);
  }
  if ((timeline as { loop?: boolean }).loop !== true) {
    error("loop-broken", "$.loop", "the lesson loops: its last frame is its first (loop: true)");
  }
  if (timeline.durationInFrames < MIN_FRAMES || timeline.durationInFrames > MAX_FRAMES) {
    error("duration", "$.durationInFrames", `the lesson lasts ${(timeline.durationInFrames / 30).toFixed(1)} s; the format wants 240–600 s`);
  }
  const look = input.theme ? canonical(input.theme.look) : null;
  for (const { item, path } of visual) {
    const kit = `${item.kit?.name}@${item.kit?.version}`;
    if (!KITS.has(kit)) error("unknown-kit", `${path}.kit`, `"${item.id}" draws with ${kit}, not one of this format's kits`);
    if (look && item.props?.look !== undefined && canonical(item.props.look) !== look) {
      error("look-changed", `${path}.props.look`, `"${item.id}" does not wear the channel's theme`);
    }
  }
  // Every voice the compiler plays is still there, unchanged, at its place.
  const voices = (t: typeof timeline) => t.tracks.filter((tr) => tr.type === "audio" && (tr.id === "voice" || tr.id === "recital")).flatMap((tr) => tr.items as Item[]);
  const now = new Map(voices(timeline).map((v) => [v.id, v]));
  for (const ref of voices(compiled)) {
    const v = now.get(ref.id);
    if (!v) error("voice-missing", "$.tracks", `the voice "${ref.id}" is gone`);
    else if (v.asset !== ref.asset || v.from !== ref.from || v.duration !== ref.duration || (v.trimStart ?? 0) !== (ref.trimStart ?? 0)) {
      error("voice-changed", "$.tracks", `the voice "${ref.id}" was moved, cut or replaced`);
    }
  }
  // The guide arrives at the opening and leaves at the exit: the first and the last frame are the empty atrio.
  const guides = visual.filter(({ item }) => item.kit?.name === "interprete");
  const first = guides.find(({ item }) => item.from === 0);
  if (!first) error("missing-guide", "$.tracks", "no guide from the first frame: she arrives at the opening by teleport");
  else if (!first.item.props?.teleport?.in) error("missing-teleport", `${first.path}.props.teleport`, "the guide must teleport in at the opening: the first frame is the empty atrio");
  const last = guides.find(({ item }) => item.from + item.duration >= timeline.durationInFrames);
  if (!last) error("missing-guide", "$.tracks", "no guide until the last frame: she leaves at the exit by teleport");
  else if (!last.item.props?.teleport?.out) error("missing-teleport", `${last.path}.props.teleport`, "the guide must teleport out at the exit: the last frame is the empty atrio");

  // ── Warnings ──────────────────────────────────────────────────────────────
  const chapters = visual.filter(({ item }) => item.kit?.name === "chapter-opener").length;
  if (chapters !== CHAPTERS) warning("chapters", "$.tracks", `${chapters} chapter cards; the format has ${CHAPTERS}`);
  const figures = new Set(["merge", "cards", "stack", "oxymoron", "simile"]);
  const progress = visual.filter(({ item }) => item.kit?.name === "progress");
  const tools = visual.filter(({ item }) => figures.has(item.kit?.name));
  if (progress.length !== tools.length) warning("specimen-without-tool", "$.tracks", `${progress.length} specimens, ${tools.length} figure tools: every painting has its tool`);
  if (!audio.some(({ item }) => String(item.id).startsWith("theme-"))) warning("no-theme-sound", "$.tracks", "no sound theme at the opening and the exit");
  return findings;
}

export const validator: SeriesValidator = {
  id: "dentro-i-versi-long",
  version: "1.0.0",
  description: "The Dentro i versi long's mechanical rules, on the timeline about to be rendered: 240–600 s, looping, its kits in the channel's theme, the voices untouched, the guide teleporting in and out.",
  validate,
};
