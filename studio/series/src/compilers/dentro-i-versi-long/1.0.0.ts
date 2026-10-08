// dentro-i-versi-long@1.0.0 — released: never edit this file; add dentro-i-versi-long/<next>.ts instead.
//
// "Dentro i versi · long": the lesson on a poem (CreativeStudio's
// poesie-museo-long, runtime v10). Blocks follow each other — the opening in
// the atrio, the announcement, the recital, the story, the note on the text,
// one specimen per painting with its figure tool, the metre, the invitation,
// the annotated recital, the summary, the exit — each lasting its guide's take,
// with the chapters' cards between them. Every time inside a block is a cue
// on a word of its take. The look, the rooms and the characters are the
// pinned theme's; the poem's paintings and recital are the pinned source
// episode's (ADR-0035); the kits are the channel-neutral lesson kits
// (ADR-0040). The last frame is the first: the atrio and the cover.
//
// Channel specifics in code: the layout of this format (positions, the
// guide's place, durations of its pauses) and the poses' expressions, as the
// short's compiler — accepted for now; the boundary to restore is avg-d1x.

import { outputProfile } from "@studio/contracts/src/output-profiles.mjs";
import type { CompileInput, CompileProblem, CompileResult, EditTimeline, SeriesCompiler, WordTiming } from "../../types.js";

const FPS = 30;
const SPEC_PATH = "episode-spec.json";
const PROFILE = "youtube-1920x1080";
/** Silence before and after a block's take, and the default gap between blocks. */
const LEAD = 0.4;
const TAIL = 0.6;
const GAP = 1.0;
/** A chapter's card between two blocks. */
const CHAPTER = 4.0;
/** The cover the video opens and closes on. */
const COVER = 1.6;
/** The exit's default length (the end screens). */
const END = 14;
const GUIDE = { x: 1700, scale: 0.95 };
const PANEL = { x: 440, y: 150, w: 1060, h: 596 };
/** The verse bar between the block's title (bottom left) and the guide (right). */
const VERSE_WIDTH = 760;

const KIT = (name: string, version = "1.0.0") => ({ name, version });
const REST = { lu: 7, lf: 4, ru: 7, rf: 4, head: 0, lean: 0, grip: 0, step: 0, twist: 0, dip: 0 };
type Pose = typeof REST;
const EXPRESSIONS: Record<string, { li: number; lo: number; ri: number; ro: number; sm: number }> = {
  N: { li: 0, lo: 0, ri: 0, ro: 0, sm: 0.25 },
  A: { li: -6, lo: 3, ri: -6, ro: 3, sm: -0.5 },
  W: { li: 7, lo: 6, ri: 7, ro: 6, sm: 0 },
  I: { li: 7, lo: 5, ri: -2, ro: 0, sm: 0.8 },
  M: { li: 6, lo: -3, ri: 6, ro: -3, sm: -0.6 },
  S: { li: 3, lo: 2, ri: 3, ro: 2, sm: 0.9 },
};
const FIGURE_KITS = new Set(["merge", "cards", "stack", "oxymoron", "simile"]);
/** Keys whose values are cues, wherever they sit in a kit's props; `times` holds only cues; `read` and `strikes` lists of them. */
const CUE_KEYS = new Set(["at", "until", "glossAt", "lineFrom", "appear", "lit", "point", "merge"]);

type Cue = number | "end" | { word: string; n?: number; offset?: number };
interface Picture { asset: string; focus?: [number, number]; aspect?: number }
interface Block {
  id: string;
  kind: "opening" | "announcement" | "recital" | "story" | "note" | "specimen" | "meter" | "invite" | "summary" | "end";
  title: string;
  take?: string;
  lower?: { kicker: string; title: string; info?: string };
  chapterAfter?: { n: string; title: string; sub?: string };
  gapAfter?: number;
  gestures?: { at: Cue; pose: string; ex?: string }[];
  [key: string]: unknown;
}
interface Data {
  title: string;
  author: string;
  kicker?: string;
  source: { pin: string; titleTake: string; recitalTake: string };
  verses: { text: string; strong?: string[]; figure?: string }[];
  pictures: (Picture & { verses: number[] })[];
  blocks: Block[];
  sounds?: { theme?: string; sfx?: { asset: string; block: string; at: Cue; gain?: number }[] };
}

const frames = (seconds: number) => Math.round(seconds * FPS);
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const norm = (s: string) => s.toLocaleLowerCase("it-IT").normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, "");
const tokens = (text: string) => text.split(/\s+/).filter(Boolean);
const rnd = (i: number) => {
  const x = Math.sin(i * 127.1 + 11.7) * 43758.5453;
  return x - Math.floor(x);
};
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

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

interface Item {
  id: string;
  from: number;
  duration: number;
  kit: { name: string; version: string };
  props: Record<string, unknown>;
  source: string;
  transitionIn?: { type: "fade"; duration: number };
  transitionOut?: { type: "fade"; duration: number };
}

