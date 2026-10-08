// What dentro-i-versi-short@1.1.0 changes from 1.0.0 (avg-z7f): the timeline
// says it loops — the FORMAT's first and last frames are the empty hall with
// the title — so the render audit checks that its last frame is its first.
// Nothing else changes.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { compileSpec } from "../src/index.js";

const load = (version: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "dentro-i-versi-short", version, "input.json"), "utf-8"));

function timeline(version: string) {
  const result = compileSpec(load(version));
  assert.ok(result.ok, JSON.stringify(!result.ok && result.problems, null, 2));
  return result.timeline as unknown as Record<string, unknown> & { loop?: boolean; derivedFrom: unknown; metadata: Record<string, unknown> };
}

test("1.1.0's timeline loops; 1.0.0's, as released, does not say so", () => {
  assert.equal(timeline("1.1.0").loop, true);
  assert.equal(timeline("1.0.0").loop, undefined);
});

test("apart from the loop and its own name, 1.1.0 compiles the episode as 1.0.0 did", () => {
  const strip = (t: ReturnType<typeof timeline>) => {
    const { loop: _loop, derivedFrom: _derivedFrom, metadata, ...rest } = t;
    const { builtBy: _builtBy, template: _template, inputs: _inputs, ...meta } = metadata;
    return { ...rest, meta };
  };
  assert.deepEqual(strip(timeline("1.1.0")), strip(timeline("1.0.0")));
});
