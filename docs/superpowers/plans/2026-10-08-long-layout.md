# The Long Lesson's Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `avg-dcf.6.9`. Fix the faults the long lesson's first real layout sheet showed, in compiler `dentro-i-versi-long@1.1.0`:
- the panel's box comes from the theme;
- writing stays on the glass;
- the note's tracks get their glass;
- titles sit in the panel's lower band;
- the guide steps in to x 1650.

Also:
- a template release can name a new compiler version;
- an episode's draft spec can move to a newer release.

**Architecture:**
- **Series.** `compilers/dentro-i-versi-long/1.1.0.ts` is a new released version beside 1.0.0, which is unchanged. It comes with its fixture (`fixtures/dentro-i-versi-long/1.1.0/`: the release, the input with Il lampo's text stacks moved onto the glass, and the golden).
- **Runtime.** `releaseTemplate` and `vpr template release` gain `compiler` and `validator` (`--compiler`, `--validator`).
- **Episode.**
  - `upgradeEpisodeSpec` lets a draft's unfilled values through the schema.
  - `divLongEpisode` takes `version`.

**Tech Stack:**
- TypeScript;
- `node:test` in series, vitest elsewhere.

**Spec:** `docs/superpowers/specs/2026-10-08-long-layout-design.md`, on this branch.

Prototype: the local commit `b224b44` on `scratch/long-layout`. Never push or merge it. It passed:
- series 170;
- episode 242 (4 skipped);
- runtime 670;
- agent 212 (3 skipped);
- adapters 46;
- `docs:check`;
- root `npm run check`.

## Global Constraints

- Work on branch `feat/long-layout`, in the main checkout.
- Never push or merge without the user's go.
- Never stage `.beads/`, `studio/gateway/src/workspace/filesystem-service.ts` or `studio/gateway/test/workspace-filesystem.test.ts`. Never run `bd`. Use explicit `git add` paths.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Code goes in exactly as shown. No dependency changes.
- **Taking the fixture.** The fixture folder is large and generated, so take it whole:

  ```bash
  git -C "$(git rev-parse --show-toplevel)" checkout b224b44 -- studio/series/fixtures/dentro-i-versi-long/1.1.0
  ```

  It must equal the prototype's.
- **Rebuild before dependent tests.**
  - Episode reads `@studio/series` from `dist/`: run `npm run build --workspace @studio/series`.
  - Agent and adapters read `@studio/episode` from `dist/`: run `npm run build --workspace @studio/episode`.
  - The runtime's CLI test spawns `dist/`: run it with `npm test -w @studio/runtime`.
- `ls` in this shell can hang. Use `/bin/ls`.

## Review Focus

- **1.0.0 must not move.** Its file and golden are released. `golden.test.ts` compiles every registered version against its fixture, so a change to 1.0.0's output fails there.
- **No clamping.** A text stack off the panel must stop compilation with `text-off-panel` at its path. Task 1 pins three such paths.
- **A theme without `layout.panel`.** 1.0.0's box must apply. Task 1 pins this.
- **A draft's real errors still stop an upgrade.** Only a schema error at a path whose value is itself `__FILL__` is let through. Task 3's test keeps `bad-spec` for a deleted required field (the existing refusal test).
- **`--compiler` given without a value** is a usage error, never "keep the old compiler". Task 2 pins this.

---

### Task 1: dentro-i-versi-long@1.1.0

**Files:**
- Create:
  - `studio/series/src/compilers/dentro-i-versi-long/1.1.0.ts`;
  - `studio/series/fixtures/dentro-i-versi-long/1.1.0/` (taken from the prototype, see the Global Constraints);
  - `studio/series/test/dentro-i-versi-long-1.1.0.test.ts`.
- Modify:
  - `studio/series/src/registry.ts`;
  - `studio/series/README.md`.

**Interfaces:**
- Produces:
  - the compiler `dentro-i-versi-long@1.1.0`;
  - the problem code `text-off-panel`;
  - the timeline items `glass-<block>` (a `panel@1.1.0` under a note's tracks).

- [ ] **Step 1: Take the fixture and write the failing tests.** Take the fixture folder from the prototype (see the Global Constraints). Then:

Create `studio/series/test/dentro-i-versi-long-1.1.0.test.ts`:

````ts
// What dentro-i-versi-long@1.1.0 changes from 1.0.0 (avg-dcf.6.9), from the
// lesson's first real layout sheet: the panel is the theme's, writing stays on
// the glass, the note's tracks get their glass, titles sit in the panel's
// lower band. The fixture is 1.0.0's with Il lampo's text stacks moved onto
// the glass.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { compileSpec, type CompileInput, type CompileResult } from "../src/index.js";

const FIXTURE = (version: string) => join(import.meta.dirname, "..", "fixtures", "dentro-i-versi-long", version, "input.json");
const load = (version = "1.1.0"): CompileInput & { spec: { data: any }; theme: any } => JSON.parse(readFileSync(FIXTURE(version), "utf-8"));
const PANEL = { x: 440, y: 150, w: 1060, h: 596 };

function compiled(input: CompileInput) {
  const result = compileSpec(input);
  assert.ok(result.ok, JSON.stringify(!result.ok && result.problems, null, 2));
  return result;
}
const problems = (result: CompileResult) => {
  assert.ok(!result.ok, "expected problems");
  return result.problems.map((p) => [p.code, p.path]);
};
const items = (r: ReturnType<typeof compiled>) => r.timeline.tracks.flatMap((t) => t.items as any[]);
const block = (input: ReturnType<typeof load>, id: string) => input.spec.data.blocks.find((b: any) => b.id === id);

test("1.0.0's fixture, as CreativeStudio placed its texts, has writing off the glass", () => {
  const input = load("1.0.0");
  (input as any).template.compiler.version = "1.1.0";
  const found = problems(compileSpec(input));
  assert.ok(found.length > 0 && found.every(([code]) => code === "text-off-panel"));
  assert.ok(found.some(([, path]) => path === "$.data.blocks[3].phases[0].texts[0]"), JSON.stringify(found));
});

test("a story text, a note's counts and the quote's title off the panel are text-off-panel, at their paths", () => {
  const input = load();
  const story = input.spec.data.blocks.findIndex((b: any) => b.kind === "story");
  const note = input.spec.data.blocks.findIndex((b: any) => b.kind === "note");
  input.spec.data.blocks[story].phases[0].texts[0].x = 1420;
  input.spec.data.blocks[story].phases[0].texts[0].width = 900;
  input.spec.data.blocks[note].counts.x = 300;
  input.spec.data.blocks[note].quote.title.y = 900;
  assert.deepEqual(problems(compileSpec(input)), [
    ["text-off-panel", `$.data.blocks[${story}].phases[0].texts[0]`],
    ["text-off-panel", `$.data.blocks[${note}].counts`],
    ["text-off-panel", `$.data.blocks[${note}].quote.title`],
  ]);
});

test("the panel is the theme's: a theme's own layout.panel moves it, and the texts are held to it", () => {
  const input = load();
  input.theme.layout.panel = { x: 420, y: 140, w: 1100, h: 620 };
  const r = compiled(input);
  const headline = items(r).find((i) => i.id.startsWith("headline-"));
  assert.deepEqual([headline.props.x, headline.props.y], [420 + 1100 / 2, 140 + 620 - 110]);
  input.theme.layout.panel = { x: 440, y: 150, w: 700, h: 596 };
  assert.ok(problems(compileSpec(input)).every(([code]) => code === "text-off-panel"));
});

test("without a theme panel, 1.0.0's box", () => {
  const input = load();
  delete input.theme.layout.panel;
  const headline = items(compiled(input)).find((i) => i.id.startsWith("headline-"));
  assert.deepEqual([headline.props.x, headline.props.y], [PANEL.x + PANEL.w / 2, PANEL.y + PANEL.h - 110]);
});

test("the note's tracks and counts sit on the glass, for as long as they show", () => {
  const input = load();
  const r = compiled(input);
  const note = block(input, "scheda");
  const tracks = items(r).find((i) => i.id === `tracks-${note.id}`);
  const glass = items(r).find((i) => i.id === `glass-${note.id}`);
  assert.equal(glass.kit.name, "panel");
  assert.deepEqual([glass.from, glass.duration], [tracks.from, tracks.duration]);
  assert.deepEqual(glass.props.phases, [{ at: 0, layers: [{ grid: {} }] }]);
  const trackZ = r.timeline.tracks.find((t) => (t.items as any[]).includes(tracks))!.z ?? 0;
  const glassZ = r.timeline.tracks.find((t) => (t.items as any[]).includes(glass))!.z ?? 0;
  assert.ok(glassZ <= trackZ);
});

test("headlines and the annotated recital's figure titles sit in the panel's lower band", () => {
  const r = compiled(load());
  const titles = items(r).filter((i) => i.kit?.name === "figure-title");
  assert.ok(titles.length > 5);
  for (const t of titles) assert.deepEqual([t.props.x, t.props.y], [PANEL.x + PANEL.w / 2, PANEL.y + PANEL.h - 110], t.id);
});

test("Il lampo's data on the glass: every text stack inside the panel, and chapter 5's title said once", () => {
  const input = load();
  const stacks: any[] = [];
  const walk = (n: any) => {
    if (n && typeof n === "object") {
      if ("items" in n && "x" in n && "y" in n) stacks.push(n);
      Object.values(n).forEach(walk);
    }
  };
  walk(input.spec.data);
  for (const s of stacks) {
    const w = s.width ?? 900;
    const left = s.align === "center" ? s.x - w / 2 : s.align === "right" ? s.x - w : s.x;
    assert.ok(left >= PANEL.x && left + w <= PANEL.x + PANEL.w && s.y >= PANEL.y && s.y <= PANEL.y + PANEL.h, JSON.stringify(s).slice(0, 120));
  }
  assert.equal(block(input, "ripasso").lower.title, "RIFLESSIONI FINALI");
});

test("the guide stands at x 1650, so a wide pose keeps its hand in the frame", () => {
  const guides = items(compiled(load())).filter((i) => i.kit?.name === "interprete");
  assert.ok(guides.length > 0);
  for (const g of guides) assert.equal(g.props.x, 1650, g.id);
});
````

- [ ] **Step 2: Run them, and see them fail.** `cd studio/series && node --import tsx --test test/dentro-i-versi-long-1.1.0.test.ts`. Expect `unknown-compiler` for 1.1.0.

- [ ] **Step 3: Implement.**

Create `studio/series/src/compilers/dentro-i-versi-long/1.1.0.ts`:

````ts
// dentro-i-versi-long@1.1.0 — released: never edit this file; add dentro-i-versi-long/<next>.ts instead.
//
// 1.1.0 (avg-dcf.6.9), from the lesson's first real layout sheet: the panel's
// box is the theme's (layout.panel); writing stays on the glass (a text stack
// off the panel is text-off-panel, fixed in the data); the note's tracks get
// the glass behind them; headlines and figure titles sit in the panel's lower
// band, clear of the painting's subject; the guide stands at x 1650, so a
// wide pose keeps its hand in the frame.
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
// 1.1.0: at x 1650, a wide pose keeps its hand inside the frame (1.0.0 stood at 1700).
const GUIDE = { x: 1650, scale: 0.95 };
/** The panel's box when the theme says none (1.0.0's). */
const DEFAULT_PANEL = { x: 440, y: 150, w: 1060, h: 596 };
/** Where titles sit on the panel: its lower band, clear of a painting's subject. */
const TITLE_BAND = 110;
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
  const PANEL: { x: number; y: number; w: number; h: number } = theme.layout.panel ?? DEFAULT_PANEL;
  /** Writing stays on the glass: a text stack the spec places must fit the panel (CreativeStudio: every writing inside its monitor). */
  const onGlass = (stack: Record<string, unknown>, path: string) => {
    const x = stack.x as number;
    const y = stack.y as number;
    const width = (stack.width as number | undefined) ?? 900;
    const align = (stack.align as string | undefined) ?? "left";
    const left = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
    if (left < PANEL.x || left + width > PANEL.x + PANEL.w || y < PANEL.y || y > PANEL.y + PANEL.h) {
      problems.push({
        code: "text-off-panel", path,
        message: `the text spans x ${round3(left)}–${round3(left + width)} at y ${y}, off the panel (x ${PANEL.x}–${PANEL.x + PANEL.w}, y ${PANEL.y}–${PANEL.y + PANEL.h}): move or narrow it onto the glass`,
      });
    }
  };
  const source = input.sources?.[data.source.pin];
  if (!source) {
    return { ok: false, problems: [{ code: "missing-source", path: "$.data.source.pin", message: `no pinned episode "${data.source.pin}" with takes: pin the poem's source (vpr pin) as source/pins/${data.source.pin}.json, an episode whose artifacts/narration/takes.json the pin inventories` }] };
  }
  const assets: Record<string, { path: string; hash: string; kind: "image" | "audio" | "video" }> = {};
  const use = (id: string) => {
    assets[id] = { ...input.assets[id]! };
    return { $asset: id };
  };

  // ── The lesson's shape ────────────────────────────────────────────────────
  const blockList = data.blocks;
  if (blockList[0]?.kind !== "opening") problems.push({ code: "opening-first", path: "$.data.blocks[0].kind", message: "the lesson opens with its opening (in the atrio, on the cover)" });
  if (blockList[blockList.length - 1]?.kind !== "end") problems.push({ code: "end-last", path: `$.data.blocks[${blockList.length - 1}].kind`, message: "the lesson ends with its exit (back to the atrio and the cover: the loop)" });
  const seen = new Set<string>();
  blockList.forEach((b, i) => {
    if (seen.has(b.id)) problems.push({ code: "duplicate-block", path: `$.data.blocks[${i}].id`, message: `"${b.id}" names two blocks` });
    seen.add(b.id);
  });
  if (blockList[blockList.length - 1]?.chapterAfter) problems.push({ code: "chapter-after-end", path: `$.data.blocks[${blockList.length - 1}].chapterAfter`, message: "no chapter comes after the exit" });
  data.pictures.forEach((pic, i) => pic.verses.forEach((v, j) => {
    if (v >= data.verses.length) problems.push({ code: "no-such-verse", path: `$.data.pictures[${i}].verses[${j}]`, message: `there is no verse ${v} (the poem has ${data.verses.length})` });
  }));
  if (problems.length > 0) return { ok: false, problems };

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
      const written = tokens(v.text);
      const n = written.length;
      const slice = words.slice(k, k + n);
      if (slice.length < n) problems.push({ code: "verse-mismatch", path: `$.data.verses[${i}].text`, message: `the recital's timing has ${words.length} words; verse ${i + 1} needs words ${k + 1}–${k + n}` });
      else {
        // the recital says the verse as written, word for word
        const j = written.findIndex((w, x) => norm(w) !== norm(slice[x]!.text));
        if (j >= 0) problems.push({ code: "verse-mismatch", path: `$.data.verses[${i}].text`, message: `verse ${i + 1}'s word "${written[j]}" is "${slice[j]!.text}" in the recital` });
      }
      verseWords.push(slice);
      k += n;
    });
    if (k !== words.length && !problems.some((p) => p.code === "verse-mismatch")) {
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

  /** A cue of a block, in seconds from the block's start; within the block, or a problem. */
  const cueOf = (p: Placed, cue: unknown, path: string): number => {
    const seconds = cueIn(p, cue, path);
    if (seconds < 0 || seconds > p.end - p.start + 1e-6) {
      problems.push({ code: "cue-out-of-block", path, message: `${round3(seconds)} s is outside block "${p.block.id}" (0–${round3(p.end - p.start)} s)` });
      return Math.min(Math.max(seconds, 0), p.end - p.start);
    }
    return seconds;
  };
  const cueIn = (p: Placed, cue: unknown, path: string): number => {
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

  /** Resolved props whose times are from the block's start, made relative to an item starting `by` seconds into it. */
  const rebaseBy = (by: number) => {
    const rebase = (v: unknown, key = ""): unknown => {
      if (typeof v === "number" && CUE_KEYS.has(key)) return round3(v - by);
      if ((key === "read" || key === "strikes") && Array.isArray(v)) return v.map((x) => (typeof x === "number" ? round3(x - by) : x));
      if (key === "times" && isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "number" ? round3(x - by) : x]));
      if (Array.isArray(v)) return v.map((x) => rebase(x));
      if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rebase(x, k)]));
      return v;
    };
    return (v: unknown) => rebase(v);
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
  /** Verse i's words, or nothing (and a problem) when the poem has no such verse. */
  const verseAt = (i: number, path: string) => {
    if (!Number.isInteger(i) || i < 0 || i >= data.verses.length) {
      problems.push({ code: "no-such-verse", path, message: `there is no verse ${i} (the poem has ${data.verses.length})` });
      return null;
    }
    return data.verses[i]!;
  };
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
          // a verse said while the block's title shows gets no bar of its own
          if (until - from < 0.5) return;
          items.overlay.push({ id: `verse-${b.id}-${i + 1}`, ...span(from, until), kit: KIT("verse-bar"), source: `verses[${i}]`, props: { look, width: VERSE_WIDTH, kicker: `${data.title.toUpperCase()} · ${i + 1}/${data.verses.length}`, lines: [verseLine(i, from - p.speech)] } });
          if (b.annotated && data.verses[i]!.figure) {
            items.overlay.push({ id: `figure-${b.id}-${i + 1}`, ...span(from, until), kit: KIT("figure-title"), source: `verses[${i}].figure`, props: { look, kicker: data.title.toUpperCase(), text: data.verses[i]!.figure!.toUpperCase(), x: PANEL.x + PANEL.w / 2, y: PANEL.y + PANEL.h - TITLE_BAND }, transitionIn: fade(0.3), transitionOut: fade(0.3) });
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
            onGlass(texts, `${path}.phases[${i}].texts[${j}]`);
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
        // the tracks and counts are writing too: on the glass
        if (b.tracks || b.counts) {
          items.stage.push({ id: `glass-${b.id}`, ...span(p.start, p.start + quoteAt), kit: KIT("panel", "1.1.0"), source: src, props: { look, appear: { at: 0, dur: 0.8 }, phases: [{ at: 0, layers: [{ grid: {} }] }] }, transitionOut: fade(0.4) });
        }
        if (b.tracks) {
          items.stage.push({ id: `tracks-${b.id}`, ...span(p.start, p.start + quoteAt), kit: KIT("word-tracks"), source: `${src}.tracks`, props: { look, lines: data.verses.map((v) => v.text), ...(resolve(p, b.tracks, `${path}.tracks`) as object) }, transitionOut: fade(0.4) });
        }
        if (b.counts) {
          const counts = resolve(p, b.counts, `${path}.counts`) as Record<string, unknown>;
          onGlass(counts, `${path}.counts`);
          items.overlay.push({ id: `counts-${b.id}`, ...span(p.start, p.start + quoteAt), kit: KIT("text-stack"), source: `${src}.counts`, props: { look, ...counts }, transitionOut: fade(0.4) });
        }
        if (quote) {
          const pic = framed(quote.picture, `${path}.quote.picture.asset`);
          if (pic) items.stage.push({ id: `quote-${b.id}`, ...span(p.start + quoteAt, to), kit: KIT("panel", "1.1.0"), source: `${src}.quote`, props: { look, appear: { at: 0, dur: 0.8 }, phases: [{ at: 0, layers: [{ picture: pic, shade: "quote" }] }] } });
          // the interlinear's times are from the quote's start
          const lin = resolve(p, quote.interlinear, `${path}.quote.interlinear`) as Record<string, unknown>;
          const rebase = rebaseBy(quoteAt);
          items.overlay.push({ id: `interlinear-${b.id}`, ...span(p.start + quoteAt, to), kit: KIT("interlinear"), source: `${src}.quote.interlinear`, props: { look, ...(rebase(lin) as object) }, transitionIn: fade(0.4) });
          if (quote.title) {
            const title = rebase(resolve(p, quote.title, `${path}.quote.title`)) as Record<string, unknown>;
            onGlass(title, `${path}.quote.title`);
            items.overlay.push({ id: `quote-title-${b.id}`, ...span(p.start + quoteAt, to), kit: KIT("text-stack"), source: `${src}.quote.title`, props: { look, ...title } });
          }
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
        const verses = (b.verses as number[]).filter((v, j) => verseAt(v, `${path}.verses[${j}]`));
        if (verses.length) items.overlay.push({ id: `verses-${b.id}`, ...span(afterLower(p.start), to), kit: KIT("verse-bar"), source: `${src}.verses`, props: { look, width: VERSE_WIDTH, kicker: `${data.title.toUpperCase()} · ${(b.keyword as string).toUpperCase()}`, lines: verses.slice(0, 3).map((v) => verseLine(v)), ...(verses.length > 1 ? { size: 46 } : {}) } });
        const headline = b.headline as { kicker?: string; text: string; at: Cue; until?: Cue } | undefined;
        if (headline) {
          const from = cueOf(p, headline.at, `${path}.headline.at`);
          const until = headline.until !== undefined ? cueOf(p, headline.until, `${path}.headline.until`) : length;
          items.overlay.push({ id: `headline-${b.id}`, ...span(p.start + from, p.start + until), kit: KIT("figure-title"), source: `${src}.headline`, props: { look, kicker: headline.kicker ?? data.title.toUpperCase(), text: headline.text, x: PANEL.x + PANEL.w / 2, y: PANEL.y + PANEL.h - TITLE_BAND }, transitionIn: fade(0.3), transitionOut: fade(0.3) });
        }
        break;
      }
      case "meter": {
        const split = cueOf(p, b.rhymesAt, `${path}.rhymesAt`);
        items.stage.push({ id: `syllables-${b.id}`, ...span(p.start, p.start + split), kit: KIT("syllables"), source: `${src}.syllables`, props: { look, ...(resolve(p, b.syllables, `${path}.syllables`) as object) }, transitionOut: fade(0.4) });
        const rebased = rebaseBy(split)(resolve(p, b.rhymes, `${path}.rhymes`)) as Record<string, unknown>;
        items.stage.push({ id: `rhymes-${b.id}`, ...span(p.start + split, to), kit: KIT("rhymes"), source: `${src}.rhymes`, props: { look, ...rebased }, transitionIn: fade(0.4) });
        if (typeof b.verse === "number" && verseAt(b.verse, `${path}.verse`)) items.overlay.push({ id: `verses-${b.id}`, ...span(afterLower(p.start), p.start + split), kit: KIT("verse-bar"), source: `${src}.verse`, props: { look, width: VERSE_WIDTH, lines: [verseLine(b.verse)] } });
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
  version: "1.1.0",
  description: "Dentro i versi · long: the lesson on a poem, block after block — atrio, recital, story, note, one figure tool per painting, metre, invitation, annotated recital, summary, exit — in the channel theme's look, its cues on the guide's words.",
  compile,
};
````

Then apply:

````diff
diff --git a/studio/series/README.md b/studio/series/README.md
index 7124447..d5c5a64 100644
--- a/studio/series/README.md
+++ b/studio/series/README.md
@@ -40,6 +40,7 @@ input.
 | `poetry-short@1.0.0` | A vertical poem: pictures changing on cued words (`still@1.0.0`, `fit: cover`, 12-frame crossfades centred on each cue), the `narration` unit of `takes.json` on the voice track, captions grouped from the measured words (at `. ! ? ; :` and before 42 characters), `holdSeconds` of picture after the voice, the title as the chapter of one section. |
 | `dentro-i-versi-short@1.0.0` | Dentro i versi · short (CreativeStudio's `sala8`): the `recital` unit — the title take, then the poem — from 0.3 s; the video lasts until 6 s after `voiceEndWord`. From the spec's data and the measured words it computes the camera's breathing, pushes and shakes, lightning at each picture change, lights, wind, shatter, blackout, the actor's poses, expressions, gazes, blinks, mouth (from the voice's energy), live and bow windows, and the title card's fit; it lays out the museum kits (`museum-hall`, `room-effect`, `verse-plate`, `interprete`, `lower-third`, `title-chip`, `brand-mark`), the sounds, applause and music. Times are seconds or `verse:N`, `verseEnd:N`, `word:parola`, `end`, `picture:N`, ± seconds. Items that overlap go on separate lanes (`verses-1`, `verses-2`, `room-1`…, `sfx-1`…). Sections: `title`, `verse-N`, `bow`. |
 | `dentro-i-versi-long@1.0.0` | Dentro i versi · long (CreativeStudio's `poesie-museo-long`, runtime v10): the lesson's blocks in order — `opening` (the atrio, the cover, the warp into the hall), `announcement`, `recital` (the pinned source's takes; `annotated` adds each verse's figure), `story`, `note`, `specimen` (one figure tool per painting), `meter`, `invite`, `summary`, `end` — each lasting its guide take (0.4 s before, 0.6 s after) plus its gap, with a 4 s chapter card after `chapterAfter`. Every time in a block is a cue: seconds, `end`, or `{word, n?, offset?}` on its take (elided words found: «L'Italia» answers `italia`); a cue that finds nothing stops with `cue-not-found`. The look, rooms and characters are the pinned theme's; the paintings and recitals are `source-<pin>-…` from the pinned source episode. Draws the channel-neutral lesson kits; the last frame is the first (`loop: true`). Sections: `block-<id>`, `chapter-N`. |
+| `dentro-i-versi-long@1.1.0` | 1.0.0, from the lesson's first real layout sheet (`avg-dcf.6.9`): the panel's box is the theme's `layout.panel` (1.0.0's without one); writing stays on the glass — a text stack (story texts, a note's counts, the quote's title) off the panel stops with `text-off-panel`, fixed in the data, never clamped; the note's tracks and counts get the glass behind them; headlines and the annotated recital's figure titles sit in the panel's lower band, clear of the painting's subject; the guide stands at x 1650 (1700 in 1.0.0), so a wide pose keeps its hand in the frame. |
 
 ## Validators
 
diff --git a/studio/series/src/registry.ts b/studio/series/src/registry.ts
index 4fb22c1..0178148 100644
--- a/studio/series/src/registry.ts
+++ b/studio/series/src/registry.ts
@@ -5,8 +5,9 @@ import type { SeriesCompiler } from "./types.js";
 import { compiler as poetryShort100 } from "./compilers/poetry-short/1.0.0.js";
 import { compiler as dentroIVersiShort100 } from "./compilers/dentro-i-versi-short/1.0.0.js";
 import { compiler as dentroIVersiLong100 } from "./compilers/dentro-i-versi-long/1.0.0.js";
+import { compiler as dentroIVersiLong110 } from "./compilers/dentro-i-versi-long/1.1.0.js";
 
-export const COMPILERS: readonly SeriesCompiler[] = Object.freeze([poetryShort100, dentroIVersiShort100, dentroIVersiLong100]);
+export const COMPILERS: readonly SeriesCompiler[] = Object.freeze([poetryShort100, dentroIVersiShort100, dentroIVersiLong100, dentroIVersiLong110]);
 
 /** The compiler with exactly this id and version, or undefined. */
 export function resolveCompiler(id: string, version: string): SeriesCompiler | undefined {
````

- [ ] **Step 4: Run them, and see them pass.** `cd studio/series && npm test`. Expect 170 to pass, including `dentro-i-versi-long@1.1.0 compiles its fixture to its golden timeline`, with the 1.0.0 golden unchanged.

- [ ] **Step 5: Commit.**

```bash
git add studio/series/src/compilers/dentro-i-versi-long/1.1.0.ts studio/series/src/registry.ts studio/series/README.md studio/series/fixtures/dentro-i-versi-long/1.1.0 studio/series/test/dentro-i-versi-long-1.1.0.test.ts
git commit -m "dentro-i-versi-long@1.1.0: the theme's panel, writing on the glass, the note's glass, titles in the lower band, the guide at 1650 (avg-dcf.6.9)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: vpr template release --compiler / --validator

**Files:**
- Modify:
  - `studio/runtime/src/theme-release.ts`;
  - `studio/runtime/src/cli.ts`;
  - `docs/running.md`.
- Test:
  - `studio/runtime/test/unit/theme-release.test.ts`;
  - `studio/runtime/test/integration/cli-theme.test.ts`.

**Interfaces:**
- Produces: `ReleaseTemplateOptions.compiler?` and `.validator?` (exact versions), and the CLI flags `--compiler` and `--validator`.

- [ ] **Step 1: Write the failing tests.**

````diff
diff --git a/studio/runtime/test/integration/cli-theme.test.ts b/studio/runtime/test/integration/cli-theme.test.ts
index 9801dd8..99343ea 100644
--- a/studio/runtime/test/integration/cli-theme.test.ts
+++ b/studio/runtime/test/integration/cli-theme.test.ts
@@ -62,6 +62,13 @@ describe("vpr theme seal, then vpr template release", () => {
     expect(existsSync(releaseDir("1.1.0"))).toBe(false);
   });
 
+  it("--compiler names the new release's compiler; given without a value it is a usage error", () => {
+    const released = vpr(["template", "release", "dentro-i-versi/long", "dentro-i-versi-long", "1.2.0", "--from", "1.0.0", "--compiler", "1.1.0"]);
+    expect(released.status, released.stderr).toBe(0);
+    expect(JSON.parse(readFileSync(path.join(releaseDir("1.2.0"), "series-template.json"), "utf-8")).compiler.version).toBe("1.1.0");
+    expect(vpr(["template", "release", "dentro-i-versi/long", "dentro-i-versi-long", "1.3.0", "--from", "1.0.0", "--compiler"]).status).toBe(1);
+  });
+
   it("a dry run reports what the real command would refuse", () => {
     const pinned = vpr(["theme", "seal", "dentro-i-versi/dentro-i-versi/1.0.0", "--dry-run"]);
     expect(pinned.status).toBe(2);
diff --git a/studio/runtime/test/unit/theme-release.test.ts b/studio/runtime/test/unit/theme-release.test.ts
index 65d263a..98d72da 100644
--- a/studio/runtime/test/unit/theme-release.test.ts
+++ b/studio/runtime/test/unit/theme-release.test.ts
@@ -108,6 +108,15 @@ describe("releaseTemplate", () => {
     expect(JSON.parse(readFileSync(join(releaseDir("1.0.0"), "series-template.json"), "utf-8")).version).toBe("1.0.0");
   });
 
+  it("names a new compiler or validator version, and refuses one that is not exact", () => {
+    const released = releaseTemplate(seriesDir(), { id: "dentro-i-versi-long", from: "1.0.0", version: "1.2.0", compiler: "1.1.0", validator: "1.0.1" });
+    const manifest = JSON.parse(readFileSync(join(releaseDir("1.2.0"), "series-template.json"), "utf-8"));
+    expect(manifest.compiler).toEqual({ id: "dentro-i-versi-long", version: "1.1.0" });
+    expect(manifest.validator).toEqual({ id: "dentro-i-versi-long", version: "1.0.1" });
+    expect(released.hash).toBe(sha(readFileSync(join(releaseDir("1.2.0"), "series-template.json"))));
+    expect(codeOf(() => releaseTemplate(seriesDir(), { id: "dentro-i-versi-long", from: "1.0.0", version: "1.3.0", compiler: "latest" }))).toBe("bad-version");
+  });
+
   it("keeps the source's theme pin when given no theme", () => {
     const released = releaseTemplate(seriesDir(), { id: "dentro-i-versi-long", from: "1.0.0", version: "1.0.1" });
     expect(released.theme).toBeUndefined();
````

- [ ] **Step 2: Run them, and see them fail.** `cd studio/runtime && npx vitest run test/unit/theme-release.test.ts`. Expect the manifest's compiler to still be 1.0.0.

- [ ] **Step 3: Implement.**

````diff
diff --git a/docs/running.md b/docs/running.md
index f996a41..a17c176 100644
--- a/docs/running.md
+++ b/docs/running.md
@@ -377,7 +377,9 @@ node studio/runtime/dist/src/cli.js sheet status my-channel/my-series/ep001 --li
 with its hash, into its `theme.json`, and prints the hash a template release
 pins; it refuses a release already sealed or already pinned. `template release`
 copies a template release to a new version, pinned to a sealed theme with
-`--theme`. Episodes then move onto it with Pi's `pva_upgrade_spec`.
+`--theme`, or naming another compiler or validator version with `--compiler` /
+`--validator` (a new layout is a new compiler version and a new release).
+Episodes then move onto it with Pi's `pva_upgrade_spec`.
 
 ```bash
 node studio/runtime/dist/src/cli.js theme seal my-channel/my-theme/1.1.0 --library "$PWD/library"
diff --git a/studio/runtime/src/cli.ts b/studio/runtime/src/cli.ts
index 15a5fd1..3b2a3d0 100644
--- a/studio/runtime/src/cli.ts
+++ b/studio/runtime/src/cli.ts
@@ -970,15 +970,18 @@ async function cmdTheme(ctx: CliContext, args: string[]): Promise<number> {
 
 /** `vpr template release`: a new release of a series template, a copy of `--from`, pinned to a sealed theme. */
 async function cmdTemplate(ctx: CliContext, args: string[]): Promise<number> {
-  const usage = "Usage: vpr template release <channel>/<series> <template-id> <version> --from <version> [--theme <id>@<version>] [--library <path>]";
+  const usage = "Usage: vpr template release <channel>/<series> <template-id> <version> --from <version> [--theme <id>@<version>] [--compiler <version>] [--validator <version>] [--library <path>]";
   const libraryRoot = libraryFrom(args);
   const [sub, target, id, version] = positionalArgs(args);
   const parts = target?.split("/") ?? [];
   const from = flagValue(args, "--from");
   const themeArg = flagValue(args, "--theme");
   const theme = themeArg?.match(/^([^@]+)@([^@]+)$/);
+  const compiler = flagValue(args, "--compiler");
+  const validator = flagValue(args, "--validator");
   // A flag given without its value is a mistake, never "no theme".
-  const flagsComplete = from !== undefined && (!args.includes("--theme") || (theme && isNamePart(theme[1]!) && isNamePart(theme[2]!)));
+  const flagsComplete = from !== undefined && (!args.includes("--theme") || (theme && isNamePart(theme[1]!) && isNamePart(theme[2]!)))
+    && (!args.includes("--compiler") || compiler !== undefined) && (!args.includes("--validator") || validator !== undefined);
   if (!libraryRoot || sub !== "release" || parts.length !== 2 || !parts.every(isNamePart) || !id || !version || !flagsComplete) {
     emit(ctx, { error: libraryRoot ? usage : "--library <path> is required (or set AVG_LIBRARY_ROOT)" });
     return EX_USAGE;
@@ -986,7 +989,8 @@ async function cmdTemplate(ctx: CliContext, args: string[]): Promise<number> {
   const [channel, series] = parts as [string, string];
   try {
     const released = releaseTemplate(seriesPath(libraryRoot, channel, series), {
-      id, from, version, ...(theme ? { theme: { id: theme[1]!, version: theme[2]! } } : {}), dryRun: ctx.dryRun,
+      id, from, version, ...(theme ? { theme: { id: theme[1]!, version: theme[2]! } } : {}),
+      ...(compiler !== undefined ? { compiler } : {}), ...(validator !== undefined ? { validator } : {}), dryRun: ctx.dryRun,
     });
     emit(ctx, {
       message: `${ctx.dryRun ? "[DRY RUN] " : ""}${id}@${version} ${ctx.dryRun ? "would be released" : "released"} at ${released.path}${released.theme ? ` on ${released.theme.id}@${released.theme.version}` : " (the theme pin copied from " + from + ")"}; move an episode onto it with pva_upgrade_spec`,
@@ -1281,8 +1285,8 @@ const VALUE_FLAGS = new Set([
   "--source", "--used-by", "--path",
   // `reference`'s (avg-jao.6), and the notes `approve`, `reject` and `budget` take.
   "--note", "--reason",
-  // `template release`'s (avg-dcf.6.10).
-  "--from", "--theme",
+  // `template release`'s (avg-dcf.6.10, avg-dcf.6.9).
+  "--from", "--theme", "--compiler", "--validator",
 ]);
 
 /**
@@ -1623,7 +1627,7 @@ const COMMANDS: Record<string, CliCommand> = {
   sheet: { name: "sheet", description: "Review an episode's layout sheet: approve it, reject it with a note, or see its review; a spec-driven episode renders only with an approval of its current sheet", usage: "vpr sheet approve <channel>/<series>/<episode> [--note <text>] [--dry-run] | vpr sheet reject <channel>/<series>/<episode> --note <text> | vpr sheet status <channel>/<series>/<episode>", examples: ["vpr sheet approve dentro-i-versi/short/san-martino", "vpr sheet reject dentro-i-versi/short/san-martino --note 'the verse bar covers the hand at 0:12'", "vpr sheet status dentro-i-versi/short/san-martino"], run: cmdSheet },
   reference: { name: "reference", description: "Golden references of a series: approve a proposed one, withdraw, verify, list", usage: "vpr reference approve <channel>/<series>/<episode> <ref-id> [--note <text>] [--dry-run] | vpr reference withdraw <channel>/<series> <template-id> <ref-id> --reason <text> | vpr reference verify <channel>/<series> <template-id> <ref-id> | vpr reference list <channel>/<series> [--json]", examples: ["vpr reference approve dentro-i-versi/short/san-martino san-martino-v1 --dry-run", "vpr reference verify dentro-i-versi/short short-room san-martino-v1", "vpr reference withdraw dentro-i-versi/short short-room san-martino-v1 --reason 'the recital was re-recorded'"], run: cmdReference },
   theme: { name: "theme", description: "Seal a theme release: its files and their hashes in theme.json, so a changed room never passes for the released one", usage: "vpr theme seal <channel>/<theme>/<version> [--library <path>]", examples: ["vpr theme seal dentro-i-versi/dentro-i-versi/1.1.0"], run: cmdTheme },
-  template: { name: "template", description: "Release a series template: a copy of an earlier release, optionally pinned to a sealed theme (a new look)", usage: "vpr template release <channel>/<series> <template-id> <version> --from <version> [--theme <id>@<version>] [--library <path>]", examples: ["vpr template release dentro-i-versi/long dentro-i-versi-long 1.1.0 --from 1.0.0 --theme dentro-i-versi@1.1.0"], run: cmdTemplate },
+  template: { name: "template", description: "Release a series template: a copy of an earlier release, optionally pinned to a sealed theme (a new look)", usage: "vpr template release <channel>/<series> <template-id> <version> --from <version> [--theme <id>@<version>] [--compiler <version>] [--validator <version>] [--library <path>]", examples: ["vpr template release dentro-i-versi/long dentro-i-versi-long 1.1.0 --from 1.0.0 --theme dentro-i-versi@1.1.0", "vpr template release dentro-i-versi/long dentro-i-versi-long 1.2.0 --from 1.1.0 --compiler 1.1.0"], run: cmdTemplate },
   takes: { name: "takes", description: "List each stage's kept candidates and its selected take", usage: "vpr takes <channel>/<series>/<episode> [<stage-id>] [--pipeline <name>] [--json]", examples: ["vpr takes my-channel/my-series/ep001 illustrations"], run: cmdTakes },
   select: { name: "select", description: "Make an earlier candidate a stage's take; an operator's selection locks it", usage: "vpr select <channel>/<series>/<episode> <stage-id> <attempt> [--expect <attempt|none>] [--json] [--dry-run]", examples: ["vpr select my-channel/my-series/ep001 illustrations 2 --expect 3"], run: cmdSelect },
   doctor: { name: "doctor", description: "Validate workspace against canonical tree", usage: "vpr doctor --library <path> [--channel X] [--series Y] [--episode Z] [--json]", examples: ["vpr doctor --library /tmp/library", "vpr doctor --library . --channel my-channel --series season-1 --json"], run: cmdDoctor },
diff --git a/studio/runtime/src/theme-release.ts b/studio/runtime/src/theme-release.ts
index faebae1..32f87f0 100644
--- a/studio/runtime/src/theme-release.ts
+++ b/studio/runtime/src/theme-release.ts
@@ -148,6 +148,9 @@ export interface ReleaseTemplateOptions {
   version: string;
   /** The sealed theme release the new release pins; without it, the copied pin stays. */
   theme?: { id: string; version: string };
+  /** The compiler and validator versions the new release names, when they change (registered or not is the loader's check). */
+  compiler?: string;
+  validator?: string;
   /** Check everything, write nothing. */
   dryRun?: boolean;
 }
@@ -160,7 +163,7 @@ export interface ReleaseTemplateOptions {
 export function releaseTemplate(seriesDir: string, options: ReleaseTemplateOptions): { path: string; hash: string; theme?: { id: string; version: string; hash: string } } {
   const { id, from, version } = options;
   if (!SLUG.test(id)) fail("missing-template", `"${id}" is not a template id`);
-  for (const v of [from, version]) if (!EXACT.test(v)) fail("bad-version", `"${v}" is not an exact x.y.z release`);
+  for (const v of [from, version, options.compiler, options.validator]) if (v !== undefined && !EXACT.test(v)) fail("bad-version", `"${v}" is not an exact x.y.z release`);
   if (compareReleases(version, from) <= 0) fail("bad-version", `${version} does not come after ${from}`);
   const templates = join(seriesDir, "templates", id);
   const source = join(templates, from);
@@ -176,6 +179,12 @@ export function releaseTemplate(seriesDir: string, options: ReleaseTemplateOptio
   }
   if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) fail("bad-template", `${id}@${from}'s ${SERIES_TEMPLATE_MANIFEST} is not a release manifest`);
   manifest.version = version;
+  for (const role of ["compiler", "validator"] as const) {
+    const v = options[role];
+    if (v === undefined) continue;
+    if (!manifest[role] || typeof manifest[role] !== "object") fail("bad-template", `${id}@${from} names no ${role} to move to ${v}`);
+    manifest[role] = { ...manifest[role], version: v };
+  }
   let themePin: { id: string; version: string; hash: string } | undefined;
   if (options.theme) {
     const channelDir = dirname(dirname(seriesDir));
````

- [ ] **Step 4: Run them, and see them pass.** `npm test -w @studio/runtime`. Expect 670 to pass.

- [ ] **Step 5: Commit.**

```bash
git add studio/runtime/src/theme-release.ts studio/runtime/src/cli.ts docs/running.md studio/runtime/test/unit/theme-release.test.ts studio/runtime/test/integration/cli-theme.test.ts
git commit -m "vpr template release --compiler / --validator: a new layout is a new compiler and a new release (avg-dcf.6.9)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: A draft upgrades; the long compiles on 1.1.0 end to end

**Files:**
- Modify:
  - `studio/episode/src/spec-init.ts`;
  - `studio/episode/src/testing.ts`.
- Test:
  - `studio/episode/tests/new-look.test.ts`;
  - `studio/episode/tests/dentro-i-versi-long.test.ts`.
- Docs: `docs/superpowers/specs/2026-10-08-long-layout-design.md` is already on the branch.

**Interfaces:**
- Consumes: compiler 1.1.0 and its fixture (Task 1, through `@studio/series`'s `dist/`).
- Produces: `divLongEpisode(root, {version?})`.

- [ ] **Step 1: Write the failing tests.**

````diff
diff --git a/studio/episode/tests/dentro-i-versi-long.test.ts b/studio/episode/tests/dentro-i-versi-long.test.ts
index 7074743..3ed38d5 100644
--- a/studio/episode/tests/dentro-i-versi-long.test.ts
+++ b/studio/episode/tests/dentro-i-versi-long.test.ts
@@ -37,6 +37,15 @@ describe("the dentro-i-versi-long episode", () => {
     expect(checked.findings.map((f) => [f.code, f.severity])).toEqual([["theme-unsealed", "warning"], ["no-theme-sound", "warning"]]);
   });
 
+  it("compiles on compiler 1.1.0, with its text on the glass", async () => {
+    const { episodeDir, episodeRef } = await divLongEpisode(root, { version: "1.1.0" });
+    const compiled = compileEpisode(episodeDir, { episodeRef });
+    if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
+    expect(compiled.compiler).toBe("dentro-i-versi-long@1.1.0");
+    const glass = compiled.timeline.tracks.flatMap((t) => t.items as { id: string; kit?: unknown }[]).find((i) => i.id === "glass-scheda");
+    expect(glass?.kit).toEqual({ name: "panel", version: "1.1.0" });
+  });
+
   it("stops when the source changed since it was pinned", async () => {
     const { episodeDir, episodeRef } = await divLongEpisode(root);
     writeFileSync(join(root, "dentro-i-versi", "series", "short", "episodes", "il-lampo", "assets", "images", "lampo-04-casa.png"), "repainted");
diff --git a/studio/episode/tests/new-look.test.ts b/studio/episode/tests/new-look.test.ts
index c0180dc..722409f 100644
--- a/studio/episode/tests/new-look.test.ts
+++ b/studio/episode/tests/new-look.test.ts
@@ -81,6 +81,15 @@ describe("upgradeEpisodeSpec onto a sealed theme", () => {
       .toEqual([["theme-mismatch", "../../../../themes/dentro-i-versi/1.1.0/rooms/atrio.png"]]);
   });
 
+  it("moves a draft too: its unfilled values, and what the schema says of them, do not stop it", () => {
+    newLook("1.1.0");
+    // an asset id's pattern refuses "__FILL__": still a draft, not bad data
+    editSpec(episodeDir, (spec) => { spec.data.title = "__FILL__"; spec.data.pictures[0].asset = "__FILL__"; });
+    const upgraded = upgradeEpisodeSpec(episodeDir, { episodeRef, version: "1.1.0" });
+    if (!upgraded.ok) throw new Error(JSON.stringify(upgraded.problems));
+    expect((upgraded.spec.data as { pictures: { asset: string }[] }).pictures[0]!.asset).toBe("__FILL__");
+  });
+
   it("refuses a version not after the pin, a missing release, another episode's spec, data the release refuses, no spec", () => {
     newLook("1.1.0");
     const codes = (version: string, ref = episodeRef) => {
````

- [ ] **Step 2: Run them, and see them fail.** Run `npm run build --workspace @studio/series`, then `cd studio/episode && npx vitest run tests/new-look.test.ts tests/dentro-i-versi-long.test.ts`. Expect two failures:
  - the draft is refused as `bad-spec` at `$.data["pictures"]["0"]["asset"]`;
  - `divLongEpisode` ignores `version`.

- [ ] **Step 3: Implement.**

````diff
diff --git a/studio/episode/src/spec-init.ts b/studio/episode/src/spec-init.ts
index e97d8ab..af4db5f 100644
--- a/studio/episode/src/spec-init.ts
+++ b/studio/episode/src/spec-init.ts
@@ -197,8 +197,13 @@ export function upgradeEpisodeSpec(
   }
   const draft = instantiateEpisodeSpec(bundle, spec.episodeRef);
   const upgraded = { ...spec, revision: spec.revision + 1, template: draft.template };
-  // A draft stays a draft: only what the new release refuses stops the move.
-  const problems = validateEpisodeSpec(upgraded, bundle).filter((p: SpecInitProblem) => p.code !== "unfilled");
+  // A draft stays a draft: only what the new release refuses stops the move —
+  // not an unfilled value, nor what the schema says of one (an id's pattern
+  // refusing "__FILL__"). The schema's paths spell indices as strings.
+  const same = (path: string) => path.replace(/\["(\d+)"\]/g, "[$1]");
+  const unfilled = new Set(placeholderPaths(upgraded.data, "$.data").map(same));
+  const problems = validateEpisodeSpec(upgraded, bundle)
+    .filter((p: SpecInitProblem) => p.code !== "unfilled" && !(p.code === "spec-data" && unfilled.has(same(p.path))));
   if (problems.length > 0) {
     return { ok: false, problems: problems.map((p: SpecInitProblem) => ({ code: "bad-spec", message: `${p.code}: ${p.message}`, path: `${EPISODE_SPEC_PATH}#${p.path}` })) };
   }
diff --git a/studio/episode/src/testing.ts b/studio/episode/src/testing.ts
index 0fe68d9..e179956 100644
--- a/studio/episode/src/testing.ts
+++ b/studio/episode/src/testing.ts
@@ -16,7 +16,8 @@ const require = createRequire(import.meta.url);
 const RELEASE = dirname(require.resolve("@studio/contracts/fixtures/series-template/example/templates/poetry-short/1.0.0/series-template.json"));
 const INPUT = require.resolve("@studio/series/fixtures/poetry-short/1.0.0/input.json");
 const DIV_INPUT = require.resolve("@studio/series/fixtures/dentro-i-versi-short/1.0.0/input.json");
-const DIV_LONG_INPUT = require.resolve("@studio/series/fixtures/dentro-i-versi-long/1.0.0/input.json");
+/** The long's golden fixture, for each released compiler version. */
+const divLongInput = (version: string) => require.resolve(`@studio/series/fixtures/dentro-i-versi-long/${version}/input.json`);
 const DIV_THEME = dirname(require.resolve("@studio/series/fixtures/themes/dentro-i-versi/1.0.0/theme.json"));
 
 export const sha256 = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
@@ -139,9 +140,10 @@ export function approveSheet(episodeDir: string, episodeRef: { channel: string;
  */
 export async function divLongEpisode(
   libraryRoot: string,
-  options: DivShortEpisodeOptions = {},
+  options: DivShortEpisodeOptions & { /** The fixture of this compiler version (default 1.0.0). */ version?: string } = {},
 ): Promise<{ episodeDir: string; episodeRef: { channel: string; series: string; episode: string } }> {
-  const input = JSON.parse(readFileSync(DIV_LONG_INPUT, "utf-8"));
+  const fixture = divLongInput(options.version ?? "1.0.0");
+  const input = JSON.parse(readFileSync(fixture, "utf-8"));
   const channelDir = join(libraryRoot, "dentro-i-versi");
   cpSync(DIV_THEME, join(channelDir, "themes", "dentro-i-versi", "1.0.0"), { recursive: true });
   const sourceDir = join(channelDir, "series", "short", "episodes", "il-lampo");
@@ -179,7 +181,7 @@ export async function divLongEpisode(
   takes(sourceDir, input.sources.fonte.narration, input.sources.fonte.timings);
 
   // The lesson.
-  cpSync(join(dirname(DIV_LONG_INPUT), "release"), join(channelDir, "series", "long", "templates", "dentro-i-versi-long", input.template.version), { recursive: true });
+  cpSync(join(dirname(fixture), "release"), join(channelDir, "series", "long", "templates", "dentro-i-versi-long", input.template.version), { recursive: true });
   for (const [id, asset] of Object.entries<{ path: string }>(input.assets)) {
     if (id.startsWith("image-")) picture(episodeDir, asset.path, id.slice(6));
   }
````

- [ ] **Step 4: Run them, and see them pass.**
  - `cd studio/episode && npx vitest run`: 242 pass, 4 skipped.
  - Then `npm run build --workspace @studio/episode`.
  - `cd studio/agent && npx vitest run`: 212 pass.
  - `cd studio/adapters && npx vitest run`: 46 pass.
  - At the root, `npm run docs:check` and `npm run check`.

- [ ] **Step 5: Commit.**

```bash
git add studio/episode/src/spec-init.ts studio/episode/src/testing.ts studio/episode/tests/new-look.test.ts studio/episode/tests/dentro-i-versi-long.test.ts
git commit -m "A draft moves to a newer release; the long compiles on 1.1.0 end to end (avg-dcf.6.9)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
