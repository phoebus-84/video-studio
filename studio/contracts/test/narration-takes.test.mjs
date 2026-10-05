import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  QWEN_PROVIDER,
  layoutUnit,
  takesFromNarrationManifest,
  validateNarrationTakes,
} from "../src/narration-takes.mjs";
import { resolveCue } from "../src/cues.mjs";
import { applyPatch } from "../scripts/lib/json-patch.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(root, "fixtures/narration-takes");
const read = (path) => JSON.parse(readFileSync(resolve(root, path), "utf-8"));
const doc = () => read("fixtures/narration-takes/valid/il-lampo.json");
const timings = () => ({
  epoca: read("fixtures/word-timing/valid/epoca-take.json"),
  recitazione: read("fixtures/word-timing/valid/san-martino-recital.json"),
});
const codes = (problems) => [...new Set(problems.map((p) => p.code))].sort();

describe("validateNarrationTakes", () => {
  it("accepts the Il lampo fixture", () => {
    assert.deepEqual(validateNarrationTakes(doc()), []);
  });

  it("rejects every invalid fixture with exactly its expected code", () => {
    for (const file of readdirSync(resolve(dir, "invalid"))) {
      const fixture = JSON.parse(readFileSync(resolve(dir, "invalid", file), "utf-8"));
      const broken = applyPatch(JSON.parse(readFileSync(resolve(dir, "valid", fixture.base), "utf-8")), fixture.patch);
      assert.deepEqual(codes(validateNarrationTakes(broken)), [fixture.expect], file);
    }
  });

  it("collects every problem with its path", () => {
    const d = doc();
    d.units[1].sequence[0].take = "genesi";
    delete d.units[2].sequence[1].pauseBefore;
    assert.deepEqual(validateNarrationTakes(d).map((p) => [p.code, p.path]), [
      ["unknown-take", "$.units[1].sequence[0].take"],
      ["bad-pause", "$.units[2].sequence[1]"],
    ]);
  });
});

