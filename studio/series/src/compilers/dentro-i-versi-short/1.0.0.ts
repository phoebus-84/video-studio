// dentro-i-versi-short@1.0.0 — released: never edit this file; add dentro-i-versi-short/<next>.ts instead.
//
// "Dentro i versi · short": the title said, the whole poem recited in a
// science-fiction museum hall, applause (CreativeStudio's poesie-museo-short,
// sala8). From the spec's data and the recital's measured words it works out
// what sala8 computed on the fly — the camera, the lightning, the lights, the
// actor's poses, expressions, gazes, blinks and mouth, the titles' sizes — and
// lays the hall, room effects, verse plates, actor and titles out as items of
// the museum kits, with the takes, sounds, applause and music.
//
// Channel specifics in code (palettes, poses, layout): accepted for now; the
// boundary to restore is avg-d1x.

import { layoutUnit } from "@studio/contracts/src/narration-takes.mjs";
import { outputProfile } from "@studio/contracts/src/output-profiles.mjs";
import type { CompileInput, CompileProblem, CompileResult, EditTimeline, SeriesCompiler } from "../../types.js";

const FPS = 30;
const UNIT = "recital";
const SPEC_PATH = "episode-spec.json";
const PROFILE = "vertical-1080x1920";
/** The voice starts this long after the first frame (the title is said under the teleport). */
const LEAD = 0.3;
/** After the end of the voice: the bow and the applause. */
const TAIL = 6.0;
/** The actor's place in the hall. */
const ACTOR = { x: 770, footY: 1800, scale: 0.95 };
const SCREEN = { x: 360, y: 215, w: 620, h: 910 };
const CAMERA_ORIGIN: [number, number] = [600, 1100];
/** Where the plates and the lower third start (left), inside the profile's safe zone. */
const PLATE_X = 90;

const KIT = (name: string) => ({ name, version: "1.0.0" });

const DEFAULT_CAMS = [
  { dx: -10, dy: -14, z: 0.15, r: -0.16 }, { dx: 14, dy: -8, z: 0.16, r: 0.14 }, { dx: -12, dy: 10, z: 0.17, r: -0.12 },
  { dx: 8, dy: -12, z: 0.14, r: 0.10 }, { dx: -10, dy: 8, z: 0.18, r: -0.12 }, { dx: 12, dy: -8, z: 0.15, r: 0.12 },
];
const REST = { lu: 7, lf: 4, ru: 7, rf: 4, head: 0, lean: 0, grip: 0, step: 0, twist: 0, dip: 0 };
type Pose = typeof REST;
const POSE_KEYS = Object.keys(REST) as (keyof Pose)[];
const POSE_PRESETS: Record<string, Partial<Pose>> = {
  riposo: {},
  invoca: { lu: 20, lf: 54, ru: 20, rf: 54, head: -2, step: 1 },
  "mani-al-cuore": { lu: 38, lf: 92, ru: 22, rf: 60, head: -4, lean: 2 },
  indica: { ru: 126, rf: 140, head: 4 },
  apre: { lu: 62, lf: 72, ru: 62, rf: 72, head: -4, step: 1 },
  chiede: { lu: 56, lf: 72, ru: 56, rf: 72, head: -4, step: 1 },
  dialoga: { lu: 34, lf: 88, ru: 34, rf: 88, head: -5, dip: 1 },
  spalle: { lu: 24, lf: 110, ru: 24, rf: 110, head: -3, twist: 1 },
  "braccio-alto": { lu: 66, lf: 78, ru: 20, rf: 58, head: -3, step: 1 },
};
const EXPRESSIONS: Record<string, { li: number; lo: number; ri: number; ro: number; sm: number }> = {
  N: { li: 0, lo: 0, ri: 0, ro: 0, sm: 0.25 },
  A: { li: -6, lo: 3, ri: -6, ro: 3, sm: -0.5 },
  W: { li: 7, lo: 6, ri: 7, ro: 6, sm: 0 },
  I: { li: 7, lo: 5, ri: -2, ro: 0, sm: 0.8 },
  M: { li: 6, lo: -3, ri: 6, ro: -3, sm: -0.6 },
  S: { li: 3, lo: 2, ri: 3, ro: 2, sm: 0.9 },
};
const PALETTES: Record<string, Record<string, string>> = {
  "attore-saffo": { ink: "#2e2620", shirt: "#c52f87", shirtDark: "#8d1f60", vest: "#c52f87", vestLight: "#f064ad", button: "#164f56", inner: "#0799a5", innerDark: "#056a73", skin: "#f6b386", skinDark: "#cf7c4e", trousers: "#34373b", shoe: "#fafaf5", sole: "#dcd8cc" },
  "attore-infinito": { ink: "#2e2620", shirt: "#12a6b8", shirtDark: "#ff5a4e", vest: "#12a6b8", vestLight: "#0b7480", button: "#1d3a40", inner: "#ff5a4e", innerDark: "#d63c32", skin: "#f6b386", skinDark: "#cf7c4e", trousers: "#1b2a5c", shoe: "#fafaf5", sole: "#dcd8cc" },
  "attrice-saffo": { ink: "#2e2620", shirt: "#d26068", shirtDark: "#9f3e4b", vest: "#078c78", vestLight: "#55c9ae", button: "#f0bd43", inner: "#d26068", innerDark: "#9f3e4b", skin: "#f6b386", skinDark: "#cf7c4e", trousers: "#49334f", shoe: "#fafaf5", sole: "#dcd8cc" },
  "attrice-dante": { ink: "#2e2620", shirt: "#f2b632", shirtDark: "#c4860f", vest: "#1f4fbf", vestLight: "#5f8ae6", button: "#f7e6a6", inner: "#f2b632", innerDark: "#c4860f", skin: "#f6b386", skinDark: "#cf7c4e", trousers: "#2a2452", shoe: "#fafaf5", sole: "#dcd8cc", hair: "#3b2216", hairHi: "#6e4127", hairGloss: "#a06a43" },
};
const FRONT_FX = new Set(["note", "apparizione", "fantasma"]);
/** The colours the interprete kit draws a costume with. */
const PALETTE_KEYS = ["ink", "shirt", "shirtDark", "vest", "vestLight", "button", "inner", "innerDark", "skin", "skinDark", "trousers", "shoe", "sole", "hair", "hairHi", "hairGloss", "lip", "freckles"];

