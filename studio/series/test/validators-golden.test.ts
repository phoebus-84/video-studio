// Every released validator version gives, on each of its golden cases, the
// findings it was released with — code, severity and path, in order. A case
// starts from its compiler fixture's golden timeline, may change the compile
// input (`setInput`, then recompiled) and edits the timeline (`set`), as a
// person editing by hand would. Messages are not part of the golden.

import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checkSeries, compileSpec, listValidators, VALIDATORS, type EditTimeline } from "../src/index.js";
import { setPath } from "./json-path.js";

const fixtures = join(import.meta.dirname, "..", "fixtures");

interface Case {
  name: string;
  setInput?: { path: string; value: unknown }[];
  set: { path: string; value: unknown }[];
  expect: { code: string; severity: string; path: string }[];
}

for (const { id, version } of listValidators()) {
  const file = join(fixtures, "validators", id, version, "cases.json");
  test(`${id}@${version} (validator) has golden cases`, () => {
    assert.ok(existsSync(file), `fixtures/validators/${id}/${version}/cases.json is missing: every released validator has one`);
  });
  if (!existsSync(file)) continue;
  const golden = JSON.parse(readFileSync(file, "utf-8")) as { compiler: { id: string; version: string }; cases: Case[] };
  const compilerDir = join(fixtures, golden.compiler.id, golden.compiler.version);

  for (const c of golden.cases) {
    test(`${id}@${version} (validator): ${c.name}`, () => {
      const input = JSON.parse(readFileSync(join(compilerDir, "input.json"), "utf-8"));
      let compiled: EditTimeline = JSON.parse(readFileSync(join(compilerDir, "expected-timeline.json"), "utf-8"));
      if (c.setInput && c.setInput.length > 0) {
        for (const { path, value } of c.setInput) setPath(input, path, value);
        const result = compileSpec(input);
        assert.ok(result.ok, JSON.stringify(!result.ok && result.problems));
        compiled = result.timeline;
      }
      const timeline = structuredClone(compiled);
      for (const { path, value } of c.set) setPath(timeline, path, value);
      input.template.validator = { id, version };

      const result = checkSeries({ ...input, timeline, compiled });
      assert.equal(result.validator, `${id}@${version}`);
      assert.deepEqual(
        result.findings.map((f) => ({ code: f.code, severity: f.severity, path: f.path })),
        c.expect,
        `${id}@${version} no longer gives the findings it was released with: add src/validators/${id}/<next>.ts instead of changing this version`,
      );
    });
  }
}

test("validator ids and versions are well formed and unique", () => {
  const seen = new Set<string>();
  for (const v of VALIDATORS) {
    assert.match(v.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.match(v.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
    assert.ok(v.description.trim().length > 0);
    assert.ok(!seen.has(`${v.id}@${v.version}`), `${v.id}@${v.version} registered twice`);
    seen.add(`${v.id}@${v.version}`);
  }
});
