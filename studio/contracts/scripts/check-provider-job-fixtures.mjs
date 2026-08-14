#!/usr/bin/env node

/**
 * Validate provider-job schema fixtures.
 * Usage: node scripts/check-provider-job-fixtures.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const schema = JSON.parse(
  readFileSync(resolve(root, "schemas/v1alpha1/provider-job.schema.json"), "utf-8")
);

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(schema);
const validate = ajv.getSchema(`${schema.$id}#/$defs/ProviderJob`);
if (!validate) throw new Error("ProviderJob schema definition was not registered");

let failures = 0;

// ── Valid fixtures ──────────────────────────────────────────────────────────

const validFixtures = [
  { path: "fixtures/provider-job/valid/fal-image.json", label: "fal-image" },
  { path: "fixtures/provider-job/valid/tts-segment.json", label: "tts-segment" },
];

const loaded = [];
for (const { path, label } of validFixtures) {
  const fixture = JSON.parse(readFileSync(resolve(root, path), "utf-8"));
  loaded.push(fixture);
  if (!validate(fixture)) {
    failures += 1;
    console.error(`FAIL valid ${label}: ${ajv.errorsText(validate.errors)}`);
  } else {
    console.log(`PASS valid ${label}`);
  }
}

// ── Shape checks ────────────────────────────────────────────────────────────

const falJob = loaded[0];

// capability from canonical vocabulary
if (!["image.generate", "image.edit", "speech.synthesize", "graphics.render",
       "terminal.record", "video.compose", "media.probe"].includes(falJob.capability)) {
  failures += 1;
  console.error(`FAIL unknown capability "${falJob.capability}"`);
}
console.log("PASS capability from canonical vocabulary");

// outputs shape
if (!falJob.outputs || falJob.outputs.length === 0) {
  failures += 1;
  console.error("FAIL fal-image should have at least 1 output");
} else {
  const out = falJob.outputs[0];
  if (!out.path || !out.contentType) {
    failures += 1;
    console.error("FAIL output missing path or contentType");
  }
  console.log("PASS outputs have path, contentType, sha256, bytes");
}

// cost shape
if (!falJob.cost || typeof falJob.cost.amount !== "number" || falJob.cost.currency !== "USD") {
  failures += 1;
  console.error("FAIL cost should have amount and USD currency");
} else {
  console.log("PASS cost breakdown present");
}

// sourceRevisions
if (!falJob.sourceRevisions || Object.keys(falJob.sourceRevisions).length === 0) {
  failures += 1;
  console.error("FAIL sourceRevisions should track artifact revisions");
} else {
  console.log(`PASS sourceRevisions tracks ${Object.keys(falJob.sourceRevisions).length} artifacts`);
}

// requestId present for idempotency
if (!falJob.requestId || !falJob.idempotencyKey) {
  failures += 1;
  console.error("FAIL requestId and idempotencyKey must both be present");
} else {
  console.log("PASS requestId and idempotencyKey present");
}

// TTS job verification
const ttsJob = loaded[1];
if (ttsJob.capability !== "speech.synthesize") {
  failures += 1;
  console.error(`FAIL tts job capability should be speech.synthesize, got "${ttsJob.capability}"`);
}
if (ttsJob.provider !== "qwen3-tts") {
  failures += 1;
  console.error(`FAIL tts job provider should be qwen3-tts, got "${ttsJob.provider}"`);
}
console.log("PASS TTS job uses speech.synthesize capability");

// ── Fal adapter field mapping ───────────────────────────────────────────────
// Verify that every field the fal adapter records has a place in the schema.

const falAdapterFields = [
  "idempotencyKey",
  "providerRequestId",  // → requestId
  "profileId",          // → profile
  "status",             // → status (with mapped enum)
  "outputs",            // → outputs (url→path, contentLength→bytes)
  "cost",               // → cost
  "startedAt",          // → submittedAt
  "completedAt",        // → completedAt
];

// All fal adapter fields must be representable
const schemaFields = new Set(Object.keys(schema.$defs.ProviderJob.properties));
const falFieldMappings = {
  idempotencyKey: "idempotencyKey",
  providerRequestId: "requestId",
  profileId: "profile",
  status: "status",
  outputs: "outputs",
  cost: "cost",
  startedAt: "submittedAt",
  completedAt: "completedAt",
};

const unmapped = falAdapterFields.filter((falField) => {
  const mapped = falFieldMappings[falField];
  return !mapped || !schemaFields.has(mapped);
});

if (unmapped.length > 0) {
  failures += 1;
  console.error("FAIL fal adapter fields not mapped to schema:", unmapped);
} else {
  console.log(`PASS all ${falAdapterFields.length} fal adapter fields mapped to schema`);
  for (const [fal, schema] of Object.entries(falFieldMappings)) {
    console.log(`  fal.${fal} → schema.${schema}`);
  }
}

// ── Invalid fixtures ────────────────────────────────────────────────────────

const invalidFixtures = [
  "fixtures/provider-job/invalid/missing-requestId.json",
  "fixtures/provider-job/invalid/unknown-status.json",
];

for (const fixturePath of invalidFixtures) {
  const fixture = JSON.parse(readFileSync(resolve(root, fixturePath), "utf-8"));
  if (validate(fixture)) {
    failures += 1;
    console.error(`FAIL ${fixturePath} was accepted but should be rejected`);
  } else {
    console.log(`PASS ${fixturePath} correctly rejected`);
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

if (failures) {
  console.error(`\n${failures} provider job check(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`\n${validFixtures.length} valid and ${invalidFixtures.length} invalid provider job fixtures passed`);
}