/** Advance widths (em) of Anton 400 and Inter 600 (@fontsource 5.3.0), for sizing titles; other characters count as wide. */
const ANTON_EM: Record<string, number> = { A: 0.4854, B: 0.4785, C: 0.4741, D: 0.4932, E: 0.4116, F: 0.3989, G: 0.4849, H: 0.499, I: 0.2266, J: 0.4663, K: 0.4722, L: 0.3975, M: 0.7461, N: 0.498, O: 0.4863, P: 0.4722, Q: 0.4937, R: 0.4766, S: 0.4614, T: 0.3955, U: 0.4736, V: 0.4692, W: 0.7119, X: 0.4839, Y: 0.4463, Z: 0.4102, "0": 0.4941, "1": 0.3306, "2": 0.4941, "3": 0.4941, "4": 0.4941, "5": 0.4941, "6": 0.4941, "7": 0.4941, "8": 0.4941, "9": 0.4941, " ": 0.2344, "'": 0.2139, "’": 0.2319, ",": 0.2363, ".": 0.2285, ";": 0.2451, ":": 0.2417, "!": 0.229, "?": 0.4922, "-": 0.311, "–": 0.311, "—": 0.563, "«": 0.5781, "»": 0.5781, "À": 0.4854, "È": 0.4116, "É": 0.4116, "Ì": 0.2266, "Ò": 0.4863, "Ù": 0.4736 };
const INTER_600_EM: Record<string, number> = { A: 0.7275, B: 0.6592, C: 0.7368, D: 0.7222, E: 0.6055, F: 0.5879, G: 0.749, H: 0.7456, I: 0.2769, J: 0.5796, K: 0.7031, L: 0.5654, M: 0.9224, N: 0.7593, O: 0.7686, P: 0.645, Q: 0.7729, R: 0.6523, S: 0.6504, T: 0.6602, U: 0.7358, V: 0.7275, W: 1.02, X: 0.7197, Y: 0.7134, Z: 0.6523, " ": 0.252, "'": 0.3257, "’": 0.2939, ",": 0.3188, ".": 0.3188, "-": 0.4653, "À": 0.7275, "È": 0.6055, "É": 0.6055, "Ì": 0.2769, "Ò": 0.7686, "Ù": 0.7358 };
/** Width in px of upper-cased `text` at `size` px with `spacing` px between letters. */
const textWidth = (em: Record<string, number>, text: string, size: number, spacing: number) =>
  [...text.toLocaleUpperCase("it-IT")].reduce((w, c) => w + (em[c] ?? 0.75) * size + spacing, 0);
/** The brand mark's pill (x 60, Inter 600 24 px, spacing 6, the bolt and paddings): where the chip must stop, with a 24 px gap. */
const MARK_RIGHT = 60 + 16 + 20 + 12 + textWidth(INTER_600_EM, "DENTRO I VERSI", 24, 6) + 20 + 24;
/** The chip's right edge (1080 − 140). */
const CHIP_RIGHT = 940;

type TimeRef = number | string;
interface Data {
  title: string;
  author: string;
  kicker?: string;
  titleLines?: string[];
  voiceEndWord?: string;
  verses: { text: string; strong?: string[]; gloss: string }[];
  pictures: { assetId: string; at?: TimeRef; sc?: number; org?: string; spill?: string; cam?: { dx: number; dy: number; z: number; r: number }; fx?: string[] }[];
  actor: { variant: "attore" | "attrice"; outfit?: "gilet" | "giacca"; hairstyle?: "coda" | "corto"; accessories?: { earrings?: boolean; freckles?: boolean }; base?: string; palette?: Record<string, string> };
  poses?: ({ at: TimeRef; preset?: string } & Partial<Pose>)[];
  expressions?: string;
  gaze?: { from: TimeRef; to: TimeRef; x: number; y: number; h: number }[];
  pushVerses?: number[];
  lights?: { at: TimeRef; dark?: number; spot?: string; w?: number }[];
  hall: {
    room: string;
    textures?: { fog?: string; caustics?: string };
    pedestal?: boolean;
    teleport?: { in?: [TimeRef, number]; out?: [TimeRef, number] };
    wind?: { from: TimeRef; to: TimeRef; strength?: number }[];
    shake?: { from: TimeRef; to: TimeRef; amp?: number }[];
    shatter?: { at: TimeRef; picture: number; dur?: number }[];
    blackout?: { at: TimeRef; to: TimeRef; dark?: number };
    bolt?: { at: TimeRef; dur?: number };
  };
  roomFx?: { fx: string; at: TimeRef; to?: TimeRef; color?: string; assetId?: string; x?: number; y?: number; w?: number; mode?: string; exit?: string; glow?: string }[];
  sfx?: { assetId: string; at: TimeRef; dur: number | string; gain?: number; offset?: number }[];
  applause?: { assetId: string; gain?: number; dur?: number; delay?: number };
  music?: { assetId: string; gain?: number; duck?: number };
}

