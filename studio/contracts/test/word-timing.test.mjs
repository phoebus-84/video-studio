import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lineSpan, validateWordTiming } from "../src/word-timing.mjs";
import { applyPatch } from "../scripts/lib/json-patch.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(root, "fixtures/word-timing");
const read = (path) => JSON.parse(readFileSync(path, "utf-8"));
const epoca = () => read(resolve(dir, "valid/epoca-take.json"));
const sanMartino = () => read(resolve(dir, "valid/san-martino-recital.json"));
const codes = (problems) => [...new Set(problems.map((p) => p.code))].sort();

describe("validateWordTiming", () => {
  it("accepts every valid fixture", () => {
    for (const file of readdirSync(resolve(dir, "valid"))) {
      assert.deepEqual(validateWordTiming(read(resolve(dir, "valid", file))), [], file);
    }
  });

  it("rejects every invalid fixture with exactly its expected code", () => {
    for (const file of readdirSync(resolve(dir, "invalid"))) {
      const fixture = read(resolve(dir, "invalid", file));
      const doc = applyPatch(read(resolve(dir, "valid", fixture.base)), fixture.patch);
      assert.deepEqual(codes(validateWordTiming(doc)), [fixture.expect], file);
    }
  });

  it("rejects timing made for another take", () => {
    const doc = epoca();
    const other = `sha256:${"9".repeat(64)}`;
    assert.deepEqual(validateWordTiming(doc, { audioHash: other }).map((p) => [p.code, p.path]), [["audio-mismatch", "$.audio.hash"]]);
    assert.deepEqual(validateWordTiming(doc, { audioHash: doc.audio.hash }), []);
    assert.deepEqual(validateWordTiming(doc), []);
  });

  it("reports schema problems first and nothing else", () => {
    const doc = epoca();
    doc.words[3].start = -1;
    doc.words[5].start = 99;
    const problems = validateWordTiming(doc);
    assert.deepEqual(codes(problems), ["schema"]);
    assert.ok(problems.some((p) => p.path === "$.words[3].start"));
  });

  it("collects every semantic problem with its path", () => {
    const doc = epoca();
    doc.words[10].start = doc.words[9].start; // starts before the previous word ends
    doc.energy.values.push(...new Array(10).fill(0));
    assert.deepEqual(validateWordTiming(doc).map((p) => [p.code, p.path]), [
      ["word-order", "$.words[10].start"],
      ["energy-length", "$.energy.values"],
    ]);
  });

  it("tolerates aligner rounding, but not more", () => {
    const doc = epoca();
    doc.words[10].start = doc.words[9].end - 0.0005;
    assert.deepEqual(validateWordTiming(doc), []);
    doc.words[10].start = doc.words[9].end - 0.002;
    assert.deepEqual(codes(validateWordTiming(doc)), ["word-order"]);

    const tail = epoca();
    const last = tail.words.length - 1;
    tail.words[last].end = tail.audio.durationSeconds + 0.04;
    assert.deepEqual(validateWordTiming(tail), []);
    tail.words[last].end = tail.audio.durationSeconds + 0.06;
    assert.deepEqual(codes(validateWordTiming(tail)), ["out-of-range"]);
  });

  it("compares text ignoring whitespace runs, not punctuation", () => {
    const doc = epoca();
    doc.text = `  ${doc.text.replace(/ /g, "  \n")} `;
    assert.deepEqual(validateWordTiming(doc), []);
    doc.words[4].text = "versi";
    assert.deepEqual(validateWordTiming(doc).map((p) => [p.code, p.path]), [["text-mismatch", "$.words[4].text"]]);
  });

  it("notices a word missing at the end", () => {
    const doc = epoca();
    doc.words.pop();
    assert.deepEqual(codes(validateWordTiming(doc)), ["text-mismatch"]);
  });
});

describe("lineSpan", () => {
  it("derives a verse's start, end, text and speaker from its words", () => {
    assert.deepEqual(lineSpan(sanMartino(), 0), {
      id: "c1",
      start: 4.09,
      end: 6.65,
      text: "La nebbia agli irti colli piovigginando sale,",
      speaker: "recitante",
    });
  });

  it("refuses a line that does not exist", () => {
    assert.throws(() => lineSpan(sanMartino(), 8), RangeError);
    assert.throws(() => lineSpan(epoca(), 0), RangeError);
  });
});
