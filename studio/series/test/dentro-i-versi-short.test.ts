// What dentro-i-versi-short@1.0.0 does with a spec and its takes. The
// fixture is a synthetic San Martino with CreativeStudio's timing: the title
// take (3 s) from 0.3 s, a 0.69 s pause, the recital from 3.99 s; its first
// word "La" at 4.09 s, its last, "migrar.", ends at 31.63 s — the end of the
// voice. The video lasts until 6 s later: 37.63 s, 1129 frames.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { compileSpec, type CompileInput, type CompileResult } from "../src/index.js";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "dentro-i-versi-short", "1.0.0", "input.json");
const load = (): CompileInput & { spec: { data: any }; narration: any } => JSON.parse(readFileSync(FIXTURE, "utf-8"));

function compiled(input: CompileInput) {
  const result = compileSpec(input);
  assert.ok(result.ok, JSON.stringify(!result.ok && result.problems, null, 2));
  return result;
}
const problems = (result: CompileResult) => {
  assert.ok(!result.ok, "expected problems");
  return result.problems.map((p) => [p.code, p.path]);
};
const items = (r: ReturnType<typeof compiled>, prefix: string) =>
  r.timeline.tracks.filter((t) => t.id === prefix || t.id.startsWith(`${prefix}-`)).flatMap((t) => t.items as any[]).sort((a, b) => a.from - b.from);