interface Envelope { from: number; to: number; rampIn: number; rampOut: number; amount: number }

const frames = (seconds: number) => Math.round(seconds * FPS);
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const norm = (s: string) => s.toLocaleLowerCase("it-IT").normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, "");
const tokens = (text: string) => text.split(/\s+/).filter(Boolean);
/** CreativeStudio's deterministic noise (the blinks' spacing). */
const rnd = (i: number) => {
  const x = Math.sin(i * 127.1 + 11.7) * 43758.5453;
  return x - Math.floor(x);
};
const shift = (e: Envelope, by: number): Envelope => ({ ...e, from: round3(e.from - by), to: round3(e.to - by) });
const env = (from: number, to: number, rampIn: number, rampOut: number, amount: number): Envelope =>
  ({ from: round3(from), to: round3(to), rampIn: round3(rampIn), rampOut: round3(rampOut), amount: round3(amount) });

/** Items into the first lane whose last item ends before they start: no track has overlaps. */
function lanes<T extends { from: number; duration: number }>(items: T[]): T[][] {
  const out: T[][] = [];
  for (const item of [...items].sort((a, b) => a.from - b.from)) {
    const lane = out.find((l) => l[l.length - 1]!.from + l[l.length - 1]!.duration <= item.from);
    if (lane) lane.push(item);
    else out.push([item]);
  }
  return out;
}

