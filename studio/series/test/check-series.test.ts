// checkSeries: which validator runs, and what it may not do.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checkSeries, type ValidateInput } from "../src/index.js";

const DIR = join(import.meta.dirname, "..", "fixtures", "poetry-short", "1.0.0");
function load(): ValidateInput {
  const input = JSON.parse(readFileSync(join(DIR, "input.json"), "utf-8"));
  const compiled = JSON.parse(readFileSync(join(DIR, "expected-timeline.json"), "utf-8"));
  return { ...input, compiled, timeline: structuredClone(compiled) };
}

test("a template that names no validator has no series rules", () => {
  const input = load();
  delete (input.template as { validator?: unknown }).validator;
  assert.deepEqual(checkSeries(input), { validator: null, findings: [] });
});

test("unknown-validator names the versions that exist", () => {
  const input = load();
  input.template.validator = { id: "poetry-short", version: "2.0.0" };
  const result = checkSeries(input);
  assert.equal(result.validator, "poetry-short@2.0.0");
  assert.deepEqual(result.findings.map((f) => [f.code, f.severity, f.path]), [["unknown-validator", "error", "$.template.validator"]]);
  assert.match(result.findings[0]!.message, /poetry-short@2\.0\.0: available poetry-short@1\.0\.0/);
});

test("checking is deterministic and does not change its input", () => {
  const input = load();
  (input.timeline.tracks[1]!.items[0] as { props: unknown }).props = { text: "Light falls across the room.", position: "bottom", font: "Georgia" };
  const before = structuredClone(input);
  assert.deepEqual(checkSeries(structuredClone(input)), checkSeries(structuredClone(input)));
  checkSeries(input);
  assert.deepEqual(input, before);
});

test("the untouched compiled timeline passes poetry-short@1.0.0", () => {
  assert.deepEqual(checkSeries(load()), { validator: "poetry-short@1.0.0", findings: [] });
});

test("text-not-voice compares with what the compiler captioned, not the raw narration", () => {
  // A caption group shorter than a frame is dropped by the compiler: the
  // untouched compiled timeline must still pass.
  const input = load();
  const captions = (t: { tracks: { id: string; items: unknown[] }[] }) => t.tracks.find((x) => x.id === "captions")!;
  captions(input.compiled as never).items.splice(0, 1);
  captions(input.timeline as never).items.splice(0, 1);
  assert.deepEqual(checkSeries(input).findings, []);
});
