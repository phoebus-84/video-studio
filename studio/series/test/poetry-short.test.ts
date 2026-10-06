// What poetry-short@1.0.0 does with a spec and its narration. The fixture:
// take "light" (2.6 s) from 0 s, then 0.5 s of silence, then take "cup"
// (5.2 s) from 3.1 s with a 1 s pause after "window." — 9.3 s of narration,
// then holdSeconds 1.5: 10.8 s, 324 frames. Panels change on "Light" (frame
// 3), "cup" (3.1 + 0.12 s → frame 97) and "cat" (3.1 + 2.72 + 1 s of pause →
// frame 205).

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { outputProfile } from "@studio/contracts/src/output-profiles.mjs";
import { compileSpec, type CompileInput, type CompileResult } from "../src/index.js";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "poetry-short", "1.0.0", "input.json");
const load = (): CompileInput & { spec: { data: any } } => JSON.parse(readFileSync(FIXTURE, "utf-8"));

function compiled(input: CompileInput) {
  const result = compileSpec(input);
  assert.ok(result.ok, JSON.stringify(!result.ok && result.problems, null, 2));
  return result;
}
const problems = (result: CompileResult) => {
  assert.ok(!result.ok, "expected problems");
  return result.problems;
};
const track = (r: ReturnType<typeof compiled>, id: string) => r.timeline.tracks.find((t) => t.id === id)!.items as any[];

/** Replace the narration by one take saying `words`, 0.3 s each, and cue every panel on the first word. */
function soloTake(input: ReturnType<typeof load>, words: string[]) {
  const text = words.join(" ");
  const audio = { path: "assets/takes/solo.wav", hash: `sha256:${"a".repeat(64)}`, durationSeconds: words.length * 0.3 };
  input.narration.takes = [{ id: "solo", audio, text, voice: { provider: "qwen3-tts-local" }, timing: { path: "artifacts/timing/solo.json", hash: `sha256:${"b".repeat(64)}` } }];
  input.narration.units = [{ id: "narration", sequence: [{ take: "solo" }] }];
  input.timings = {
    solo: {
      apiVersion: "studio.video/v1alpha1", kind: "WordTiming", take: { id: "solo" }, audio, text, language: "en",
      alignment: { provider: "fixture", method: "forced", createdAt: "2026-10-06T00:00:00Z" },
      words: words.map((w, i) => ({ text: w, start: Math.round(i * 300) / 1000, end: Math.round((i + 1) * 300) / 1000 })),
    },
  } as never;
  delete input.assets["narration-light"];
  delete input.assets["narration-cup"];
  input.assets["narration-solo"] = { path: audio.path, hash: audio.hash, kind: "audio" };
  input.spec.data.narration = text;
  input.spec.data.panels = [{ assetId: "morning-room", cue: words[0] }];
}

test("each panel starts on its cue, crossfading over 12 frames centred on it", () => {
  const panels = track(compiled(load()), "panels");
  assert.deepEqual(panels.map((p) => [p.id, p.from, p.from + p.duration, p.transitionIn?.duration ?? null]), [
    ["panel-1", 0, 103, null],
    ["panel-2", 91, 211, 12],
    ["panel-3", 199, 324, 12],
  ]);
  assert.deepEqual(panels.map((p) => p.props), [
    { src: { $asset: "image-morning-room" }, fit: "cover" },
    { src: { $asset: "image-teacup" }, fit: "cover" },
    { src: { $asset: "image-cat" }, fit: "cover" },
  ]);
  assert.deepEqual(panels.map((p) => p.source), ["panels[0]", "panels[1]", "panels[2]"]);
});

test("the first panel opens the video whatever its cue", () => {
  const input = load();
  input.spec.data.panels[0].cue = "quiet"; // 1.34 s: frame 40
  assert.equal(track(compiled(input), "panels")[0].from, 0);
});

test("the last panel holds for holdSeconds after the narration", () => {
  const input = load();
  assert.equal(compiled(input).timeline.durationInFrames, 324);
  input.spec.data.holdSeconds = 0;
  const r = compiled(input);
  assert.equal(r.timeline.durationInFrames, 279);
  const panels = track(r, "panels");
  assert.equal(panels.at(-1).from + panels.at(-1).duration, 279);
});

test("a panel shorter than 13 frames gets no crossfade on either side", () => {
  const input = load();
  // "of" is said 0.4 s into "cup": frame 105, 8 frames after "cup".
  input.spec.data.panels.splice(2, 0, { assetId: "teacup", cue: "of" });
  const panels = track(compiled(input), "panels");
  assert.deepEqual(panels.map((p) => [p.from, p.from + p.duration, p.transitionIn?.duration ?? null]), [
    [0, 97, null],
    [97, 105, null],
    [105, 211, null],
    [199, 324, 12],
  ]);
});

test("the voice plays each take where layoutUnit puts it, the hold splitting a take in two", () => {
  const voice = track(compiled(load()), "voice");
  assert.deepEqual(voice.map((v) => [v.id, v.asset, v.from, v.duration, v.trimStart ?? 0]), [
    ["voice-1", "narration-light", 0, 78, 0],
    // 0.5 s after "light" ends; the hold falls halfway between "window." (2.3 s) and "The" (2.6 s).
    ["voice-2", "narration-cup", 93, 74, 0],
    ["voice-3", "narration-cup", 197, 82, 74],
  ]);
});

