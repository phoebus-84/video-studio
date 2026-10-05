#!/usr/bin/env node

/**
 * Validate word-timing fixtures: every valid fixture has no problem; every
 * invalid fixture (a valid base plus a patch) fails with exactly its code.
 * Usage: node scripts/check-word-timing-fixtures.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { validateWordTiming } from "../src/word-timing.mjs";
import { applyPatch } from "./lib/json-patch.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(root, "fixtures/word-timing");
const readJson = (path) => JSON.parse(readFileSync(path, "utf-8"));
const valid = readdirSync(resolve(dir, "valid")).filter((f) => f.endsWith(".json"));
const invalid = readdirSync(resolve(dir, "invalid")).filter((f) => f.endsWith(".json"));

let failures = 0;

for (const file of valid) {
  const problems = validateWordTiming(readJson(resolve(dir, "valid", file)));
  if (problems.length > 0) {
    failures += 1;
    console.error(`FAIL valid ${file}:`, problems.map((p) => `${p.code} ${p.path}`).join("; "));
  } else {
    console.log(`PASS valid ${file}`);
  }
}

for (const file of invalid) {
  const fixture = readJson(resolve(dir, "invalid", file));
  const doc = applyPatch(readJson(resolve(dir, "valid", fixture.base)), fixture.patch);
  const found = [...new Set(validateWordTiming(doc).map((p) => p.code))];
  if (found.length !== 1 || found[0] !== fixture.expect) {
    failures += 1;
    console.error(`FAIL invalid ${file}: expected [${fixture.expect}], got [${found.join(", ")}]`);
  } else {
    console.log(`PASS invalid ${file} rejected with ${fixture.expect}`);
  }
}

if (failures) {
  console.error(`\n${failures} word-timing check(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`\n${valid.length} valid and ${invalid.length} invalid word-timing fixtures passed`);
}