const only = (r: ReturnType<typeof compiled>, id: string) => items(r, id)[0]!;
const close = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a}, not ${b}`);

test("the video lasts until 6 s after the end of the voice; verses start on their first word", () => {
  const r = compiled(load());
  assert.equal(r.timeline.durationInFrames, 1129);
  assert.equal((r.timeline.metadata as any).voiceEnd, 31.63);
  const sections = Object.fromEntries(r.timeline.sections!.map((s) => [s.id, s.from]));
  assert.equal(sections["title"], 0);
  assert.equal(sections["verse-1"], 123); // 4.09 s
  assert.equal(sections["bow"], 949); // 31.63 s
});

test("the takes play from 0.3 s, the recital after its pause", () => {
  const voice = items(compiled(load()), "voice");
  assert.deepEqual(voice.map((v) => [v.asset, v.from]), [["narration-titolo", 9], ["narration-recita", 120]]);
});

test("the voice ends on voiceEndWord, matched without punctuation or case, in the last verse", () => {
  const input = load();
  input.spec.data.voiceEndWord = "Vespero";
  const r = compiled(input);
  const vespero = input.timings.recita!.words.find((w: any) => w.text === "vespero")!;
  close((r.timeline.metadata as any).voiceEnd, Math.round((vespero.end + 3.99) * 1000) / 1000, "voice end");
});

test("a take that runs past the end of the video is cut there", () => {
  const input = load();
  // 40 s of recording after the poem's last word: the video ends 6 s after it.
  input.narration.takes[1].audio.durationSeconds = 40;
  input.timings.recita!.audio.durationSeconds = 40;
  const r = compiled(input);
  const voice = items(r, "voice");
  assert.equal(voice.at(-1).from + voice.at(-1).duration, r.timeline.durationInFrames);
});

test("lightning strikes at each picture change during the voice, 0.05 s before it", () => {
  const hall = only(compiled(load()), "hall");
  // Pictures 2–8 change on verses 2–8; picture 9 comes back at end + 4.3 s, after the voice.
  assert.deepEqual(hall.props.flash.strikes, [7.48, 11.34, 14.51, 18.81, 22.22, 25.97, 29.22]);
  assert.equal(hall.props.pictures[8].at, 35.93);
});

test("the camera breathes over the poem and pushes on the spec's verses", () => {
  const { zoom } = only(compiled(load()), "hall").props.camera;
  assert.deepEqual(zoom[0], { from: 4.09, to: 33.43, rampIn: 27.54, rampOut: 1.4, amount: 0.025 });
  assert.equal(zoom.length, 4); // the body and pushVerses [1, 5, 7]
  assert.deepEqual(zoom[1], { from: 3.84, to: 7.95, rampIn: 0.8, rampOut: 0.8, amount: 0.027 });
});

test("shake, wind and room effects take their times from the words", () => {
  const r = compiled(load());
  const { shake } = only(r, "hall").props.camera;
  const urla = load().timings.recita!.words.find((w: any) => w.text === "urla")!;
  close(shake[0].from, Math.round((urla.start + 3.99 - 0.1) * 1000) / 1000, "shake from");
  assert.equal(shake[0].amount, 4);
  // nebbia-sala from verse 1 + 0.2 s: its item starts on that frame, the effect at its start.
  const fog = items(r, "room").find((i) => i.id === "room-1")!;
  assert.equal(fog.from, Math.round((4.09 + 0.2) * 30));
  assert.ok(fog.props.start >= 0 && fog.props.start < 1 / 30);
  assert.deepEqual(fog.props.textures, { fog: { $asset: "image-nebbia-texture" } });
});

test("blinks start at 1.1 s, 2–5 s apart, until the end", () => {
  const { blinks } = only(compiled(load()), "actor").props;
  assert.equal(blinks[0], 1.1);
  for (let i = 1; i < blinks.length; i++) {
    const gap = blinks[i] - blinks[i - 1];
    assert.ok(gap >= 2 && gap <= 5, `blink ${i} comes ${gap} s after the one before`);
  }
  assert.ok(blinks.at(-1) < 37.63 && blinks.at(-1) > 37.63 - 5);
});

test("the actor rests at 0 and at the end of the voice, and opens the mouth only while speaking", () => {
  const actor = only(compiled(load()), "actor").props;
  assert.equal(actor.poses[0].at, 0);
  assert.equal(actor.poses.at(-1).at, 31.63);
  assert.deepEqual(actor.poses.at(-1).pose, { lu: 7, lf: 4, ru: 7, rf: 4, head: 0, lean: 0, grip: 0, step: 0, twist: 0, dip: 0 });
  assert.deepEqual(actor.mouth.from, 3.99);
  assert.deepEqual(actor.mouth.to, 31.63);
  // The energy starts with 0.3 s of silence: the takes start at 0.3 s.
  assert.deepEqual(actor.mouth.energy.values.slice(0, 9), new Array(9).fill(0));
  assert.deepEqual(actor.bow, { from: 34.13, to: 36.33 });
});

test("the title card fits the space left of the actor: one line when it fits at 100 px, else two", () => {
  const card = only(compiled(load()), "card");
  assert.equal(card.props.maxWidth, 514);
  // "SAN MARTINO" would be 86 px on one line: two lines, sized by the longer.
  assert.deepEqual(card.props.titleLines, ["SAN", "MARTINO"]);
  assert.equal(card.props.size, 124);
  const input = load();
  input.spec.data.title = "Alla sera";
  delete input.spec.data.titleLines;
  const short = only(compiled(input), "card");
  assert.deepEqual(short.props.titleLines, ["ALLA SERA"]);
  assert.equal(short.props.size, 105);
});

test("the chip names the author only for a short title", () => {
  assert.equal(only(compiled(load()), "chip").props.author, "Giosuè Carducci");
  const input = load();
  input.spec.data.title = "Il cinque maggio";
  assert.equal(only(compiled(input), "chip").props.author, undefined);
});

test("each verse plate lights its words at their times, relative to the plate", () => {
  const plate = items(compiled(load()), "verses")[0]!;
  assert.equal(plate.from, Math.round((4.09 - 0.28) * 30));
  assert.equal(plate.props.words[0].text, "La");
  close(plate.props.words[0].at, plate.props.start, "the first word lights at the verse's start");
  assert.equal(plate.props.words.length, 7);
});

test("no track has overlapping items: overlaps go to the next lane", () => {
  const r = compiled(load());
  for (const track of r.timeline.tracks) {
    const sorted = [...(track.items as any[])].sort((a, b) => a.from - b.from);
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].from >= sorted[i - 1].from + sorted[i - 1].duration, `${track.id}: ${sorted[i].id} overlaps`);
  }
  assert.ok(r.timeline.tracks.some((t) => t.id === "verses-2"));
  assert.ok(r.timeline.tracks.some((t) => t.id === "sfx-2"));
});

test("refuses, with the path of the cause", async (t) => {
  const cases: [string, (input: ReturnType<typeof load>) => void, [string, string][]][] = [
    ["a word the recital does not say", (i) => { i.spec.data.roomFx[1].at = "word:vendemmia"; }, [["unknown-word", "$.data.roomFx[1].at"]]],
    ["a time that is not one", (i) => { i.spec.data.poses[0].at = "verso:1"; }, [["bad-time", "$.data.poses[0].at"]]],
    ["a picture that does not exist", (i) => { i.spec.data.gaze[1].from = "picture:12"; }, [["bad-time", "$.data.gaze[1].from"]]],
    ["a verse that is not what was said", (i) => { i.spec.data.verses[2].text = "ma per le vie del borgo dal ribollir dei tini"; }, [["verse-mismatch", "$.data.verses[2].text"]]],
    ["verses with more words than the recital", (i) => { i.spec.data.verses[7].text += " ancora"; }, [["verse-mismatch", "$.data.verses"]]],
    ["a picture with no image", (i) => { i.spec.data.pictures[3].assetId = "sm-04-mancante"; }, [["missing-asset", "$.data.pictures[3].assetId"]]],
    ["a sound with no file", (i) => { i.spec.data.sfx[0].assetId = "pioggia-mancante"; }, [["missing-asset", "$.data.sfx[0].assetId"]]],
    ["an unknown pose", (i) => { i.spec.data.poses[2].preset = "saluta"; }, [["unknown-pose", "$.data.poses[2].preset"]]],
    ["an unknown costume", (i) => { i.spec.data.actor.base = "attore-dante"; }, [["unknown-palette", "$.data.actor.base"]]],
    ["a voiceEndWord never said", (i) => { i.spec.data.voiceEndWord = "fine"; }, [["unknown-word", "$.data.voiceEndWord"]]],
    ["a voiceEndWord last said before the last verse", (i) => { i.spec.data.voiceEndWord = "il"; }, [["voice-end-early", "$.data.voiceEndWord"]]],
    ["a sound after the end", (i) => { i.spec.data.sfx[0].at = "end+6.5"; }, [["after-end", "$.data.sfx[0].at"]]],
    ["a room effect after the end", (i) => { i.spec.data.roomFx[0].at = "end+7"; i.spec.data.roomFx[0].to = "end+9"; }, [["after-end", "$.data.roomFx[0].at"]]],
    ["the poem without its title", (i) => { i.narration.units[0].sequence = [{ take: "recita" }]; }, [["missing-take", "$.units"]]],
    ["no recital unit", (i) => { i.narration.units[0].id = "poem"; }, [["missing-unit", "$.units"]]],
  ];
  for (const [name, change, expected] of cases) {
    await t.test(name, () => {
      const input = load();
      change(input);
      assert.deepEqual(problems(compileSpec(input)), expected);
    });
  }
});
