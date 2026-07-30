#!/usr/bin/env node

/**
 * Validate pipeline manifest schema fixtures.
 * Usage: node scripts/check-pipeline-fixtures.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const schema = JSON.parse(
  readFileSync(resolve(root, "schemas/v1alpha1/pipeline-manifest.schema.json"), "utf-8")
);

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(schema);
const validate = ajv.getSchema(`${schema.$id}#/$defs/PipelineManifest`);
if (!validate) throw new Error("PipelineManifest schema definition was not registered");

// ── Valid fixture ───────────────────────────────────────────────────────────

const valid = JSON.parse(
  readFileSync(resolve(root, "fixtures/pipeline/valid/fairy-tale.yaml.json"), "utf-8")
);

const validResult = validate(valid);
if (!validResult) {
  console.error("FAIL valid fairy-tale.yaml.json:");
  console.error(ajv.errorsText(validate.errors));
  process.exit(1);
}
console.log("PASS valid fairy-tale.yaml.json");

// ── Verify stage types in the valid fixture ─────────────────────────────────

const stages = valid.pipeline.stages;
const hasEditorial = stages.some((s) => s.type === "editorial");
const hasCapability = stages.some((s) => s.type === "capability");
if (!hasEditorial || !hasCapability) {
  console.error("FAIL valid fixture must contain at least one editorial and one capability stage");
  process.exit(1);
}
const editorialStages = stages.filter((s) => s.type === "editorial");
for (const s of editorialStages) {
  if (s.capability !== undefined) {
    console.error(`FAIL editorial stage '${s.id}' must not have a capability field`);
    process.exit(1);
  }
}
const capabilityStages = stages.filter((s) => s.type === "capability");
for (const s of capabilityStages) {
  if (!s.capability) {
    console.error(`FAIL capability stage '${s.id}' must have a capability field`);
    process.exit(1);
  }
}
console.log("PASS stage types: editorial and capability stages present and correct");

// ── Invalid fixtures ────────────────────────────────────────────────────────

const invalidFixtures = [
  "fixtures/pipeline/invalid/capability-stage-missing-capability.json",
  "fixtures/pipeline/invalid/editorial-stage-with-capability.json",
  "fixtures/pipeline/invalid/missing-stage-type.json",
];

let failures = 0;

for (const fixturePath of invalidFixtures) {
  const fixture = JSON.parse(readFileSync(resolve(root, fixturePath), "utf-8"));
  const result = validate(fixture);
  if (result) {
    failures += 1;
    console.error(`FAIL ${fixturePath} was accepted but should be rejected`);
  } else {
    console.log(`PASS ${fixturePath} correctly rejected`);
  }
}

// ── Additional shape checks ─────────────────────────────────────────────────

// verify the valid fixture's extends shape
if (!valid.pipeline.extends || !valid.pipeline.extends.pipeline) {
  console.error("FAIL valid fixture extends must have a pipeline name");
  process.exit(1);
}
console.log("PASS extends shape correct");

// verify depends_on items are strings
for (const s of stages) {
  if (s.depends_on) {
    for (const dep of s.depends_on) {
      if (typeof dep !== "string") {
        console.error(`FAIL depends_on item '${dep}' in stage '${s.id}' is not a string`);
        process.exit(1);
      }
    }
  }
}
console.log("PASS depends_on items are all strings");

// verify capabilities declared at pipeline level
if (!valid.pipeline.capabilities || valid.pipeline.capabilities.length === 0) {
  console.error("FAIL valid fixture must declare pipeline-level capabilities");
  process.exit(1);
}
console.log("PASS pipeline capabilities declared");

// ── Report ──────────────────────────────────────────────────────────────────

if (failures) {
  console.error(`\n${failures} invalid pipeline fixture(s) were incorrectly accepted`);
  process.exitCode = 1;
} else {
  console.log(`\n1 valid and ${invalidFixtures.length} invalid pipeline fixtures passed`);
}
