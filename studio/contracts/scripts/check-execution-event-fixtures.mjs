#!/usr/bin/env node

/**
 * Validate execution-event fixtures.
 * Usage: node scripts/check-execution-event-fixtures.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const schema = JSON.parse(
  readFileSync(resolve(root, "schemas/v1alpha1/execution-event.schema.json"), "utf-8")
);

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(schema);

let failures = 0;

// Test valid fixtures
const validFixtures = [
  { path: "fixtures/execution-event/valid/stage-leased.json", def: "StageLeased" },
  { path: "fixtures/execution-event/valid/stage-completed.json", def: "StageCompleted" },
  { path: "fixtures/execution-event/valid/stage-completed-candidate.json", def: "StageCompleted" },
  { path: "fixtures/execution-event/valid/take-selected.json", def: "TakeSelected" },
  { path: "fixtures/execution-event/valid/spend-reserved.json", def: "SpendReserved" },
  { path: "fixtures/execution-event/valid/spend-settled.json", def: "SpendSettled" },
  { path: "fixtures/execution-event/valid/spend-released.json", def: "SpendReleased" },
];

for (const { path, def } of validFixtures) {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/${def}`);
  if (!validate) throw new Error(`${def} schema definition was not registered`);

  const fixture = JSON.parse(readFileSync(resolve(root, path), "utf-8"));
  if (!validate(fixture)) {
    failures++;
    console.error(`FAIL ${path} should be valid:`);
    for (const err of validate.errors ?? []) {
      console.error(`  ${err.instancePath || "/"} ${err.message}`);
    }
  } else {
    console.log(`ok   ${path}`);
  }
}

// Test invalid fixtures
const invalidFixtures = [
  { path: "fixtures/execution-event/invalid/leased-without-lease.json", def: "StageLeased" },
  { path: "fixtures/execution-event/invalid/negative-attempt.json", def: "StageStarted" },
  { path: "fixtures/execution-event/invalid/take-selected-without-hashes.json", def: "TakeSelected" },
  { path: "fixtures/execution-event/invalid/spend-reserved-fractional-micros.json", def: "SpendReserved" },
];

for (const { path, def } of invalidFixtures) {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/${def}`);
  if (!validate) throw new Error(`${def} schema definition was not registered`);

  const fixture = JSON.parse(readFileSync(resolve(root, path), "utf-8"));
  if (validate(fixture)) {
    failures++;
    console.error(`FAIL ${path} should have been rejected`);
  } else {
    console.log(`ok   ${path} rejected`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} execution-event fixture check(s) failed`);
  process.exit(1);
}
console.log("\nAll execution-event fixtures check out");