function compile(input: CompileInput): CompileResult {
  const data = input.spec.data as unknown as Data;
  const problems: CompileProblem[] = [];
  const warnings: string[] = [];
  const profile = outputProfile(PROFILE)!;
  const specHash = input.inputs[SPEC_PATH];
  if (!specHash) problems.push({ code: "missing-input", path: "$.inputs", message: `the hash of ${SPEC_PATH} was not supplied` });

  // ── The recital: title take, then the poem ───────────────────────────────
  const unit = input.narration.units.find((u) => u.id === UNIT);
  if (!unit) return { ok: false, problems: [{ code: "missing-unit", path: "$.units", message: `takes.json has no unit "${UNIT}" (the title take, then the poem)` }] };
  if (unit.sequence.length < 2) {
    return { ok: false, problems: [{ code: "missing-take", path: "$.units", message: `unit "${UNIT}" must say the title, then the poem: it has ${unit.sequence.length} take(s)` }] };
  }
  const laid = layoutUnit(input.narration, UNIT, input.timings);
  if ("problems" in laid) return { ok: false, problems: laid.problems as CompileProblem[] };
  const layout = laid.layout;
  const takeText = new Map(input.narration.takes.map((t) => [t.id, t.text]));
  const titleWords = tokens(takeText.get(unit.sequence[0]!.take) ?? "").length;
  const words = layout.timing.words.map((w) => ({ text: w.text, start: w.start + LEAD, end: w.end + LEAD }));
  const poem = words.slice(titleWords);

  // ── Verses on the poem's words ───────────────────────────────────────────
  const counts = data.verses.map((v) => tokens(v.text).length);
  const total = counts.reduce((s, n) => s + n, 0);
  if (total !== poem.length) {
    return { ok: false, problems: [{ code: "verse-mismatch", path: "$.data.verses", message: `the verses have ${total} words; the recital says ${poem.length} after the title` }] };
  }
  const verseWords: (typeof poem)[] = [];
  let k = 0;
  data.verses.forEach((v, i) => {
    const said = poem.slice(k, k + counts[i]!);
    k += counts[i]!;
    const written = tokens(v.text);
    const off = written.findIndex((w, j) => norm(w) !== norm(said[j]!.text));
    if (off !== -1) problems.push({ code: "verse-mismatch", path: `$.data.verses[${i}].text`, message: `verse ${i + 1} writes "${written[off]}" where the recital says "${said[off]!.text}"` });
    verseWords.push(said);
  });
  if (problems.length > 0) return { ok: false, problems };
  const LN = verseWords.map((w) => ({ start: w[0]!.start, end: w[w.length - 1]!.end }));
  const L = (n: number) => LN[Math.max(0, Math.min(LN.length, n) - 1)]!.start;
  const E = (n: number) => LN[Math.max(0, Math.min(LN.length, n) - 1)]!.end;

  let voiceEnd = poem[poem.length - 1]!.end;
  if (data.voiceEndWord) {
    const key = norm(data.voiceEndWord);
    const lastVerse = verseWords[verseWords.length - 1]!;
    const said = poem.map((w, i) => ({ w, i })).filter(({ w }) => norm(w.text) === key);
    const last = said[said.length - 1];
    if (!last) problems.push({ code: "unknown-word", path: "$.data.voiceEndWord", message: `the recital does not say "${data.voiceEndWord}"` });
    else if (last.i < poem.length - lastVerse.length) {
      problems.push({ code: "voice-end-early", path: "$.data.voiceEndWord", message: `"${data.voiceEndWord}" is last said before the last verse: the voice ends on a word of the last verse` });
    } else voiceEnd = last.w.end;
  }
  const VE = voiceEnd;
  const durationInFrames = Math.ceil((VE + TAIL) * FPS - 1e-6);
  const END = durationInFrames / FPS;

  // ── Times: verse:N, verseEnd:N, word:parola, end, picture:N (± seconds) ───
  let pictureAt: number[] = [];
  const TIME = /^(?:(verse|verseEnd|picture):(\d+)|word:(.+?)|(end))([+-]\d+(?:\.\d+)?)?$/;
  const tref = (ref: TimeRef | undefined, path: string, fallback = 0): number => {
    if (ref === undefined) return fallback;
    const bad = (message: string) => {
      problems.push({ code: "bad-time", path, message });
      return fallback;
    };
    let t: number;
    if (typeof ref === "number") t = ref;
    else {
      const m = TIME.exec(ref.trim());
      if (!m) return bad(`"${ref}" is not a time (verse:N, verseEnd:N, word:parola, end, picture:N, ± seconds)`);
      const off = m[5] ? parseFloat(m[5]) : 0;
      if (m[1] === "picture") {
        // Only a picture before the one being placed has a time yet.
        const at = pictureAt[parseInt(m[2]!, 10)];
        if (at === undefined) return bad(`there is no picture ${m[2]} before this time`);
        t = at + off;
      } else if (m[1]) {
        const n = parseInt(m[2]!, 10);
        if (n < 1 || n > LN.length) return bad(`there is no verse ${n}: the poem has ${LN.length}`);
        t = (m[1] === "verse" ? L(n) : E(n)) + off;
      } else if (m[3] !== undefined) {
        const key = norm(m[3]);
        const word = poem.find((w) => norm(w.text) === key) ?? poem.find((w) => key !== "" && norm(w.text).startsWith(key));
        if (!word) {
          problems.push({ code: "unknown-word", path, message: `the recital does not say "${m[3]}"` });
          return fallback;
        }
        t = word.start + off;
      } else t = VE + off;
    }
    if (t < 0) return bad(`"${ref}" falls at ${round3(t)} s, before the video starts`);
    return t;
  };
  /** A span's end, refused unless it comes after its start. */
  const until = (start: number, ref: TimeRef, path: string): number => {
    const t = tref(ref, path, start + 1);
    if (t <= start) {
      problems.push({ code: "bad-time", path, message: `ends at ${round3(t)} s, not after it starts (${round3(start)} s)` });
      return start + 1;
    }
    return t;
  };

  // ── Assets ────────────────────────────────────────────────────────────────
  const assets: EditTimeline["assets"] = {};
  const image = (assetId: string, path: string) => {
    const id = `image-${assetId}`;
    const a = input.assets[id];
    if (!a) {
      problems.push({ code: "missing-asset", path, message: `no image "${assetId}" in assets/images` });
      return { $asset: id };
    }
    assets[id] = { ...a };
    return { $asset: id };
  };
  const sound = (assetId: string, path: string) => {
    const id = `sound-${assetId}`;
    const a = input.assets[id];
    if (!a) problems.push({ code: "missing-asset", path, message: `no sound "${assetId}" in assets/sounds` });
    else assets[id] = { ...a };
    return id;
  };

  // ── Pictures, camera, lightning, lights ──────────────────────────────────
  // Each picture after the one before: the screen crossfades from one to the next.
  data.pictures.forEach((p, i) => {
    if (i === 0) {
      pictureAt.push(0);
      return;
    }
    const at = tref(p.at, `$.data.pictures[${i}].at`, L(Math.min(i + 1, LN.length)));
    if (at <= pictureAt[i - 1]!) {
      problems.push({ code: "bad-time", path: `$.data.pictures[${i}].at`, message: `picture ${i} at ${round3(at)} s does not come after picture ${i - 1} (${round3(pictureAt[i - 1]!)} s)` });
    }
    pictureAt.push(at);
  });
  const pictures = data.pictures.map((p, i) => ({
    src: image(p.assetId, `$.data.pictures[${i}].assetId`),
    at: round3(pictureAt[i]!),
    scale: p.sc ?? 1.07,
    origin: p.org ?? "50% 40%",
    move: p.cam ?? DEFAULT_CAMS[i % DEFAULT_CAMS.length]!,
    fx: p.fx ?? [],
    spill: p.spill ?? "#b9a8ff",
  }));
  const pushV = data.pushVerses ?? [1, Math.max(2, Math.round(LN.length * 0.4)), Math.max(3, Math.round(LN.length * 0.8)), LN.length];
  const camera = {
    origin: CAMERA_ORIGIN,
    zoom: [
      env(L(1), VE + 1.8, VE - L(1), 1.4, 0.025),
      ...pushV.map((n) => env(L(n) - 0.25, E(n) + 1.3, 0.8, 0.8, 0.06 * 0.45)),
    ],
    shake: (data.hall.shake ?? []).map((s, i) => {
      const from = tref(s.from, `$.data.hall.shake[${i}].from`);
      return env(from, until(from, s.to, `$.data.hall.shake[${i}].to`), 0.2, 0.3, s.amp ?? 7);
    }),
  };
  const strikes = pictureAt.slice(1).map((a) => round3(a - 0.05)).filter((x) => x > 0.5 && x < VE);
  const lights = data.lights && data.lights.length > 0
    ? data.lights.map((l, i) => ({ at: round3(tref(l.at, `$.data.lights[${i}].at`)), dark: l.dark ?? 0.18, spot: l.spot ?? "#fff1d8", w: l.w ?? 1 }))
    : [{ at: 0, dark: 0.05, spot: "#eaf4ff", w: 1 }, { at: round3(VE + 1.8), dark: 0.03, spot: "#eaf4ff", w: 1.1 }];
  const hall = data.hall;
  const blackoutAt = hall.blackout ? tref(hall.blackout.at, "$.data.hall.blackout.at") : 0;
  const blackout = hall.blackout ? env(blackoutAt, until(blackoutAt, hall.blackout.to, "$.data.hall.blackout.to"), 0.5, 0.8, hall.blackout.dark ?? 0.8) : undefined;
  const bolt = hall.bolt ? { at: round3(tref(hall.bolt.at, "$.data.hall.bolt.at")), dur: hall.bolt.dur ?? 0.7 } : undefined;
  const wind = (hall.wind ?? []).map((w, i) => {
    const from = tref(w.from, `$.data.hall.wind[${i}].from`);
    return env(from, until(from, w.to, `$.data.hall.wind[${i}].to`), 0.6, 0.8, w.strength ?? 1);
  });
  const shatter = (hall.shatter ?? []).map((s, i) => {
    if (s.picture >= data.pictures.length) {
      problems.push({ code: "unknown-picture", path: `$.data.hall.shatter[${i}].picture`, message: `there is no picture ${s.picture}: the spec has ${data.pictures.length}` });
    }
    return { at: round3(tref(s.at, `$.data.hall.shatter[${i}].at`)), picture: s.picture, dur: s.dur ?? 1.4 };
  });
  const textures = {
    ...(hall.textures?.fog ? { fog: image(hall.textures.fog, "$.data.hall.textures.fog") } : {}),
    ...(hall.textures?.caustics ? { caustics: image(hall.textures.caustics, "$.data.hall.textures.caustics") } : {}),
  };
  const live = { from: round3(L(1) - 1.0), to: round3(L(1) - 0.2) };
  const room = image(hall.room, "$.data.hall.room");

  // ── The actor ─────────────────────────────────────────────────────────────
  const actor = data.actor;
  const base = PALETTES[actor.base ?? (actor.variant === "attrice" ? "attrice-saffo" : "attore-saffo")];
  if (!base) problems.push({ code: "unknown-palette", path: "$.data.actor.base", message: `no costume "${actor.base}" (${Object.keys(PALETTES).join(", ")})` });
  for (const key of Object.keys(actor.palette ?? {})) {
    if (!PALETTE_KEYS.includes(key)) problems.push({ code: "unknown-palette", path: `$.data.actor.palette.${key}`, message: `the actor has no colour "${key}" (${PALETTE_KEYS.join(", ")})` });
  }
  const palette = { ...base, ...(actor.palette ?? {}) };
  const poses = [
    { at: 0, pose: REST },
    ...(data.poses ?? []).map((p, i) => {
      const { at, preset, ...angles } = p;
      if (preset && !POSE_PRESETS[preset]) problems.push({ code: "unknown-pose", path: `$.data.poses[${i}].preset`, message: `no pose "${preset}" (${Object.keys(POSE_PRESETS).join(", ")})` });
      const pose = { ...REST, ...(preset ? POSE_PRESETS[preset] ?? {} : {}), ...angles } as Pose;
      return { at: round3(tref(at, `$.data.poses[${i}].at`)), pose: Object.fromEntries(POSE_KEYS.map((key) => [key, pose[key]])) as Pose };
    }),
    { at: round3(VE), pose: REST },
  ].sort((a, b) => a.at - b.at);
  const letters = data.expressions ?? "N".repeat(LN.length);
  const expressions = [
    { at: 0, ex: EXPRESSIONS.N! },
    ...LN.map((l, i) => ({ at: round3(l.start - 0.15), ex: EXPRESSIONS[letters[i] ?? "N"] ?? EXPRESSIONS.N! })),
    { at: round3(VE + 0.3), ex: EXPRESSIONS.N! },
  ];
  const gaze = [
    ...pictureAt.slice(1).map((a) => ({ from: round3(a + 0.1), to: round3(a + 1.5), x: 3.5, y: -3, h: 5 })),
    ...(data.gaze ?? []).map((g, i) => {
      const from = tref(g.from, `$.data.gaze[${i}].from`);
      return { from: round3(from), to: round3(until(from, g.to, `$.data.gaze[${i}].to`)), x: g.x, y: g.y, h: g.h };
    }),
  ];
  const blinks: number[] = [];
  for (let b = 1.1, i = 0; b < VE + TAIL; i++) {
    blinks.push(round3(b));
    b += 2 + 3 * rnd(i + 3);
  }
  const energy = layout.energy
    ? { rate: layout.energy.rate, values: [...new Array(Math.round(LEAD * layout.energy.rate)).fill(0), ...layout.energy.values] }
    : { rate: FPS, values: [] as number[] };
  if (!layout.energy) warnings.push("the takes carry no energy at one rate: the actor's mouth stays closed");
  const speech: [number, number][] = [];
  for (const w of words) {
    const last = speech[speech.length - 1];
    if (last && w.start - last[1] < 0.2) last[1] = round3(Math.max(last[1], w.end));
    else speech.push([round3(w.start), round3(w.end)]);
  }
  const teleport = hall.teleport
    ? {
      ...(hall.teleport.in ? { in: { at: round3(tref(hall.teleport.in[0], "$.data.hall.teleport.in[0]")), dur: hall.teleport.in[1] } } : {}),
      ...(hall.teleport.out ? { out: { at: round3(tref(hall.teleport.out[0], "$.data.hall.teleport.out[0]")), dur: hall.teleport.out[1] } } : {}),
    }
    : undefined;

  // ── Room effects ──────────────────────────────────────────────────────────
  const roomItems = (data.roomFx ?? []).map((r, i) => {
    const a = tref(r.at, `$.data.roomFx[${i}].at`);
    const b = r.to === undefined ? a + 8 : until(a, r.to, `$.data.roomFx[${i}].to`);
    if (r.fx === "apparizione" && !r.assetId) {
      problems.push({ code: "missing-asset", path: `$.data.roomFx[${i}].assetId`, message: "an apparizione needs its figure: the cut-out picture that comes out" });
    }
    if (r.fx === "nebbia-sala" && !hall.textures?.fog && !problems.some((q) => q.path === "$.data.hall.textures.fog")) {
      problems.push({ code: "missing-asset", path: "$.data.hall.textures.fog", message: `nebbia-sala (roomFx[${i}]) draws with the hall's fog texture: name one` });
    }
    const from = frames(a);
    const end = frames(b + (FRONT_FX.has(r.fx) ? 1 : 0));
    if (from >= durationInFrames) problems.push({ code: "after-end", path: `$.data.roomFx[${i}].at`, message: `${r.fx} starts at ${round3(a)} s, after the video ends (${round3(END)} s)` });
    const at0 = from / FPS;
    const figure = {
      ...(r.assetId ? { src: image(r.assetId, `$.data.roomFx[${i}].assetId`) } : {}),
      ...(r.x !== undefined ? { x: r.x } : {}), ...(r.y !== undefined ? { y: r.y } : {}), ...(r.w !== undefined ? { w: r.w } : {}),
      ...(r.mode ? { mode: r.mode } : {}), ...(r.exit ? { exit: r.exit } : {}), ...(r.glow ? { glow: r.glow } : {}),
    };
    return {
      id: `room-${i + 1}`,
      from,
      duration: Math.max(1, Math.min(end, durationInFrames) - from),
      kit: KIT("room-effect"),
      props: {
        effect: r.fx,
        ...(r.color ? { color: r.color } : {}),
        // The item starts on the frame nearest the effect: never before it in kit time.
        start: Math.max(0, round3(a - at0)),
        end: round3(b - at0),
        screen: SCREEN,
        camera: { ...camera, zoom: camera.zoom.map((e) => shift(e, at0)), shake: camera.shake.map((e) => shift(e, at0)) },
        ...(blackout ? { blackout: shift(blackout, at0) } : {}),
        ...(r.fx === "nebbia-sala" && textures.fog ? { textures: { fog: textures.fog } } : {}),
        ...(Object.keys(figure).length > 0 ? { figure } : {}),
      },
      source: `roomFx[${i}]`,
    };
  });

  // Strong words, as the plate bolds them (lower case, letters only), matched
  // to the verse's own tokens — "uccelli" bolds "d’uccelli".
  const plateKey = (token: string) => token.toLocaleLowerCase("it-IT").replace(/[^\p{L}]+/gu, "");
  const strongKeys = (v: Data["verses"][number], i: number) => {
    const keys: string[] = [];
    (v.strong ?? []).forEach((word, j) => {
      const said = tokens(v.text).filter((t) => norm(t) === norm(word) || norm(t.split(/['’]/).pop()!) === norm(word));
      if (said.length === 0) problems.push({ code: "unknown-word", path: `$.data.verses[${i}].strong[${j}]`, message: `verse ${i + 1} has no word "${word}"` });
      for (const t of said) if (!keys.includes(plateKey(t))) keys.push(plateKey(t));
    });
    return keys;
  };

  // ── Verse plates ──────────────────────────────────────────────────────────
  const plateItems = data.verses.map((v, i) => {
    const from = frames(LN[i]!.start - 0.28);
    const out = i < LN.length - 1 ? LN[i + 1]!.start - 0.05 : VE + 1.0;
    const end = Math.max(from + 1, frames(out));
    const at0 = from / FPS;
    return {
      id: `verse-${i + 1}`,
      from,
      duration: end - from,
      kit: KIT("verse-plate"),
      props: {
        text: v.text,
        words: verseWords[i]!.map((w, j) => ({ text: tokens(v.text)[j]!, at: round3(w.start - at0) })),
        ...(v.strong ? { strong: strongKeys(v, i) } : {}),
        gloss: v.gloss,
        start: round3(LN[i]!.start - at0),
      },
      source: `verses[${i}]`,
      transitionOut: { type: "fade" as const, duration: i < LN.length - 1 ? frames(0.27) : frames(0.5) },
    };
  });

  // ── Titles ────────────────────────────────────────────────────────────────
  const tw = tokens(data.title);
  const titleLines = data.titleLines ?? [tw.slice(0, Math.ceil(tw.length / 2)).join(" "), tw.slice(Math.ceil(tw.length / 2)).join(" ")].filter(Boolean);
  const cardWidth = Math.round(ACTOR.x - 150 * ACTOR.scale - 24 - PLATE_X);
  // Anton size at which the longest line fills the card's inner width (letter spacing 3 px).
  const fit = (lines: string[]) => Math.min(124, Math.min(...lines.map((l) => Math.floor((cardWidth - 66 - 3 * [...l].length) / textWidth(ANTON_EM, l, 1, 0)))));
  const cardLines = fit([data.title]) >= 100 ? [data.title] : titleLines;
  const card = { kicker: data.kicker ?? data.author.toUpperCase(), titleLines: cardLines.map((l) => l.toUpperCase()), author: data.author, maxWidth: cardWidth, size: fit(cardLines) };
  const opening = frames(L(1) - 0.1);
  const bowFrom = frames(VE + 1.0);
  const chipFrom = frames(L(1) - 0.9);
  const chipEnd = frames(VE + 1.9);
  const titleItems = [
    { id: "card-opening", from: 0, duration: opening, kit: KIT("lower-third"), props: { ...card }, source: "title", transitionOut: { type: "fade" as const, duration: frames(0.8) } },
    { id: "card-bow", from: bowFrom, duration: durationInFrames - bowFrom, kit: KIT("lower-third"), props: { ...card, ruleGrow: 0 }, source: "title", transitionIn: { type: "fade" as const, duration: frames(0.9) } },
  ];
  // The chip (Anton 36, spacing 2; author Inter 600 18, spacing 4; paddings 22) stays clear of the mark.
  const chipTitle = 2 * 22 + 2 + textWidth(ANTON_EM, data.title, 36, 2);
  const withAuthor = chipTitle + 14 + textWidth(INTER_600_EM, data.author, 18, 4);
  if (CHIP_RIGHT - chipTitle < MARK_RIGHT) {
    problems.push({ code: "title-too-long", path: "$.data.title", message: `"${data.title}" is too long for the chip beside the mark (${Math.ceil(chipTitle)} px, ${Math.floor(CHIP_RIGHT - MARK_RIGHT)} px free)` });
  }
  const chipAuthor = data.title.length <= 13 && CHIP_RIGHT - withAuthor >= MARK_RIGHT;
  const chipItem = {
    id: "chip", from: chipFrom, duration: chipEnd - chipFrom, kit: KIT("title-chip"),
    props: { title: data.title, ...(chipAuthor ? { author: data.author } : {}) },
    source: "title",
    transitionIn: { type: "fade" as const, duration: frames(0.8) },
    transitionOut: { type: "fade" as const, duration: frames(0.9) },
  };

  // ── Audio ─────────────────────────────────────────────────────────────────
  const voiceItems = layout.pieces.map((piece, n) => {
    const from = frames(LEAD + piece.at);
    const id = `narration-${piece.take}`;
    const a = input.assets[id];
    if (!a) problems.push({ code: "missing-asset", path: "$.takes", message: `no audio "${id}" for take "${piece.take}"` });
    else assets[id] = { ...a };
    return {
      id: `voice-${n + 1}`, from, duration: Math.max(1, Math.min(frames(LEAD + piece.at + piece.duration), durationInFrames) - from), asset: id,
      ...(frames(piece.from) > 0 ? { trimStart: frames(piece.from) } : {}), source: "narration",
    };
  });
  const sfxItems = (data.sfx ?? []).map((s, i) => {
    const at = tref(s.at, `$.data.sfx[${i}].at`);
    const dur = typeof s.dur === "string" ? tref(s.dur, `$.data.sfx[${i}].dur`) - at : s.dur;
    const from = frames(at);
    if (from >= durationInFrames) problems.push({ code: "after-end", path: `$.data.sfx[${i}].at`, message: `the sound starts at ${round3(at)} s, after the video ends (${round3(END)} s)` });
    const duration = Math.max(1, Math.min(frames(at + dur), durationInFrames) - from);
    return {
      id: `sfx-${i + 1}`, from, duration, asset: sound(s.assetId, `$.data.sfx[${i}].assetId`),
      // A sound cut short by the end fades over at most half of what is left.
      gain: s.gain ?? 0.4, fadeIn: Math.min(9, duration >> 1), fadeOut: Math.min(18, duration >> 1), ...(s.offset ? { trimStart: frames(s.offset) } : {}), source: `sfx[${i}]`,
    };
  });
  const applause = data.applause
    ? (() => {
      const from = frames(VE + (data.applause.delay ?? 0.8));
      const dur = data.applause.dur ?? 5.7;
      const duration = Math.max(1, Math.min(frames(VE + (data.applause.delay ?? 0.8) + dur), durationInFrames) - from);
      return { id: "applause", from, duration, asset: sound(data.applause.assetId, "$.data.applause.assetId"), gain: data.applause.gain ?? 0.72, fadeIn: Math.min(12, duration >> 1), fadeOut: Math.min(40, duration >> 1), source: "applause" };
    })()
    : null;
  const music = data.music
    ? { id: "music", from: 0, duration: durationInFrames, asset: sound(data.music.assetId, "$.data.music.assetId"), gain: data.music.gain ?? 0.6, fadeIn: 15, fadeOut: 45, source: "music" }
    : null;
  if (problems.length > 0) return { ok: false, problems };

  // ── Tracks ────────────────────────────────────────────────────────────────
  const whole = { from: 0, duration: durationInFrames };
  const tracks: EditTimeline["tracks"] = [
    {
      id: "hall", type: "visual", z: 0, items: [{
        id: "hall", ...whole, kit: KIT("museum-hall"), source: "hall",
        props: {
          room, screen: SCREEN, pictures, camera, flash: { strikes }, lights,
          ...(blackout ? { blackout } : {}), ...(bolt ? { bolt } : {}), ...(wind.length ? { wind } : {}), ...(shatter.length ? { shatter } : {}),
          pedestal: hall.pedestal ?? true,
          actor: { x: ACTOR.x, scale: ACTOR.scale, liveFrom: live.from, liveTo: live.to },
          ...(Object.keys(textures).length ? { textures } : {}),
        },
      }],
    },
    ...lanes(roomItems).map((items, i) => ({ id: `room-${i + 1}`, type: "visual" as const, z: 10 + i, items })),
    ...lanes(plateItems).map((items, i) => ({ id: `verses-${i + 1}`, type: "visual" as const, z: 20 + i, items })),
    {
      id: "actor", type: "visual", z: 30, items: [{
        id: "actor", ...whole, kit: KIT("interprete"), source: "actor",
        props: {
          variant: actor.variant, ...(actor.outfit ? { outfit: actor.outfit } : {}), ...(actor.hairstyle ? { hairstyle: actor.hairstyle } : {}),
          ...(actor.accessories ? { accessories: actor.accessories } : {}), palette,
          x: ACTOR.x, footY: ACTOR.footY, scale: ACTOR.scale, poses, expressions, gaze, blinks, live,
          bow: { from: round3(VE + 2.5), to: round3(VE + 4.7) },
          mouth: { energy, speech, from: round3(L(1) - 0.1), to: round3(VE) },
          ...(teleport ? { teleport } : {}), camera, flash: { strikes }, ...(blackout ? { blackout } : {}),
        },
      }],
    },
    { id: "card", type: "visual", z: 40, items: titleItems },
    { id: "chip", type: "visual", z: 41, items: [chipItem] },
    { id: "brand", type: "visual", z: 50, items: [{ id: "brand", ...whole, kit: KIT("brand-mark"), props: {}, source: "brand" }] },
    { id: "voice", type: "audio", items: voiceItems },
  ] as EditTimeline["tracks"];
  lanes(sfxItems).forEach((items, i) => tracks.push({ id: `sfx-${i + 1}`, type: "audio", items } as never));
  if (applause) tracks.push({ id: "applause", type: "audio", items: [applause] } as never);
  if (music) tracks.push({ id: "music", type: "audio", duck: { under: ["voice"], gain: data.music!.duck ?? 0.75 }, items: [music] } as never);

  const sections = [
    { id: "title", from: 0, duration: Math.max(1, frames(L(1))), source: "title" },
    ...LN.map((l, i) => {
      const from = frames(l.start);
      const to = i < LN.length - 1 ? frames(LN[i + 1]!.start) : frames(VE);
      return { id: `verse-${i + 1}`, from, duration: Math.max(1, to - from), source: `verses[${i}]` };
    }),
    { id: "bow", from: frames(VE), duration: durationInFrames - frames(VE), source: "applause" },
  ];

  const timeline = {
    apiVersion: "studio.video/v1alpha2",
    kind: "EditTimeline",
    episodeRef: { ...input.spec.episodeRef },
    revision: 1,
    derivedFrom: { spec: { path: SPEC_PATH, hash: specHash!, revision: input.spec.revision }, compiler: { id: compiler.id, version: compiler.version } },
    fps: FPS,
    durationInFrames,
    resolution: { width: profile.width, height: profile.height },
    profile: structuredClone(profile),
    assets,
    tracks,
    sections,
    metadata: {
      builtBy: `@studio/series ${compiler.id}@${compiler.version}`,
      template: { ...input.spec.template },
      inputs: Object.fromEntries(Object.entries(input.inputs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
      voiceEnd: round3(VE),
      end: round3(END),
    },
  } as EditTimeline;
  return { ok: true, timeline, warnings };
}

export const compiler: SeriesCompiler = {
  id: "dentro-i-versi-short",
  version: "1.0.0",
  description: "Dentro i versi · short: the title said, the poem recited by the interprete in a museum hall with its pictures, effects and titles, applause.",
  compile,
};
