// toolbox@1.0.0 (avg-d1x, phase 3): the helpers today's compilers each carry
// a copy of, released once. Held here to those copies' behaviour, so a series
// moving to the toolbox compiles as it did.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { findWord, frames, isObject, kitsOf, lanes, noise, normalizeWord, round3, tokens } from "../src/toolbox/1.0.0.js";

test("frames, round3 and tokens", () => {
  assert.equal(frames(1.016, 30), 30);
  assert.equal(frames(1.017, 30), 31);
  assert.equal(round3(1.23456), 1.235);
  assert.deepEqual(tokens("  La nebbia\n a gl'irti   colli "), ["La", "nebbia", "a", "gl'irti", "colli"]);
});

test("normalizeWord compares as the compilers it was extracted from did", () => {
  const theirs = (s: string) => s.toLocaleLowerCase("it-IT").normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, "");
  for (const word of ["Perché,", "SPARÌ", "gl'irti", "«L’Italia»", "città."]) assert.equal(normalizeWord(word), theirs(word));
  assert.equal(normalizeWord("İstanbul", "tr-TR"), "istanbul");
});

test("noise is the compilers' deterministic noise", () => {
  const theirs = (i: number) => {
    const x = Math.sin(i * 127.1 + 11.7) * 43758.5453;
    return x - Math.floor(x);
  };
  for (const i of [0, 1, 7, 42, 1000]) assert.equal(noise(i), theirs(i));
});

test("lanes puts overlapping items on separate lanes, in time order", () => {
  const items = [{ id: "c", from: 20, duration: 10 }, { id: "a", from: 0, duration: 15 }, { id: "b", from: 10, duration: 10 }, { id: "d", from: 15, duration: 5 }];
  assert.deepEqual(lanes(items).map((l) => l.map((i) => i.id)), [["a", "d", "c"], ["b"]]);
});

test("findWord finds the nth time a word is said, by its parts around an apostrophe, and by prefix only when asked", () => {
  const words = [
    { text: "L'Italia", start: 0, end: 0.5 },
    { text: "sparì", start: 1, end: 1.3 },
    { text: "Sparì,", start: 2, end: 2.3 },
    { text: "esterrefatto", start: 3, end: 3.6 },
  ];
  assert.equal(findWord(words, "italia").word?.start, 0);
  assert.deepEqual([findWord(words, "spari", { n: 2 }).word?.start, findWord(words, "spari", { n: 2 }).found], [2, 2]);
  assert.deepEqual(findWord(words, "spari", { n: 3 }), { word: null, found: 2 });
  assert.equal(findWord(words, "esterre").word, null);
  assert.equal(findWord(words, "esterre", { prefix: true }).word?.start, 3);
  assert.deepEqual(findWord(words, "…"), { word: null, found: 0 });
});

test("isObject and kitsOf", () => {
  assert.deepEqual([isObject({}), isObject([]), isObject(null)], [true, false, false]);
  const timeline = { tracks: [
    { id: "a", type: "visual", z: 0, items: [{ kit: { name: "still", version: "1.0.0" } }, { kit: { name: "card", version: "1.0.0" } }] },
    { id: "b", type: "audio", z: 0, items: [{ assetId: "voice" }] },
    { id: "c", type: "visual", z: 1, items: [{ kit: { name: "still", version: "1.0.0" } }] },
  ] } as never;
  assert.deepEqual(kitsOf(timeline), ["card@1.0.0", "still@1.0.0"]);
});
