// A release that runs its own compiler and validator (avg-d1x): compileSpec and
// checkSeries take them from the input's `code` when the manifest names a
// bundle, and say so when they are missing or are not what it names.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checkSeries, compileSpec, resolveCompiler, resolveValidator, type CompileInput } from "../src/index.js";

const load = (): CompileInput => JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "poetry-short", "1.0.0", "input.json"), "utf-8"));
const BUNDLE = { path: "compiler/compiler.cjs", hash: `sha256:${"a".repeat(64)}` };

/** The fixture's release, naming its own compiler and validator bundles. */
function withBundles(): CompileInput {
  const input = load();
  input.template = {
    ...input.template,
    compiler: { ...input.template.compiler, bundle: BUNDLE },
    validator: { ...input.template.validator!, bundle: { path: "validator/validator.cjs", hash: BUNDLE.hash } },
  };
  return input;
}

test("a release naming a bundle compiles with the code it was handed, not the registry's", () => {
  const registered = resolveCompiler("poetry-short", "1.0.0")!;
  let called = 0;
  const input = withBundles();
  input.code = { compiler: { ...registered, compile: (i) => { called++; return registered.compile(i); } } };
  const result = compileSpec(input);
  assert.ok(result.ok, JSON.stringify(!result.ok && result.problems));
  assert.equal(called, 1);
});

test("a release naming a bundle refuses to compile without it, or with code of another version", () => {
  const missing = compileSpec(withBundles());
  assert.deepEqual(!missing.ok && missing.problems.map((p) => [p.code, p.path]), [["missing-code", "$.template.compiler.bundle"]]);

  const input = withBundles();
  input.code = { compiler: { ...resolveCompiler("poetry-short", "1.0.0")!, version: "1.0.1" } };
  const other = compileSpec(input);
  assert.deepEqual(!other.ok && other.problems.map((p) => p.code), ["code-mismatch"]);
});

test("the series check runs the release's own validator, and is an error without it", () => {
  const input = withBundles();
  input.code = { compiler: resolveCompiler("poetry-short", "1.0.0")! };
  const compiled = compileSpec(input);
  assert.ok(compiled.ok);
  const without = checkSeries({ ...input, compiled: compiled.timeline, timeline: compiled.timeline });
  assert.deepEqual(without.findings.map((f) => [f.code, f.severity]), [["missing-code", "error"]]);

  let called = 0;
  const validator = resolveValidator("poetry-short", "1.0.0")!;
  input.code.validator = { ...validator, validate: (i) => { called++; return validator.validate(i); } };
  const checked = checkSeries({ ...input, compiled: compiled.timeline, timeline: compiled.timeline });
  assert.equal(checked.validator, "poetry-short@1.0.0");
  assert.equal(called, 1);
});