function compile(input: CompileInput): CompileResult {
  const data = input.spec.data as unknown as Data;
  const problems: CompileProblem[] = [];
  const warnings: string[] = [];
  const profile = outputProfile(PROFILE)!;
  const specHash = input.inputs[SPEC_PATH];
  const theme = input.theme;
  if (!theme?.layout) return { ok: false, problems: [{ code: "missing-theme", path: "$.template", message: "the release pins no theme: the long's look, rooms and characters are the theme's" }] };
  const look = theme.look;
  const source = input.sources?.[data.source.pin];
  if (!source) {
    return { ok: false, problems: [{ code: "missing-source", path: "$.data.source.pin", message: `no pinned episode "${data.source.pin}": pin the poem's source (vpr pin) as source/pins/${data.source.pin}.json` }] };
  }
  const assets: Record<string, { path: string; hash: string; kind: "image" | "audio" | "video" }> = {};
  const use = (id: string) => {
    assets[id] = { ...input.assets[id]! };
    return { $asset: id };
  };

  // ── Takes ─────────────────────────────────────────────────────────────────
  interface Take { id: string; asset: string; duration: number; timing: WordTiming }
  const guideTake = (id: string, path: string): Take | null => {
    const take = input.narration.takes.find((t) => t.id === id);
    const timing = input.timings[id];
    if (!take || !timing || !input.assets[`narration-${id}`]) {
      problems.push({ code: "missing-take", path, message: `no aligned guide take "${id}" in artifacts/narration/takes.json` });
      return null;
    }
    return { id, asset: `narration-${id}`, duration: take.audio.durationSeconds, timing };
  };
  const sourceTake = (id: string, path: string): Take | null => {
    const take = source.narration.takes.find((t) => t.id === id);
    const timing = source.timings[id];
    const asset = `source-${data.source.pin}-narration-${id}`;
    if (!take || !timing || !input.assets[asset]) {
      problems.push({ code: "missing-take", path, message: `the pinned source "${data.source.pin}" has no aligned take "${id}"` });
      return null;
    }
    return { id, asset, duration: take.audio.durationSeconds, timing };
  };
  const titleTake = sourceTake(data.source.titleTake, "$.data.source.titleTake");
  const recitalTake = sourceTake(data.source.recitalTake, "$.data.source.recitalTake");

  // ── Pictures ──────────────────────────────────────────────────────────────
  /** A picture by name: this episode's, else the pinned source's. */
  const pictureAsset = (name: string, path: string): { $asset: string } | null => {
    const own = `image-${name}`;
    const pinned = `source-${data.source.pin}-image-${name}`;
    const id = input.assets[own] ? own : input.assets[pinned] ? pinned : null;
    if (!id) {
      problems.push({ code: "missing-asset", path, message: `no picture "${name}" in assets/images nor in the pinned source` });
      return null;
    }
    return use(id);
  };
  /** A picture as the panel frames it (src, focus); the figure tools also take its aspect. */
  const framed = (p: Picture, path: string, withAspect = false) => {
    const src = pictureAsset(p.asset, path);
    return src ? { src, ...(p.focus ? { focus: p.focus } : {}), ...(withAspect && p.aspect ? { aspect: p.aspect } : {}) } : null;
  };
  const painting = (i: number, path: string, withAspect = false) => {
    const p = data.pictures[i];
    if (!p) {
      problems.push({ code: "no-such-picture", path, message: `there is no picture ${i} (the spec has ${data.pictures.length})` });
      return null;
    }
    return framed(p, `$.data.pictures[${i}].asset`, withAspect);
  };
  const sound = (name: string, path: string): { $asset: string } | null => {
    for (const id of [`sound-${name}`, `source-${data.source.pin}-sound-${name}`]) if (input.assets[id]) return use(id);
    warnings.push(`no sound "${name}" (${path}): it is left out`);
    return null;
  };

  // ── The recital's verses in the source's timing ──────────────────────────
  const verseWords: { text: string; start: number; end: number }[][] = [];
  if (recitalTake) {
    let k = 0;
    const words = recitalTake.timing.words;
    data.verses.forEach((v, i) => {
      const n = tokens(v.text).length;
      const slice = words.slice(k, k + n);
      if (slice.length < n) problems.push({ code: "verse-mismatch", path: `$.data.verses[${i}].text`, message: `the recital's timing has ${words.length} words; verse ${i + 1} needs words ${k + 1}–${k + n}` });
      verseWords.push(slice);
      k += n;
    });
    if (k !== words.length && problems.length === 0) {
      problems.push({ code: "verse-mismatch", path: "$.data.verses", message: `the verses have ${k} words, the recital's timing ${words.length}` });
    }
  }

  // ── Blocks in time ────────────────────────────────────────────────────────
  interface Placed { block: Block; index: number; start: number; speech: number; take: Take | null; end: number; next: number; chapter: [number, number] | null }
  const placed: Placed[] = [];
  let t = 0;
  data.blocks.forEach((block, index) => {
    const path = `$.data.blocks[${index}]`;
    let take: Take | null = null;
    if (block.kind === "announcement") take = titleTake;
    else if (block.kind === "recital") take = recitalTake;
    else if (block.take) take = guideTake(block.take, `${path}.take`);
    const lead = block.kind === "opening" ? COVER : LEAD;
    const start = t;
    const speech = start + lead;
    const length = take ? lead + take.duration + TAIL : (block.minDuration as number | undefined) ?? END;
    const end = start + Math.max(length, block.kind === "end" ? ((block.minDuration as number | undefined) ?? END) : 0);
    const gap = index === data.blocks.length - 1 ? 0 : block.gapAfter ?? GAP;
    const chapter: [number, number] | null = block.chapterAfter ? [end + gap, end + gap + CHAPTER] : null;
    const next = end + gap + (chapter ? CHAPTER : 0);
    placed.push({ block, index, start, speech, take, end, next, chapter });
    t = next;
  });
  const total = placed[placed.length - 1]!.end;
  const durationInFrames = frames(total);

  /** A cue of a block, in seconds from the block's start. */
  const cueOf = (p: Placed, cue: unknown, path: string): number => {
    const lead = p.speech - p.start;
    if (typeof cue === "number") return cue;
    if (cue === "end") return p.take ? lead + p.take.duration : p.end - p.start;
    if (isObject(cue) && typeof cue.word === "string") {
      if (!p.take) {
        problems.push({ code: "cue-not-found", path, message: `"${cue.word}": block "${p.block.id}" has no take to find it in` });
        return 0;
      }
      const want = norm(cue.word);
      const n = typeof cue.n === "number" ? cue.n : 1;
      // Italian elides: "italia" is said in «L'Italia», "assedio" in «d'assedio».
      const hits = p.take.timing.words.filter((w) => norm(w.text) === want || w.text.split(/['’]/).some((part) => norm(part) === want));
      const hit = hits[n - 1];
      if (!hit) {
        problems.push({ code: "cue-not-found", path, message: `"${cue.word}"${n > 1 ? ` (occurrence ${n})` : ""} is not said in take "${p.take.id}" (${hits.length} found)` });
        return 0;
      }
      return round3(lead + hit.start + (typeof cue.offset === "number" ? cue.offset : 0));
    }
    problems.push({ code: "bad-cue", path, message: "a cue is seconds, \"end\" or {word, n?, offset?}" });
    return 0;
  };
  /** Kit props with their cues resolved and their pictures named as assets. */
  const resolve = (p: Placed, value: unknown, path: string, key = ""): unknown => {
    if (CUE_KEYS.has(key) && (typeof value === "number" || value === "end" || (isObject(value) && "word" in value))) return round3(cueOf(p, value, path));
    if ((key === "read" || key === "strikes") && Array.isArray(value)) return value.map((v, i) => round3(cueOf(p, v, `${path}[${i}]`)));
    if (key === "times" && isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, round3(cueOf(p, v, `${path}.${k}`))]));
    if (Array.isArray(value)) return value.map((v, i) => resolve(p, v, `${path}[${i}]`));
    if (isObject(value)) {
      const keys = Object.keys(value);
      if (keys.length === 1 && keys[0] === "asset" && typeof value.asset === "string") return pictureAsset(value.asset, `${path}.asset`) ?? { $asset: "missing" };
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(p, v, `${path}.${k}`, k)]));
    }
    return value;
  };

  const items: { room: Item[]; stage: Item[]; people: Item[]; overlay: Item[]; cards: Item[] } = { room: [], stage: [], people: [], overlay: [], cards: [] };
  const audio: { voice: Record<string, unknown>[]; recital: Record<string, unknown>[]; music: Record<string, unknown>[]; sfx: Record<string, unknown>[] } = { voice: [], recital: [], music: [], sfx: [] };
  const fade = (seconds: number) => ({ type: "fade" as const, duration: frames(seconds) });
  const span = (from: number, to: number) => ({ from: frames(from), duration: Math.max(1, frames(to) - frames(from)) });

  // ── Rooms: the atrio at the opening and the exit, the hall between ───────
  const roomProps = (name: string) => {
    const room = theme.rooms[name];
    if (!room) {
      problems.push({ code: "missing-room", path: "$.template", message: `the theme has no room "${name}"` });
      return null;
    }
    use(`theme-${name}`);
    if (room.monitor) use(`theme-${name}-monitor`);
    return {
      image: { $asset: `theme-${name}` },
      ...(room.sky ? { sky: room.sky } : {}),
      ...(room.windows ? { windows: room.windows } : {}),
      ...(room.doors ? { doors: room.doors } : {}),
      ...(room.monitor ? { monitor: { box: room.monitor.box, video: { $asset: `theme-${name}-monitor` } } } : {}),
    };
  };
  const hallRuns: [number, number][] = [];
  for (const p of placed) {
    const to = p === placed[placed.length - 1] ? p.end : p.next;
    if (p.block.kind === "opening" || p.block.kind === "end") {
      const room = roomProps("atrio");
      const length = to - p.start;
      // Still at the loop's edges: no drift, no lightning at the first and last frame.
      if (room) items.room.push({ id: `room-${p.block.id}`, ...span(p.start, to), kit: KIT("room"), source: `blocks[${p.index}]`, props: { look, room, drift: false, quiet: p.block.kind === "opening" ? [[-1, 0.6]] : [[round3(length - 0.6), round3(length + 1)]] } });
    } else {
      const last = hallRuns[hallRuns.length - 1];
      if (last && Math.abs(last[1] - p.start) < 1e-9) last[1] = to;
      else hallRuns.push([p.start, to]);
    }
  }
  hallRuns.forEach(([from, to], i) => {
    const room = roomProps("sala");
    if (room) items.room.push({ id: `room-hall-${i + 1}`, ...span(from, to), kit: KIT("room"), source: "blocks", props: { look, room } });
  });

  // ── The guide, and the actor in the recitals ─────────────────────────────
  const character = (id: string) => {
    const c = theme.characters[id];
    if (!c) {
      problems.push({ code: "missing-character", path: "$.template", message: `the theme has no character "${id}"` });
      return null;
    }
    const { poses: _poses, ...rest } = c as unknown as Record<string, unknown>;
    return rest;
  };
  const posesOf = (id: string) => ((theme.characters[id] as { poses?: Record<string, Partial<Pose>> } | undefined)?.poses ?? {});
  const mouthOf = (take: Take, lead: number, to: number) => {
    const energy = (take.timing as unknown as { energy?: { rate: number; values: number[] } }).energy;
    const speech = ((take.timing as unknown as { speech?: [number, number][] }).speech ?? []).map(([a, b]) => [round3(a + lead), round3(b + lead)] as [number, number]);
    if (!energy) warnings.push(`take "${take.id}" carries no energy: the mouth stays closed`);
    return {
      energy: energy ? { rate: energy.rate, values: [...new Array(Math.round(lead * energy.rate)).fill(0), ...energy.values] } : { rate: FPS, values: [] as number[] },
      speech,
      from: round3(lead),
      to: round3(Math.min(to, lead + take.duration)),
    };
  };
  const blinksFor = (length: number, seed: number) => {
    const out: number[] = [];
    for (let b = 1.1, i = seed; b < length; i++) {
      out.push(round3(b));
      b += 2 + 3 * rnd(i + 3);
    }
    return out;
  };
  const guide = character("guida");
  const actor = character("attore-illuminato");
  for (const p of placed) {
    const to = (p === placed[placed.length - 1] ? p.end : p.chapter ? p.chapter[0] : p.next);
    const length = to - p.start;
    const lead = p.speech - p.start;
    if (p.block.kind === "recital") {
      if (!actor || !p.take) continue;
      const annotated = p.block.annotated === true;
      const second = annotated ? { ...actor, palette: { ...(actor.palette as Record<string, string>), vest: look.colors.highlight, vestLight: look.colors.glow } } : actor;
      items.people.push({
        id: `actor-${p.block.id}`, ...span(p.start, to), kit: KIT("interprete", "1.1.0"), source: `blocks[${p.index}]`,
        props: {
          look, character: second, x: GUIDE.x, footY: theme.layout.floorY, scale: GUIDE.scale,
          poses: [{ at: 0, pose: { ...REST, ...(posesOf("attore-illuminato").invoca ?? {}) } }, { at: round3(length - 1), pose: REST }],
          blinks: blinksFor(length, p.index), mouth: mouthOf(p.take, lead, length),
          teleport: { in: { at: 0, dur: 1.0 }, out: { at: round3(length - 1.2), dur: 1.0 } },
        },
        transitionIn: fade(0.3),
      });
      continue;
    }
    if (!guide) continue;
    const poses = [{ at: 0, pose: REST }, ...(p.block.gestures ?? []).map((g, i) => {
      const preset = posesOf("guida")[g.pose];
      if (!preset) problems.push({ code: "unknown-pose", path: `$.data.blocks[${p.index}].gestures[${i}].pose`, message: `the theme's guide has no pose "${g.pose}"` });
      return { at: round3(cueOf(p, g.at, `$.data.blocks[${p.index}].gestures[${i}].at`)), pose: { ...REST, ...(preset ?? {}) } };
    })].sort((a, b) => a.at - b.at);
    const expressions = [{ at: 0, ex: EXPRESSIONS.N! }, ...(p.block.gestures ?? []).filter((g) => g.ex).map((g, i) => ({ at: round3(cueOf(p, g.at, `$.data.blocks[${p.index}].gestures[${i}].at`)), ex: EXPRESSIONS[g.ex!] ?? EXPRESSIONS.N! }))].sort((a, b) => a.at - b.at);
    items.people.push({
      id: `guide-${p.block.id}`, ...span(p.start, to), kit: KIT("interprete", "1.1.0"), source: `blocks[${p.index}]`,
      props: {
        look, character: guide, x: GUIDE.x, footY: theme.layout.floorY, scale: GUIDE.scale, poses, expressions,
        blinks: blinksFor(length, p.index),
        ...(p.take ? { mouth: mouthOf(p.take, lead, length) } : {}),
        // She arrives in the atrio and leaves it: the first and the last frame are empty.
        ...(p.block.kind === "opening" ? { teleport: { in: { at: 0.6, dur: 1.0 }, out: { at: round3(length - 1.2), dur: 1.0 } } } : {}),
        ...(p.block.kind === "end" ? { teleport: { in: { at: 0, dur: 1.0 }, out: { at: round3(Math.max(1.5, length - COVER - 3)), dur: 1.2 } } } : {}),
      },
    });
  }

  // ── Each block's stage and overlays ───────────────────────────────────────
  const specimens = placed.filter((p) => p.block.kind === "specimen");
  const verseLine = (i: number, at0?: number) => tokens(data.verses[i]!.text).map((text, j) => {
    const hot = (data.verses[i]!.strong ?? []).some((s) => norm(s) === norm(text));
    const w = at0 !== undefined ? verseWords[i]?.[j] : undefined;
    return { text, ...(hot ? { hot: true } : {}), ...(w && at0 !== undefined ? { at: Math.max(0, round3(w.start - at0)) } : {}) };
  });
  for (const p of placed) {
    const b = p.block;
    const path = `$.data.blocks[${p.index}]`;
    const src = `blocks[${p.index}]`;
    const to = p.end;
    const length = to - p.start;
    const whole = span(p.start, to);
    // The block's title and its verse bar share the bottom of the frame: where verses are shown, the title
    // stays 3 s and the verses come after it.
    const versed = b.kind === "recital" || b.kind === "meter" || b.kind === "specimen";
    const lowerEnd = b.lower ? p.start + Math.min(length, versed ? 3.3 : 6) : p.start;
    const afterLower = (from: number) => (b.lower ? Math.max(from, lowerEnd + 0.1) : from);
    if (b.lower) {
      items.overlay.push({ id: `lower-${b.id}`, ...span(p.start + 0.3, lowerEnd), kit: KIT("block-title"), source: `${src}.lower`, props: { look, ...b.lower }, transitionIn: fade(0.4), transitionOut: fade(0.5) });
    }
    switch (b.kind) {
      case "opening": {
        const cover = b.cover as { kicker?: string; titleLines: string[]; hookLines?: string[] };
        items.stage.push({ id: "cover-open", ...span(0, COVER), kit: KIT("cover"), source: `${src}.cover`, props: { look, ...cover, icon: "bolt" }, transitionOut: fade(0.6) });
        const enter = cueOf(p, b.enter, `${path}.enter`);
        items.cards.push({ id: "warp-enter", ...span(p.start + enter, p.start + enter + 1.2), kit: KIT("warp"), source: `${src}.enter`, props: { look } });
        break;
      }
      case "announcement": {
        const pic = (b.picture as Picture | undefined) ? framed(b.picture as Picture, `${path}.picture.asset`) : painting(0, `${path}.picture`);
        if (pic) items.stage.push({ id: `panel-${b.id}`, ...whole, kit: KIT("panel", "1.1.0"), source: src, props: { look, appear: { at: 0, dur: 0.8 }, phases: [{ at: 0, layers: [{ picture: pic, shade: 0.35 }] }] } });
        items.overlay.push({
          id: `title-${b.id}`, ...span(p.start + 0.5, to), kit: KIT("text-stack"), source: src, transitionOut: fade(0.4),
          props: { look, x: PANEL.x + PANEL.w / 2, y: PANEL.y + 170, width: 900, align: "center", items: [{ kind: "kicker", text: (data.kicker ?? data.author).toUpperCase(), at: 0 }, { kind: "big", text: data.title.toUpperCase(), at: 0.2 }] },
        });
        break;
      }
      case "recital": {
        const at0 = p.speech - p.start;
        const groups = data.pictures.map((pic, i) => ({ i, at: verseWords[pic.verses[0] ?? 0]?.[0]?.start }));
        const phases = groups.map((g, k) => {
          const pic = painting(g.i, `${path}.pictures[${g.i}]`);
          return pic ? { at: k === 0 ? 0 : round3(at0 + (g.at ?? 0) - 0.6), layers: [{ picture: pic }] } : null;
        }).filter(Boolean);
        if (phases.length) items.stage.push({ id: `panel-${b.id}`, ...whole, kit: KIT("panel", "1.1.0"), source: src, props: { look, appear: { at: 0, dur: 0.8 }, spin: false, phases } });
        data.verses.forEach((_v, i) => {
          const words = verseWords[i];
          if (!words?.length) return;
          const from = afterLower(p.speech + words[0]!.start - 0.3);
          const until = i < data.verses.length - 1 ? p.speech + (verseWords[i + 1]?.[0]?.start ?? words[words.length - 1]!.end) - 0.3 : p.speech + words[words.length - 1]!.end + 1.2;
          items.overlay.push({ id: `verse-${b.id}-${i + 1}`, ...span(from, until), kit: KIT("verse-bar"), source: `verses[${i}]`, props: { look, width: VERSE_WIDTH, kicker: `${data.title.toUpperCase()} · ${i + 1}/${data.verses.length}`, lines: [verseLine(i, from - p.speech)] } });
          if (b.annotated && data.verses[i]!.figure) {
            items.overlay.push({ id: `figure-${b.id}-${i + 1}`, ...span(from, until), kit: KIT("figure-title"), source: `verses[${i}].figure`, props: { look, kicker: data.title.toUpperCase(), text: data.verses[i]!.figure!.toUpperCase(), x: PANEL.x + PANEL.w / 2, y: PANEL.y + 60 }, transitionIn: fade(0.3), transitionOut: fade(0.3) });
          }
        });
        break;
      }
      case "story": {
        const phases = b.phases as { at: Cue; layers: unknown[]; texts?: Record<string, unknown>[]; fx?: unknown[]; timeline?: Record<string, unknown> }[];
        const ats = phases.map((ph, i) => round3(cueOf(p, ph.at, `${path}.phases[${i}].at`)));
        const panelPhases = phases.map((ph, i) => ({ at: i === 0 ? 0 : Math.max(ats[i]!, 0.01), layers: resolve(p, ph.layers, `${path}.phases[${i}].layers`) }));
        items.stage.push({ id: `panel-${b.id}`, ...whole, kit: KIT("panel", "1.1.0"), source: src, props: { look, appear: { at: 0, dur: 0.8 }, phases: panelPhases } });
        phases.forEach((ph, i) => {
          const until = i < phases.length - 1 ? ats[i + 1]! - 0.3 : undefined;
          (ph.texts ?? []).forEach((stack, j) => {
            const texts = resolve(p, stack, `${path}.phases[${i}].texts[${j}]`) as { items: Record<string, unknown>[] } & Record<string, unknown>;
            // a phase's texts leave when the next phase comes, unless they say otherwise
            const withUntil = (list: Record<string, unknown>[]): Record<string, unknown>[] => list.map((it) => ("row" in it ? { ...it, row: withUntil(it.row as Record<string, unknown>[]) } : "space" in it || it.until !== undefined || until === undefined ? it : { ...it, until: round3(until) }));
            items.overlay.push({ id: `texts-${b.id}-${i + 1}-${j + 1}`, ...whole, kit: KIT("text-stack"), source: `${src}.phases[${i}].texts[${j}]`, props: { look, ...texts, items: withUntil(texts.items) } });
          });
          if (ph.fx) items.stage.push({ id: `fx-${b.id}-${i + 1}`, ...whole, kit: KIT("story-fx"), source: `${src}.phases[${i}].fx`, props: { look, effects: resolve(p, ph.fx, `${path}.phases[${i}].fx`) } });
          if (ph.timeline) items.stage.push({ id: `timeline-${b.id}-${i + 1}`, ...whole, kit: KIT("timeline"), source: `${src}.phases[${i}].timeline`, props: { look, ...(resolve(p, ph.timeline, `${path}.phases[${i}].timeline`) as object) } });
        });
        break;
      }
      case "note": {
        const quote = b.quote as { at: Cue; picture: Picture; interlinear: Record<string, unknown>; title?: Record<string, unknown> } | undefined;
        const quoteAt = quote ? cueOf(p, quote.at, `${path}.quote.at`) : length;
        if (b.tracks) {
          items.stage.push({ id: `tracks-${b.id}`, ...span(p.start, p.start + quoteAt), kit: KIT("word-tracks"), source: `${src}.tracks`, props: { look, lines: data.verses.map((v) => v.text), ...(resolve(p, b.tracks, `${path}.tracks`) as object) }, transitionOut: fade(0.4) });
        }
        if (b.counts) items.overlay.push({ id: `counts-${b.id}`, ...span(p.start, p.start + quoteAt), kit: KIT("text-stack"), source: `${src}.counts`, props: { look, ...(resolve(p, b.counts, `${path}.counts`) as object) }, transitionOut: fade(0.4) });
        if (quote) {
          const pic = framed(quote.picture, `${path}.quote.picture.asset`);
          if (pic) items.stage.push({ id: `quote-${b.id}`, ...span(p.start + quoteAt, to), kit: KIT("panel", "1.1.0"), source: `${src}.quote`, props: { look, appear: { at: 0, dur: 0.8 }, phases: [{ at: 0, layers: [{ picture: pic, shade: "quote" }] }] } });
          // the interlinear's times are from the quote's start
          const lin = resolve(p, quote.interlinear, `${path}.quote.interlinear`) as Record<string, unknown>;
          const rebase = (v: unknown): unknown => (Array.isArray(v) ? v.map(rebase) : isObject(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, (k === "at" || k === "glossAt") && typeof x === "number" ? round3(x - quoteAt) : rebase(x)])) : v);
          items.overlay.push({ id: `interlinear-${b.id}`, ...span(p.start + quoteAt, to), kit: KIT("interlinear"), source: `${src}.quote.interlinear`, props: { look, ...(rebase(lin) as object) }, transitionIn: fade(0.4) });
          if (quote.title) items.overlay.push({ id: `quote-title-${b.id}`, ...span(p.start + quoteAt, to), kit: KIT("text-stack"), source: `${src}.quote.title`, props: { look, ...(rebase(resolve(p, quote.title, `${path}.quote.title`)) as object) } });
        }
        break;
      }
      case "specimen": {
        const i = b.picture as number;
        const figure = b.figure as { kind: string; props: Record<string, unknown> };
        if (!FIGURE_KITS.has(figure.kind)) problems.push({ code: "unknown-figure", path: `${path}.figure.kind`, message: `"${figure.kind}" is not a figure tool` });
        const pic = painting(i, `${path}.picture`, true);
        if (pic) {
          items.stage.push({ id: `figure-${b.id}`, ...whole, kit: KIT(figure.kind), source: `${src}.figure`, props: { look, picture: pic, ...(resolve(p, figure.props, `${path}.figure.props`) as object) } });
        }
        const k = specimens.indexOf(p);
        items.overlay.push({ id: `progress-${b.id}`, ...whole, kit: KIT("progress"), source: src, props: { look, steps: specimens.map((s) => ({ label: s.block.keyword as string })), current: k, done: k } });
        const verses = b.verses as number[];
        items.overlay.push({ id: `verses-${b.id}`, ...span(afterLower(p.start), to), kit: KIT("verse-bar"), source: `${src}.verses`, props: { look, width: VERSE_WIDTH, kicker: `${data.title.toUpperCase()} · ${(b.keyword as string).toUpperCase()}`, lines: verses.slice(0, 3).map((v) => verseLine(v)), ...(verses.length > 1 ? { size: 46 } : {}) } });
        const headline = b.headline as { kicker?: string; text: string; at: Cue; until?: Cue } | undefined;
        if (headline) {
          const from = cueOf(p, headline.at, `${path}.headline.at`);
          const until = headline.until !== undefined ? cueOf(p, headline.until, `${path}.headline.until`) : length;
          items.overlay.push({ id: `headline-${b.id}`, ...span(p.start + from, p.start + until), kit: KIT("figure-title"), source: `${src}.headline`, props: { look, kicker: headline.kicker ?? data.title.toUpperCase(), text: headline.text, x: PANEL.x + PANEL.w / 2, y: PANEL.y + PANEL.h / 2 - 60 }, transitionIn: fade(0.3), transitionOut: fade(0.3) });
        }
        break;
      }
      case "meter": {
        const split = cueOf(p, b.rhymesAt, `${path}.rhymesAt`);
        items.stage.push({ id: `syllables-${b.id}`, ...span(p.start, p.start + split), kit: KIT("syllables"), source: `${src}.syllables`, props: { look, ...(resolve(p, b.syllables, `${path}.syllables`) as object) }, transitionOut: fade(0.4) });
        const rhymes = resolve(p, b.rhymes, `${path}.rhymes`) as Record<string, unknown>;
        const rebased = { ...rhymes, times: Object.fromEntries(Object.entries((rhymes.times ?? {}) as Record<string, number>).map(([k, v]) => [k, round3(v - split)])) };
        items.stage.push({ id: `rhymes-${b.id}`, ...span(p.start + split, to), kit: KIT("rhymes"), source: `${src}.rhymes`, props: { look, ...rebased }, transitionIn: fade(0.4) });
        if (typeof b.verse === "number") items.overlay.push({ id: `verses-${b.id}`, ...span(afterLower(p.start), p.start + split), kit: KIT("verse-bar"), source: `${src}.verse`, props: { look, width: VERSE_WIDTH, lines: [verseLine(b.verse)] } });
        break;
      }
      case "invite": {
        const cells = data.pictures.map((_pic, i) => painting(i, `${path}.cells`)).filter(Boolean).map((c) => ({ src: c!.src, ...(c!.focus ? { focus: c!.focus } : {}) }));
        items.stage.push({ id: `wall-${b.id}`, ...whole, kit: KIT("monitor-wall"), source: src, props: { look, cells: cells.slice(0, 8), appear: 0.2, caption: resolve(p, b.caption, `${path}.caption`) } });
        break;
      }
      case "summary": {
        const rows = (b.rows as { picture: number; keyword: string; figure: string; at: Cue }[]).map((r, i) => {
          const pic = painting(r.picture, `${path}.rows[${i}].picture`);
          return { src: pic?.src ?? { $asset: "missing" }, ...(pic?.focus ? { focus: pic.focus } : {}), keyword: r.keyword, figure: r.figure, at: round3(cueOf(p, r.at, `${path}.rows[${i}].at`)) };
        });
        items.stage.push({ id: `summary-${b.id}`, ...whole, kit: KIT("summary"), source: src, props: { look, rows, ...(b.closing ? { closing: resolve(p, b.closing, `${path}.closing`) } : {}), ...(b.lit !== undefined ? { lit: round3(cueOf(p, b.lit, `${path}.lit`)) } : {}) } });
        break;
      }
      case "end": {
        const cover = (data.blocks[0]!.cover ?? { titleLines: [data.title.toUpperCase()] }) as Record<string, unknown>;
        items.stage.push({ id: "cover-close", ...span(total - COVER, total), kit: KIT("cover"), source: "blocks[0].cover", props: { look, ...cover, icon: "bolt" }, transitionIn: fade(0.6) });
        break;
      }
    }
    if (p.chapter) {
      const c = b.chapterAfter!;
      items.cards.push({ id: `chapter-${b.id}`, ...span(p.chapter[0], p.chapter[1]), kit: KIT("chapter-opener"), source: `${src}.chapterAfter`, props: { look, kicker: c.n, title: c.title, ...(c.sub ? { sub: c.sub } : {}) }, transitionIn: fade(0.3), transitionOut: fade(0.3) });
    }
    // ── The block's voice ──
    if (p.take) {
      const track = b.kind === "recital" || b.kind === "announcement" ? audio.recital : audio.voice;
      const from = frames(p.speech);
      track.push({ id: `voice-${b.id}`, from, duration: Math.max(1, Math.min(frames(p.speech + p.take.duration), durationInFrames) - from), asset: use(p.take.asset).$asset, source: b.kind === "recital" || b.kind === "announcement" ? "source" : `blocks[${p.index}].take` });
    }
  }

  // ── Sound ─────────────────────────────────────────────────────────────────
  if (data.sounds?.theme) {
    const theme_ = sound(data.sounds.theme, "$.data.sounds.theme");
    if (theme_) {
      const open = placed[0]!;
      audio.music.push({ id: "theme-open", ...span(0, open.end), asset: theme_.$asset, gain: 0.5, fadeIn: 6, fadeOut: 30, source: "sounds.theme" });
      const close = placed[placed.length - 1]!;
      audio.music.push({ id: "theme-close", ...span(close.start, total), asset: theme_.$asset, gain: 0.5, fadeIn: 30, fadeOut: 6, source: "sounds.theme" });
    }
  }
  (data.sounds?.sfx ?? []).forEach((s, i) => {
    const p = placed.find((x) => x.block.id === s.block);
    if (!p) {
      problems.push({ code: "no-such-block", path: `$.data.sounds.sfx[${i}].block`, message: `there is no block "${s.block}"` });
      return;
    }
    const asset = sound(s.asset, `$.data.sounds.sfx[${i}].asset`);
    if (!asset) return;
    const at = p.start + cueOf(p, s.at, `$.data.sounds.sfx[${i}].at`);
    audio.sfx.push({ id: `sfx-${i + 1}`, ...span(at, Math.min(total, at + 3)), asset: asset.$asset, gain: s.gain ?? 0.4, fadeIn: 3, fadeOut: 12, source: `sounds.sfx[${i}]` });
  });

  if (problems.length > 0) return { ok: false, problems };

  // ── Tracks ────────────────────────────────────────────────────────────────
  const tracks: Record<string, unknown>[] = [];
  let z = 0;
  const visual = (name: string, list: Item[], base: number) => lanes(list).forEach((laneItems, i) => tracks.push({ id: `${name}-${i + 1}`, type: "visual", z: base + i, items: laneItems }));
  visual("room", items.room, z);
  visual("stage", items.stage, (z += 10));
  visual("people", items.people, (z += 10));
  visual("overlay", items.overlay, (z += 10));
  tracks.push({ id: "brand", type: "visual", z: (z += 10), items: [{ id: "brand", from: 0, duration: durationInFrames, kit: KIT("brand-mark", "2.0.0"), source: "theme.brand", props: { look, text: theme.brand.text, icon: theme.brand.icon ?? "bolt" } }] });
  visual("cards", items.cards, (z += 10));
  tracks.push({ id: "voice", type: "audio", items: audio.voice });
  tracks.push({ id: "recital", type: "audio", items: audio.recital });
  if (audio.music.length) tracks.push({ id: "music", type: "audio", duck: { under: ["voice", "recital"], gain: 0.75 }, items: audio.music });
  lanes(audio.sfx as unknown as { from: number; duration: number }[]).forEach((laneItems, i) => tracks.push({ id: `sfx-${i + 1}`, type: "audio", items: laneItems }));

  const sections = [
    ...placed.map((p, i) => ({ id: `block-${p.block.id}`, ...span(p.start, i < placed.length - 1 ? (p.chapter ? p.chapter[0] : p.next) : p.end), source: `blocks[${p.index}]` })),
    ...placed.filter((p) => p.chapter).map((p, k) => ({ id: `chapter-${k + 1}`, ...span(p.chapter![0], p.chapter![1]), source: `blocks[${p.index}].chapterAfter`, chapter: { title: p.block.chapterAfter!.title } })),
  ].sort((a, b) => a.from - b.from);

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
    loop: true,
    metadata: {
      builtBy: `@studio/series ${compiler.id}@${compiler.version}`,
      template: { ...input.spec.template },
      inputs: Object.fromEntries(Object.entries(input.inputs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
      blocks: placed.map((p) => ({ id: p.block.id, kind: p.block.kind, start: round3(p.start), speech: round3(p.speech), end: round3(p.end) })),
      end: round3(total),
    },
  } as unknown as EditTimeline;
  return { ok: true, timeline, warnings };
}

export const compiler: SeriesCompiler = {
  id: "dentro-i-versi-long",
  version: "1.0.0",
  description: "Dentro i versi · long: the lesson on a poem, block after block — atrio, recital, story, note, one figure tool per painting, metre, invitation, annotated recital, summary, exit — in the channel theme's look, its cues on the guide's words.",
  compile,
};
