import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeWord, resolveCue, resolveCues } from "../src/cues.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => JSON.parse(readFileSync(resolve(root, rel), "utf-8"));
const epoca = read("fixtures/word-timing/valid/epoca-take.json");
const sanMartino = read("fixtures/word-timing/valid/san-martino-recital.json");

// The epoca take placed at the start of the episode, at 30 fps.
const scope = { timing: epoca, startSeconds: 0, fps: 30 };
const frame = (cue, s = scope) => resolveCue(cue, s).frame;
const code = (cue, s = scope) => resolveCue(cue, s).problem?.code;

describe("normalizeWord", () => {
  it("drops case, accents and punctuation", () => {
    assert.equal(normalizeWord("Perché,"), "perche");
    assert.equal(normalizeWord("L'Italia"), "litalia");
    assert.equal(normalizeWord("Myricae."), "myricae");
    assert.equal(normalizeWord("1894,"), "1894");
  });
});

describe("resolveCue on words", () => {
  it("matches a whole word, ignoring punctuation", () => {
    assert.equal(frame("versi"), 26); // "versi," starts at 0.874 s
  });

  it("matches after an elision, with or without the article", () => {
    assert.equal(frame("italia"), 269); // "L'Italia" at 8.974 s
    assert.equal(frame("l'italia"), 269);
  });

  it("matches the written word, not its pronunciation", () => {
    assert.equal(frame("myricae"), 243); // "Myricae." (spoken "Mirìce.") at 8.106 s
    assert.equal(code("mirice"), "unknown-word");
  });

  it("counts occurrences in take order", () => {
    assert.equal(frame({ word: "di", n: 3 }), 318); // the third "di" at 10.606 s
    const missing = resolveCue({ word: "di", n: 99 }, scope).problem;
    assert.equal(missing.code, "unknown-word");
    assert.match(missing.message, /only 10 times/);
  });

  it("matches by prefix only when asked", () => {
    assert.equal(frame("terr*"), 896); // "terra," at 29.853 s
    assert.equal(code("terr"), "unknown-word");
  });

  it("anchors to the end of a word and applies the offset", () => {
    assert.equal(frame({ word: "lampo", at: "end", offset: -0.3 }), 119); // 4.271 - 0.3 = 3.971 s
  });
});

describe("resolveCue on lines, takes, marks and seconds", () => {
  it("resolves a verse by number", () => {
    assert.equal(frame({ line: 3, at: "end" }, { timing: sanMartino, startSeconds: 0, fps: 30 }), 423); // "tini" ends 14.09 s
    assert.equal(frame({ line: 1 }, { timing: sanMartino, startSeconds: 0, fps: 30 }), 123); // "La" at 4.09 s
  });

  it("refuses a verse that does not exist", () => {
    assert.equal(code({ line: 9 }, { timing: sanMartino, startSeconds: 0, fps: 30 }), "unknown-line");
    assert.equal(code({ line: 1 }), "unknown-line"); // the epoca take has no lines
  });

  it("resolves the start and the end of the take", () => {
    assert.equal(frame({ take: "start" }), 0);
    assert.equal(frame({ take: "end" }), 1423); // "Ruggero." ends at 47.422 s
    assert.equal(frame({ take: "end", offset: 4 }), 1543); // past the take is allowed
  });

  it("resolves named marks and refuses unknown ones", () => {
    const marked = { ...scope, marks: { "picture:2": 12.8 } };
    assert.equal(frame({ mark: "picture:2", offset: 0.3 }, marked), 393);
    assert.equal(code({ mark: "picture:3" }, marked), "unknown-mark");
    assert.equal(code({ mark: "picture:2" }), "unknown-mark");
  });

  it("treats a number as seconds into the take", () => {
    assert.equal(frame(4.5, { ...scope, startSeconds: 2 }), 195);
  });

  it("places the take in the episode and rounds to the nearest frame", () => {
    assert.equal(frame("versi", { timing: epoca, startSeconds: 12.5, fps: 24 }), 321); // 13.374 s × 24 = 320.976
    assert.deepEqual(resolveCue("versi", { timing: epoca, startSeconds: 12.5, fps: 24 }).seconds, 12.5 + 0.874);
  });

  it("refuses a time before the start of the episode", () => {
    assert.equal(code({ take: "start", offset: -1 }, { ...scope, startSeconds: 0.5 }), "before-start");
  });
});

describe("resolveCue on malformed cues", () => {
  for (const [name, cue] of [
    ["a misspelt field", { word: "lampo", ofset: 1 }],
    ["two kinds in one object", { word: "lampo", line: 2 }],
    ["n of zero", { word: "lampo", n: 0 }],
    ["a lone star", "*"],
    ["a star inside the word", "te*rr"],
    ["negative seconds", -1],
    ["an empty string", ""],
    ["a word with nothing to match", "?!"],
  ]) {
    it(`refuses ${name}`, () => assert.equal(code(cue), "invalid-cue"));
  }

  it("throws on a scope the compiler got wrong", () => {
    assert.throws(() => resolveCue("lampo", { ...scope, fps: 29.97 }), TypeError);
    assert.throws(() => resolveCue("lampo", { ...scope, startSeconds: -1 }), TypeError);
  });
});

describe("resolveCues", () => {
  it("returns every frame and every problem with its path", () => {
    const result = resolveCues([
      { path: "$.blocks[3].cues.flash", cue: "lampo", scope },
      { path: "$.blocks[3].cues.house", cue: "casa", scope },
      { path: "$.blocks[3].story.phases[1].from", cue: { take: "end" }, scope },
      { path: "$.blocks[3].cues.freeze", cue: { word: "lampo", ofset: 1 }, scope },
    ]);
    assert.deepEqual(result.frames, {
      "$.blocks[3].cues.flash": 114,
      "$.blocks[3].story.phases[1].from": 1423,
    });
    assert.deepEqual(result.problems.map((p) => [p.code, p.path]), [
      ["unknown-word", "$.blocks[3].cues.house"],
      ["invalid-cue", "$.blocks[3].cues.freeze"],
    ]);
  });
});
