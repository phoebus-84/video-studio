#!/usr/bin/env node

/**
 * Validate gate-review fixtures.
 * Usage: node scripts/check-gate-review-fixtures.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const schema = JSON.parse(
  readFileSync(resolve(root, "schemas/v1alpha1/gate-review.schema.json"), "utf-8")
);

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(schema);
const validate = ajv.getSchema(`${schema.$id}#/$defs/GateReview`);
if (!validate) throw new Error("GateReview schema definition was not registered");

let failures = 0;

for (const fixturePath of [
  "fixtures/gate-review/valid/requested.json",
  "fixtures/gate-review/valid/approved.json",
  "fixtures/gate-review/valid/rejected.json",
]) {
  const fixture = JSON.parse(readFileSync(resolve(root, fixturePath), "utf-8"));
  if (!validate(fixture)) {
    failures++;
    console.error(`FAIL ${fixturePath} should be valid:`);
    for (const err of validate.errors ?? []) {
      console.error(`  ${err.instancePath || "/"} ${err.message}`);
    }
  } else {
    console.log(`ok   ${fixturePath}`);
  }
}

for (const fixturePath of [
  "fixtures/gate-review/invalid/approved-without-outputs.json",
  "fixtures/gate-review/invalid/approved-without-episode.json",
  "fixtures/gate-review/invalid/bad-hash.json",
  "fixtures/gate-review/invalid/human-approved-unsigned.json",
  "fixtures/gate-review/invalid/rejected-without-note.json",
]) {
  const fixture = JSON.parse(readFileSync(resolve(root, fixturePath), "utf-8"));
  if (validate(fixture)) {
    failures++;
    console.error(`FAIL ${fixturePath} should have been rejected`);
  } else {
    console.log(`ok   ${fixturePath} rejected`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} gate-review fixture check(s) failed`);
  process.exit(1);
}
console.log("\nAll gate-review fixtures check out");
