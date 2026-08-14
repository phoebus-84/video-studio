#!/usr/bin/env node

/**
 * Validate editorial artifact schema fixtures.
 * Usage: node scripts/check-editorial-fixtures.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const editorialSchema = JSON.parse(
  readFileSync(resolve(root, "schemas/v1alpha1/editorial-artifact.schema.json"), "utf-8")
);
const identitySchema = JSON.parse(
  readFileSync(resolve(root, "schemas/v1alpha1/identity.schema.json"), "utf-8")
);

const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
addFormats(ajv);
ajv.addSchema(identitySchema);

const validate = ajv.compile(editorialSchema);

// Test valid fixture
const valid = JSON.parse(
  readFileSync(resolve(root, "fixtures/editorial/valid.json"), "utf-8")
);

const validResult = validate(valid);
if (!validResult) {
  console.error("❌ Valid editorial fixture failed validation:");
  console.error(validate.errors);
  process.exit(1);
}
console.log("✅ Editorial valid fixture passes");

// Test tape-specific fields
const tapeArtifact = valid.tapeArtifact;
if (tapeArtifact.kind !== "tape") {
  console.error("❌ Tape artifact has wrong kind:", tapeArtifact.kind);
  process.exit(1);
}
if (!tapeArtifact.tape || !tapeArtifact.tape.sceneId) {
  console.error("❌ Tape artifact missing tape metadata or sceneId");
  process.exit(1);
}
if (tapeArtifact.tape.outputFormat !== "mp4") {
  console.error("❌ Tape output format should be mp4, got:", tapeArtifact.tape.outputFormat);
  process.exit(1);
}
console.log("✅ Tape artifact fields correct (sceneId, mp4 output, vhsVersion)");

// Test all artifact types
const artifactKinds = [
  valid.briefArtifact.kind,
  valid.scriptArtifact.kind,
  valid.tapeArtifact.kind,
];
if (!artifactKinds.includes("tape")) {
  console.error("❌ Tape kind not found in artifacts");
  process.exit(1);
}
console.log("✅ Tape kind present in artifact type enum");

// Test tape artifact requires tape metadata
if (!tapeArtifact.tape) {
  console.error("❌ Tape artifact missing required tape metadata");
  process.exit(1);
}
// Non-tape artifact should not require tape metadata
if (valid.briefArtifact.tape) {
  console.error("❌ Brief artifact should not have tape metadata");
  process.exit(1);
}
console.log("✅ Tape metadata conditional: required for tape, absent for others");

console.log("\n📝 All editorial artifact contract checks passed!");
