#!/usr/bin/env node

/**
 * Validate media-provenance fixtures: every record in fixtures/media-provenance/valid.json is
 * accepted, every one in invalid.json refused.
 * Usage: node scripts/check-media-provenance-fixtures.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { validateMediaProvenance } from "../src/media-provenance.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => JSON.parse(readFileSync(resolve(root, rel), "utf-8"));
const valid = read("fixtures/media-provenance/valid.json");
const invalid = read("fixtures/media-provenance/invalid.json");
let failures = 0;

valid.forEach((record, i) => {
  const problems = validateMediaProvenance(record);
  if (problems.length > 0) {
    failures += 1;
    console.error(`FAIL valid record ${i}:`, problems.map((p) => `${p.path} ${p.message}`).join("; "));
  }
});
invalid.forEach((record, i) => {
  if (validateMediaProvenance(record).length === 0) {
    failures += 1;
    console.error(`FAIL invalid record ${i} was accepted`);
  }
});

if (failures) {
  console.error(`\n${failures} media-provenance check(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`${valid.length} valid and ${invalid.length} invalid media-provenance fixtures passed`);
}
