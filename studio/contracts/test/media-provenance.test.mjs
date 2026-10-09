import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderAttributions, validateMediaProvenance } from "../src/media-provenance.mjs";

const valid = JSON.parse(readFileSync(new URL("../fixtures/media-provenance/valid.json", import.meta.url), "utf-8"));

test("a provenance record names its file, licence and evidence; an unknown licence is never one", () => {
  assert.deepEqual(validateMediaProvenance(valid[0]), []);
  const unknown = structuredClone(valid[0]);
  unknown.licence.id = "unknown";
  assert.equal(validateMediaProvenance(unknown)[0].path, "$.licence.id");
});

test("ATTRIBUTIONS.md lists every file's credit, where it is verified, and its licence, in file order", () => {
  const text = renderAttributions([valid[0], valid[1]]);
  assert.equal(text, renderAttributions([valid[1], valid[0]]));
  assert.match(text, /^# Attributions\n/);
  assert.match(text, /- \*\*`assets\/images\/storm\.jpg`\*\*: «Under the Wave off Kanagawa» by Katsushika Hokusai/);
  assert.match(text, /From Art Institute of Chicago: <https:\/\/www\.artic\.edu\/artworks\/24645>/);
  assert.match(text, /Licence: Public domain \(aic:is\\_public\\_domain\)/);
  assert.match(text, /Licence: CC-BY-SA-4\.0 — <https:\/\/creativecommons\.org\/licenses\/by-sa\/4\.0\/>; credit required/);
  assert.ok(text.indexOf("images/storm") < text.indexOf("sounds/thunder"));
  assert.match(renderAttributions([]), /No archive or stock media\./);
});
