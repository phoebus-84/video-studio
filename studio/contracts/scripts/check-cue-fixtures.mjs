#!/usr/bin/env node

/**
 * Validate cue fixtures against the Cue definition: every value in
 * fixtures/cue/valid.json must be accepted, every value in invalid.json refused.
 * Usage: node scripts/check-cue-fixtures.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => JSON.parse(readFileSync(resolve(root, rel), "utf-8"));
const schema = read("schemas/v1alpha1/cue.schema.json");
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(schema);
const validate = ajv.getSchema(`${schema.$id}#/$defs/Cue`);
if (!validate) throw new Error("Cue schema definition was not registered");

const valid = read("fixtures/cue/valid.json");
const invalid = read("fixtures/cue/invalid.json");
let failures = 0;

for (const cue of valid) {
  if (!validate(cue)) {
    failures += 1;
    console.error(`FAIL valid cue ${JSON.stringify(cue)}: ${ajv.errorsText(validate.errors)}`);
  }
}
for (const cue of invalid) {
  if (validate(cue)) {
    failures += 1;
    console.error(`FAIL invalid cue ${JSON.stringify(cue)} was accepted`);
  }
}

if (failures) {
  console.error(`\n${failures} cue check(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`${valid.length} valid and ${invalid.length} invalid cue fixtures passed`);
}