describe("layoutUnit", () => {
  it("lays out a single whole take", () => {
    const { layout } = layoutUnit(doc(), "ascolto1", timings());
    assert.equal(layout.durationSeconds, 32.233);
    assert.deepEqual(layout.pieces, [{ take: "recitazione", at: 0, from: 0, duration: 32.233 }]);
    assert.equal(layout.timing.take.id, "ascolto1");
    assert.equal(layout.timing.words.length, 62);
    assert.equal(layout.timing.lines.length, 8);
    assert.equal(layout.energy.values.length, 967);
  });

  it("plays a reused take identically in another unit", () => {
    const one = layoutUnit(doc(), "ascolto1", timings()).layout;
    const two = layoutUnit(doc(), "ascolto2", timings()).layout;
    assert.deepEqual({ ...two, timing: { ...two.timing, take: one.timing.take } }, one);
  });

  it("splits a held take in two pieces around the silence", () => {
    const { layout } = layoutUnit(doc(), "epoca", timings());
    // "temporale." ends 41.935, "E" starts 42.393: split at 42.164, 2.5 s of silence
    assert.deepEqual(layout.pieces, [
      { take: "epoca", at: 0, from: 0, duration: 42.164 },
      { take: "epoca", at: 44.664, from: 42.164, duration: 5.669 },
    ]);
    assert.equal(layout.durationSeconds, 50.333);
    assert.deepEqual(layout.timing.words[104], { text: "temporale.", start: 41.249, end: 41.935 });
    assert.deepEqual(layout.timing.words[105], { text: "E", start: 44.893, end: 45.075 });
    assert.deepEqual(layout.timing.words[20], { text: "Myricae.", spoken: "Mirìce.", start: 8.106, end: 8.628 });
  });

  it("puts silence in the energy where the hold is", () => {
    const { layout } = layoutUnit(doc(), "epoca", timings());
    assert.equal(layout.energy.rate, 30);
    assert.equal(layout.energy.values.length, Math.round(50.333 * 30));
    const silence = layout.energy.values.slice(Math.round(42.164 * 30), Math.round(44.664 * 30));
    assert.ok(silence.length > 70 && silence.every((v) => v === 0));
  });

  it("chains two takes with the pause before the second", () => {
    const { layout } = layoutUnit(doc(), "doppio", timings());
    assert.deepEqual(layout.pieces, [
      { take: "epoca", at: 0, from: 0, duration: 47.833 },
      { take: "recitazione", at: 48.153, from: 0, duration: 32.233 },
    ]);
    assert.equal(layout.durationSeconds, 80.386);
    assert.equal(layout.timing.words.length, 118 + 62);
    assert.deepEqual(layout.timing.words[118], { text: "La", start: 52.243, end: 52.323 }); // 48.153 + 4.09
    assert.deepEqual(layout.timing.lines[0], { id: "c1", firstWord: 118, lastWord: 124, speaker: "recitante" });
  });

  it("omits energy when one take has none", () => {
    const t = timings();
    delete t.epoca.energy;
    const { layout } = layoutUnit(doc(), "doppio", t);
    assert.equal(layout.energy, undefined);
  });

  it("lets cues resolve on the words of a whole unit", () => {
    const { layout } = layoutUnit(doc(), "doppio", timings());
    const scope = { timing: layout.timing, startSeconds: 10, fps: 30 };
    assert.equal(resolveCue({ word: "temporale" }, scope).frame, Math.round((10 + 41.249) * 30));
    assert.equal(resolveCue({ line: 3, at: "end" }, scope).frame, Math.round((10 + 48.153 + 14.09) * 30));
  });

  it("refuses a take without its WordTiming", () => {
    const t = timings();
    delete t.recitazione;
    assert.deepEqual(layoutUnit(doc(), "doppio", t).problems.map((p) => [p.code, p.path]), [
      ["missing-timing", "$.units[2].sequence[1].take"],
    ]);
  });

  it("refuses a WordTiming made for another file or another text", () => {
    const otherFile = timings();
    otherFile.epoca.audio.hash = `sha256:${"9".repeat(64)}`;
    assert.deepEqual(codes(layoutUnit(doc(), "epoca", otherFile).problems), ["timing-mismatch"]);
    const otherText = timings();
    otherText.epoca.text = otherText.epoca.text.replace("Prima", "Dopo");
    assert.deepEqual(codes(layoutUnit(doc(), "epoca", otherText).problems), ["timing-mismatch"]);
  });

  it("refuses a hold after a missing word, mid-sentence, or after the last word", () => {
    for (const afterWord of ["nuvola.", "lampo", "Ruggero."]) {
      const d = doc();
      d.units[1].sequence[0].holds[0].afterWord = afterWord;
      const { problems } = layoutUnit(d, "epoca", timings());
      assert.deepEqual(problems.map((p) => [p.code, p.path]), [["bad-hold", "$.units[1].sequence[0].holds[0].afterWord"]], afterWord);
    }
  });

  it("refuses two holds after the same word", () => {
    const d = doc();
    d.units[1].sequence[0].holds.push({ afterWord: "temporale.", seconds: 1, reason: "again" });
    assert.deepEqual(layoutUnit(d, "epoca", timings()).problems.map((p) => [p.code, p.path]), [
      ["bad-hold", "$.units[1].sequence[0].holds[1].afterWord"],
    ]);
  });

  it("throws for a unit that does not exist", () => {
    assert.throws(() => layoutUnit(doc(), "genesi", timings()), RangeError);
  });
});

