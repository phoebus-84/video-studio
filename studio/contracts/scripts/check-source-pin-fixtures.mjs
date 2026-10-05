#!/usr/bin/env node

/**
 * Validate source-pin fixtures: every pin in fixtures/source-pin/valid.json is
 * accepted, every one in invalid.json refused.
 * Usage: node scripts/check-source-pin-fixtures.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { validateSourcePin } from "../src/source-pins.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => JSON.parse(readFileSync(resolve(root, rel), "utf-8"));
const valid = read("fixtures/source-pin/valid.json");
const invalid = read("fixtures/source-pin/invalid.json");
let failures = 0;

valid.forEach((pin, i) => {
  const problems = validateSourcePin(pin);
  if (problems.length > 0) {
    failures += 1;
    console.error(`FAIL valid pin ${i}:`, problems.map((p) => `${p.path} ${p.message}`).join("; "));
  }
});
invalid.forEach((pin, i) => {
  if (validateSourcePin(pin).length === 0) {
    failures += 1;
    console.error(`FAIL invalid pin ${i} was accepted`);
  }
});

if (failures) {
  console.error(`\n${failures} source-pin check(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`${valid.length} valid and ${invalid.length} invalid source-pin fixtures passed`);
}
