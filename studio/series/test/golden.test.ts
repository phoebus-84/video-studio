// Every released compiler version compiles its fixture to the timeline it
// was released with, byte for byte. A difference means the version's
// behaviour changed — in its own file or in a contract helper it calls —
// and an episode pinned to it would silently re-render differently.

import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { COMPILERS, compileSpec, listCompilers } from "../src/index.js";

const fixtures = join(import.meta.dirname, "..", "fixtures");

for (const { id, version } of listCompilers()) {
  test(`${id}@${version} compiles its fixture to its golden timeline`, () => {
    const dir = join(fixtures, id, version);
    assert.ok(existsSync(join(dir, "input.json")), `fixtures/${id}/${version}/input.json is missing: every released version has one`);
    assert.ok(existsSync(join(dir, "expected-timeline.json")), `fixtures/${id}/${version}/expected-timeline.json is missing: run scripts/golden.ts ${id} ${version}`);
    const input = JSON.parse(readFileSync(join(dir, "input.json"), "utf-8"));
    assert.equal(input.template.compiler.id, id);
    assert.equal(input.template.compiler.version, version);

    const result = compileSpec(input);
    assert.ok(result.ok, JSON.stringify(!result.ok && result.problems));
    const expected = readFileSync(join(dir, "expected-timeline.json"), "utf-8");
    assert.equal(
      `${JSON.stringify(result.timeline, null, 2)}\n`,
      expected,
      `${id}@${version} no longer compiles its fixture as released: add src/compilers/${id}/<next>.ts instead of changing this version`,
    );
  });
}

test("compiling is deterministic", () => {
  const input = JSON.parse(readFileSync(join(fixtures, "poetry-short", "1.0.0", "input.json"), "utf-8"));
  assert.deepEqual(compileSpec(structuredClone(input)), compileSpec(structuredClone(input)));
});

test("compiling does not change its input", () => {
  const input = JSON.parse(readFileSync(join(fixtures, "poetry-short", "1.0.0", "input.json"), "utf-8"));
  const before = structuredClone(input);
  compileSpec(input);
  assert.deepEqual(input, before);
});

test("ids and versions are well formed and unique", () => {
  const seen = new Set<string>();
  for (const c of COMPILERS) {
    assert.match(c.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.match(c.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
    assert.ok(c.description.trim().length > 0);
    assert.ok(!seen.has(`${c.id}@${c.version}`), `${c.id}@${c.version} registered twice`);
    seen.add(`${c.id}@${c.version}`);
  }
});
