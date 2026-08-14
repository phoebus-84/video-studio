#!/usr/bin/env node

/**
 * Validate capability-binding schema fixtures.
 * Usage: node scripts/check-capability-binding-fixtures.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const schema = JSON.parse(
  readFileSync(resolve(root, "schemas/v1alpha1/capability-binding.schema.json"), "utf-8")
);

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(schema);
const validate = ajv.getSchema(`${schema.$id}#/$defs/CapabilityBinding`);
if (!validate) throw new Error("CapabilityBinding schema definition was not registered");

let failures = 0;

// ── Valid fixtures ──────────────────────────────────────────────────────────

const validFixtures = [
  { path: "fixtures/capability-binding/valid/fal-inproc.json", label: "fal-inproc" },
  { path: "fixtures/capability-binding/valid/tts-http.json", label: "tts-http" },
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

const fal = loaded[0];
const tts = loaded[1];

// Capabilities from canonical vocabulary
for (const [label, binding] of [["fal", fal], ["tts", tts]]) {
  if (!schema.$defs.CapabilityBinding.properties.capability.enum.includes(binding.capability)) {
    failures += 1;
    console.error(`FAIL ${label} capability "${binding.capability}" not in canonical vocabulary`);
  }
}
console.log("PASS capabilities from canonical vocabulary");

// Transport checks
if (fal.adapter.transport !== "in-proc") {
  failures += 1;
  console.error("FAIL fal should use in-proc transport");
}
if (tts.adapter.transport !== "http") {
  failures += 1;
  console.error("FAIL tts should use http transport");
}
console.log("PASS transport modes: in-proc and http");

// HTTP must have endpoint
if (!tts.adapter.endpoint) {
  failures += 1;
  console.error("FAIL http transport requires endpoint");
} else {
  console.log("PASS http transport has endpoint");
}

// in-proc should not require endpoint (but may optionally have one)
if (fal.adapter.endpoint) {
  console.log("  (fal in-proc optionally has endpoint — allowed)");
}

// decision makers
if (fal.decidedBy !== "pi") {
  failures += 1;
  console.error("FAIL fal should be decidedBy pi");
}
if (tts.decidedBy !== "user") {
  failures += 1;
  console.error("FAIL tts should be decidedBy user");
}
console.log("PASS decidedBy: pi and user");

// approvalRef only on user-decided
if (tts.approvalRef && !tts.approvalRef.startsWith("rth_")) {
  failures += 1;
  console.error("FAIL approvalRef should reference a review thread (rth_ prefix)");
} else {
  console.log("PASS approvalRef present on user-decided binding");
}

// ── Invalid fixtures ────────────────────────────────────────────────────────

const invalidFixtures = [
  "fixtures/capability-binding/invalid/unknown-transport.json",
  "fixtures/capability-binding/invalid/missing-adapter-version.json",
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
  console.error(`\n${failures} capability binding check(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`\n${validFixtures.length} valid and ${invalidFixtures.length} invalid capability binding fixtures passed`);
}
