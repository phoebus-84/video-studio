// What dentro-i-versi-long@1.0.0 does with a lesson's spec, its guide takes
// and its pinned source. The fixture is Il lampo's lesson translated from
// CreativeStudio's lezione.json, with synthetic timings: each take's words
// spread evenly over it.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { compileSpec, type CompileInput, type CompileResult } from "../src/index.js";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "dentro-i-versi-long", "1.0.0", "input.json");
const load = (): CompileInput & { spec: { data: any }; narration: any; timings: any; sources: any } => JSON.parse(readFileSync(FIXTURE, "utf-8"));

function compiled(input: CompileInput) {
  const result = compileSpec(input);
  assert.ok(result.ok, JSON.stringify(!result.ok && result.problems, null, 2));
  return result;
}
const problems = (result: CompileResult) => {
  assert.ok(!result.ok, "expected problems");
  return result.problems.map((p) => [p.code, p.path]);
};
const all = (r: ReturnType<typeof compiled>, prefix: string) =>
  r.timeline.tracks.filter((t) => t.id === prefix || t.id.startsWith(`${prefix}-`)).flatMap((t) => t.items as any[]).sort((a, b) => a.from - b.from);
const kit = (r: ReturnType<typeof compiled>, name: string) => r.timeline.tracks.flatMap((t) => t.items as any[]).filter((i) => i.kit?.name === name);

test("blocks follow each other: each lasts its take, then its gap, then a chapter's 4 s card", () => {
  const input = load();
  const r = compiled(input);
  const blocks = (r.timeline.metadata as any).blocks as { id: string; start: number; speech: number; end: number }[];
  assert.deepEqual(blocks.map((b) => b.id), input.spec.data.blocks.map((b: any) => b.id));
  const take = (id: string) => input.narration.takes.find((t: any) => t.id === id).audio.durationSeconds;
  const epoca = blocks.find((b) => b.id === "epoca")!;
  assert.equal(epoca.speech, Math.round((epoca.start + 0.4) * 1000) / 1000);
  assert.equal(epoca.end, Math.round((epoca.start + 0.4 + take("epoca") + 0.6) * 1000) / 1000);
  // ascolto1 is followed by chapter I: its card, then epoca
  const ascolto1 = blocks.find((b) => b.id === "ascolto1")!;
  const gap = input.spec.data.blocks.find((b: any) => b.id === "ascolto1").gapAfter;
  assert.ok(Math.abs(epoca.start - (ascolto1.end + gap + 4)) < 1e-6);
  assert.equal(r.timeline.durationInFrames, Math.round(blocks.at(-1)!.end * 30));
});

test("five chapter cards, the cover at the first and the last frame, and the loop declared", () => {
  const r = compiled(load());
  assert.equal(kit(r, "chapter-opener").length, 5);
  const covers = kit(r, "cover");
  assert.deepEqual(covers.map((c) => c.from), [0, r.timeline.durationInFrames - covers[1].duration]);
  assert.deepEqual(covers[0].props, covers[1].props);
  assert.equal((r.timeline as any).loop, true);
  const rooms = kit(r, "room");
  assert.equal(rooms[0].props.room.image.$asset, "theme-atrio");
  assert.equal(rooms.at(-1).props.room.image.$asset, "theme-atrio");
  assert.equal(rooms[0].props.drift, false);
});

test("the guide speaks her takes; the recitals and the title are the pinned source's", () => {
  const r = compiled(load());
  const voice = all(r, "voice");
  assert.ok(voice.every((v) => v.asset.startsWith("narration-")));
  const recital = all(r, "recital").map((v) => v.asset);
  assert.deepEqual(recital, ["source-fonte-narration-titolo", "source-fonte-narration-recita", "source-fonte-narration-recita"]);
  assert.ok(r.timeline.assets["source-fonte-image-lampo-01-cielo-terra"]);
});

test("a cue finds an elided word, and a cue that finds no word stops compilation at its path", () => {
  const input = load();
  const epoca = input.spec.data.blocks.findIndex((b: any) => b.id === "epoca");
  // «L'Italia» answers "italia"
  assert.ok(compileSpec(input).ok);
  input.spec.data.blocks[epoca].phases[1].at = { word: "teiera" };
  assert.deepEqual(problems(compileSpec(input)), [["cue-not-found", `$.data.blocks[${epoca}].phases[1].at`]]);
});

test("without the pinned source, nothing compiles", () => {
  const input = load();
  delete (input as any).sources;
  assert.deepEqual(problems(compileSpec(input)), [["missing-source", "$.data.source.pin"]]);
});

test("a verse that the recital does not say is located", () => {
  const input = load();
  input.spec.data.verses[6].text += " e poi ancora";
  assert.equal(problems(compileSpec(input))[0]![0], "verse-mismatch");
});

test("each specimen draws its figure tool with its painting, its aspect, the progress and its verses", () => {
  const r = compiled(load());
  for (const name of ["merge", "cards", "stack", "oxymoron", "simile"]) {
    const [tool] = kit(r, name);
    assert.ok(tool, name);
    assert.ok(tool.props.picture.src.$asset.startsWith("source-fonte-image-"), name);
    assert.equal(tool.props.picture.aspect, 0.75, name);
  }
  const progress = kit(r, "progress");
  assert.deepEqual(progress.map((p) => p.props.current), [0, 1, 2, 3, 4]);
});
