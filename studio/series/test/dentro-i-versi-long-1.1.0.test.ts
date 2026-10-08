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
  assert.deepEqual([headline.props.x, headline.props.y], [420 + 1100 / 2, 140 + 620 - 200]);
  input.theme.layout.panel = { x: 440, y: 150, w: 700, h: 596 };
  assert.ok(problems(compileSpec(input)).every(([code]) => code === "text-off-panel"));
});

test("the glass itself moves with the theme's panel: every kit drawn on it gets the box", () => {
  const input = load();
  const box = { x: 420, y: 140, w: 1100, h: 620 };
  input.theme.layout.panel = box;
  const onPanel = new Set(["panel", "word-tracks", "progress", "merge", "cards", "stack", "oxymoron", "simile", "syllables", "rhymes", "story-fx"]);
  const drawn = items(compiled(input)).filter((i) => onPanel.has(i.kit?.name));
  assert.ok(drawn.length > 20);
  for (const i of drawn) assert.deepEqual(i.props.box, box, i.id);
});

test("a title's plate ends on the glass, above the verse bar", () => {
  const titles = items(compiled(load())).filter((i) => i.kit?.name === "figure-title");
  // figure-title's y is its plate's top; the plate is about 180 px tall (kicker, gap, 96 px title, padding)
  for (const t of titles) assert.ok(t.props.y + 180 <= PANEL.y + PANEL.h, `${t.id} at y ${t.props.y}`);
});

test("the quote's interlinear and the announcement's title are writing too, held to the glass", () => {
  const input = load();
  const note = input.spec.data.blocks.findIndex((b: any) => b.kind === "note");
  input.spec.data.blocks[note].quote.interlinear.x = 1500;
  assert.deepEqual(problems(compileSpec(input)), [["text-off-panel", `$.data.blocks[${note}].quote.interlinear`]]);
  const narrow = load();
  narrow.theme.layout.panel = { x: 440, y: 150, w: 700, h: 596 };
  const announcement = narrow.spec.data.blocks.findIndex((b: any) => b.kind === "announcement");
  assert.ok(problems(compileSpec(narrow)).some(([code, path]) => code === "text-off-panel" && path === `$.data.blocks[${announcement}]`));
});

test("a stack measured from the bottom is held by its bottom; a stack with no place is off the glass", () => {
  const input = load();
  const story = input.spec.data.blocks.findIndex((b: any) => b.kind === "story");
  const stack = input.spec.data.blocks[story].phases[0].texts[0];
  stack.bottom = true;
  stack.y = 140;
  assert.deepEqual(problems(compileSpec(input)), [["text-off-panel", `$.data.blocks[${story}].phases[0].texts[0]`]]);
  stack.y = 700;
  assert.ok(compileSpec(input).ok);
  delete stack.bottom;
  delete stack.x;
  assert.deepEqual(problems(compileSpec(input)), [["text-off-panel", `$.data.blocks[${story}].phases[0].texts[0]`]]);
});

test("without a theme panel, 1.0.0's box", () => {
  const input = load();
  delete input.theme.layout.panel;
  const headline = items(compiled(input)).find((i) => i.id.startsWith("headline-"));
  assert.deepEqual([headline.props.x, headline.props.y], [PANEL.x + PANEL.w / 2, PANEL.y + PANEL.h - 200]);
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
  for (const t of titles) assert.deepEqual([t.props.x, t.props.y], [PANEL.x + PANEL.w / 2, PANEL.y + PANEL.h - 200], t.id);
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
