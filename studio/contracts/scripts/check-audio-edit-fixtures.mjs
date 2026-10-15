#!/usr/bin/env node

/**
 * Validate audio-edit fixtures: every record in fixtures/audio-edit/valid.json is
 * accepted, every one in invalid.json refused.
 * Usage: node scripts/check-audio-edit-fixtures.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { validateAudioEdit } from "../src/audio-edits.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => JSON.parse(readFileSync(resolve(root, rel), "utf-8"));
const valid = read("fixtures/audio-edit/valid.json");
const invalid = read("fixtures/audio-edit/invalid.json");
let failures = 0;

valid.forEach((record, i) => {
  const problems = validateAudioEdit(record);
  if (problems.length > 0) {
    failures += 1;
    console.error(`FAIL valid record ${i}:`, problems.map((p) => `${p.path} ${p.message}`).join("; "));
  }
});
invalid.forEach((record, i) => {
  if (validateAudioEdit(record).length === 0) {
    failures += 1;
    console.error(`FAIL invalid record ${i} was accepted`);
  }
});

if (failures) {
  console.error(`\n${failures} audio-edit check(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`${valid.length} valid and ${invalid.length} invalid audio-edit fixtures passed`);
}