describe("takesFromNarrationManifest", () => {
  const wav = (name, durationSeconds, hex) => ({
    path: `artifacts/narration/${name}.wav`, contentHash: `sha256:${hex.repeat(64)}`, sizeBytes: 1000,
    durationSeconds, sampleRate: 24000, channels: 1, sampleWidthBytes: 2,
  });
  // The lighter shape studio/agent/src/narration-manifest.ts writes.
  const agentManifest = {
    schemaVersion: "0.1.0",
    leadInSilenceSeconds: 0.5,
    entries: [
      { segmentId: "s1", wav: wav("s1", 1.5, "1"), pauseAfterMs: 250, acceptedAttemptId: "a1" },
      { segmentId: "s2", wav: wav("s2", 2.25, "2"), pauseAfterMs: 400 },
      { segmentId: "s3", wav: wav("s3", 0.75, "3"), pauseAfterMs: 0 },
    ],
    captions: [
      { segmentId: "s1", index: 1, startSeconds: 0.5, endSeconds: 2, text: "Uno." },
      { segmentId: "s2", index: 2, startSeconds: 2.25, endSeconds: 4.5, text: "Due." },
      { segmentId: "s3", index: 3, startSeconds: 4.9, endSeconds: 5.65, text: "Tre." },
    ],
  };
  const timingFor = (take) => ({
    apiVersion: "studio.video/v1alpha1", kind: "WordTiming", take: { id: take.id }, audio: take.audio, text: take.text,
    language: "it", alignment: { provider: "whisper-cpp", method: "asr", createdAt: "2026-10-05T00:00:00Z" },
    words: [{ text: take.text, start: 0.1, end: take.audio.durationSeconds - 0.1 }],
  });

  it("maps the canonical manifest fixture, text from its segment", () => {
    const fixture = read("fixtures/narration/valid.json");
    const { takes, leadInSeconds } = takesFromNarrationManifest(fixture.manifest, { segments: [fixture.segment] });
    assert.equal(leadInSeconds, 0);
    assert.deepEqual(validateNarrationTakes(takes), []);
    assert.deepEqual(takes.takes[0], {
      id: "scene-1.turn-1",
      audio: { path: "artifacts/narration/scene-1.wav", hash: fixture.manifest.entries[0].wav.contentHash, durationSeconds: 1 },
      text: "Hello world.",
      role: "narrator",
      language: "en-US",
      voice: { provider: QWEN_PROVIDER },
      source: { segmentId: "scene-1.turn-1", attemptId: "11111111-1111-4111-8111-111111111111" },
    });
  });

  it("maps the agent's manifest, text from captions, positions unchanged", () => {
    const { takes, leadInSeconds } = takesFromNarrationManifest(agentManifest);
    assert.deepEqual(validateNarrationTakes(takes), []);
    assert.deepEqual(takes.units, [{
      id: "narration",
      sequence: [{ take: "s1" }, { take: "s2", pauseBefore: 0.25 }, { take: "s3", pauseBefore: 0.4 }],
    }]);
    const timings = Object.fromEntries(takes.takes.map((t) => [t.id, timingFor(t)]));
    const { layout } = layoutUnit(takes, "narration", timings);
    // The agent's cursor: lead-in, then duration + pause per segment.
    let cursor = agentManifest.leadInSilenceSeconds;
    const expected = agentManifest.entries.map((e) => {
      const at = Number(cursor.toFixed(6));
      cursor += e.wav.durationSeconds + e.pauseAfterMs / 1000;
      return at;
    });
    assert.deepEqual(layout.pieces.map((p) => Number((leadInSeconds + p.at).toFixed(6))), expected);
  });

  it("treats a missing pauseAfterMs as no pause, as the agent does", () => {
    const entries = agentManifest.entries.map((e, i) => (i === 0 ? { segmentId: e.segmentId, wav: e.wav } : e));
    const { takes } = takesFromNarrationManifest({ ...agentManifest, entries });
    assert.equal(takes.units[0].sequence[1].pauseBefore, 0);
  });

  it("throws instead of returning takes that fail validation", () => {
    const entries = agentManifest.entries.map((e, i) => (i === 0 ? { ...e, pauseAfterMs: 20000 } : e));
    assert.throws(() => takesFromNarrationManifest({ ...agentManifest, entries }), /not valid narration takes:.*schema/);
  });

  it("refuses to map a segment it has no text for", () => {
    const bare = { ...agentManifest, captions: agentManifest.captions.slice(1) };
    assert.throws(() => takesFromNarrationManifest(bare), /no text for segments: s1/);
  });
});