test("captions are the measured words grouped at sentence ends", () => {
  const captions = track(compiled(load()), "captions");
  assert.deepEqual(captions.map((c) => [c.from, c.from + c.duration, c.props.text]), [
    [3, 72, "Light falls across the quiet room."],
    [95, 162, "A cup of tea is cooling by the window."],
    [201, 273, "The cat has not moved since dawn."],
  ]);
  for (const c of captions) {
    assert.deepEqual(c.kit, { name: "captions", version: "1.1.0" });
    assert.equal(c.props.position, "bottom");
    assert.equal(c.props.font, "Georgia");
  }
});

test("a caption closes at ; or : and before passing 42 characters", () => {
  const input = load();
  const words = "Under the wide and starry sky; dig the grave and let me lie, glad did I live and gladly die and I laid me down with a will".split(" ");
  soloTake(input, words);
  const texts = track(compiled(input), "captions").map((c) => c.props.text);
  assert.equal(texts[0], "Under the wide and starry sky;");
  for (const text of texts) assert.ok(text.length <= 42, `"${text}" is ${text.length} characters`);
  assert.equal(texts.join(" "), words.join(" "));
});

test("the timeline carries the profile whole, its provenance and the title as a chapter", () => {
  const r = compiled(load());
  assert.deepEqual(r.timeline.profile, outputProfile("vertical-1080x1920"));
  assert.deepEqual(r.timeline.resolution, { width: 1080, height: 1920 });
  assert.deepEqual(r.timeline.derivedFrom, {
    spec: { path: "episode-spec.json", hash: load().inputs["episode-spec.json"], revision: 2 },
    compiler: { id: "poetry-short", version: "1.0.0" },
  });
  assert.equal((r.timeline.metadata as any).builtBy, "@studio/series poetry-short@1.0.0");
  assert.deepEqual((r.timeline.metadata as any).template, load().spec.template);
  assert.deepEqual(Object.keys((r.timeline.metadata as any).inputs), Object.keys(load().inputs).sort());
  assert.deepEqual(r.timeline.sections, [{ id: "poem", from: 0, duration: 324, source: "title", chapter: { title: "Morning" } }]);
});

test("narration-mismatch: the takes do not say the spec's narration", () => {
  const input = load();
  input.spec.data.narration = "Light falls across the empty room. A cup of tea is cooling by the window. The cat has not moved since dawn.";
  assert.deepEqual(problems(compileSpec(input)).map((p) => [p.code, p.path]), [["narration-mismatch", "$.data.narration"]]);
});

test("whitespace alone is not a narration mismatch", () => {
  const input = load();
  input.spec.data.narration = `  ${input.spec.data.narration.replace(/ /g, "\n  ")} `;
  compiled(input);
});

test("cue-order: a panel cued before the one it follows", () => {
  const input = load();
  input.spec.data.panels = [{ assetId: "morning-room", cue: "Light" }, { assetId: "cat", cue: "cat" }, { assetId: "teacup", cue: "cup" }];
  assert.deepEqual(problems(compileSpec(input)).map((p) => [p.code, p.path]), [["cue-order", "$.data.panels[2].cue"]]);
});

test("two panels may show the same picture", () => {
  const input = load();
  input.spec.data.panels[2].assetId = "morning-room";
  const r = compiled(input);
  assert.deepEqual(Object.keys(r.timeline.assets).filter((id) => id.startsWith("image-")), ["image-morning-room", "image-teacup"]);
  assert.deepEqual(track(r, "panels").map((p) => p.props.src.$asset), ["image-morning-room", "image-teacup", "image-morning-room"]);
});

test("a cue on a word never said is reported at its path", () => {
  const input = load();
  input.spec.data.panels[1].cue = "teapot";
  assert.deepEqual(problems(compileSpec(input)).map((p) => [p.code, p.path]), [["unknown-word", "$.data.panels[1].cue"]]);
});

test("missing-asset: a panel whose image the loader did not find", () => {
  const input = load();
  delete input.assets["image-teacup"];
  assert.deepEqual(problems(compileSpec(input)).map((p) => [p.code, p.path]), [["missing-asset", "$.data.panels[1].assetId"]]);
});

test("unknown-profile: a profile not in the catalog", () => {
  const input = load();
  input.spec.data.style.outputProfile = "square-1080x1080";
  assert.deepEqual(problems(compileSpec(input)).map((p) => [p.code, p.path]), [["unknown-profile", "$.data.style.outputProfile"]]);
});

test("missing-unit: takes.json has no narration unit", () => {
  const input = load();
  input.narration.units[0]!.id = "recital";
  assert.deepEqual(problems(compileSpec(input)).map((p) => [p.code, p.path]), [["missing-unit", "$.units"]]);
});

test("a layoutUnit problem comes back with its path in takes.json", () => {
  const input = load();
  delete (input.timings as Record<string, unknown>).cup;
  assert.deepEqual(problems(compileSpec(input)).map((p) => [p.code, p.path]), [["missing-timing", "$.units[0].sequence[1].take"]]);
});

test("unknown-compiler names the versions that exist", () => {
  const input = load();
  input.template.compiler.version = "2.0.0";
  const [problem, ...rest] = problems(compileSpec(input));
  assert.equal(rest.length, 0);
  assert.equal(problem!.code, "unknown-compiler");
  assert.equal(problem!.path, "$.template.compiler");
  assert.match(problem!.message, /poetry-short@2\.0\.0: available poetry-short@1\.0\.0/);
});
