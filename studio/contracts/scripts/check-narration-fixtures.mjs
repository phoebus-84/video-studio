#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const narration = JSON.parse(readFileSync(resolve(root, "schemas/v1alpha1/narration.schema.json"), "utf8"));
const identity = JSON.parse(readFileSync(resolve(root, "schemas/v1alpha1/identity.schema.json"), "utf8"));
const fixture = JSON.parse(readFileSync(resolve(root, "fixtures/narration/valid.json"), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
addFormats(ajv);
ajv.addSchema(identity);
const validate = ajv.compile(narration);
if (!validate(fixture)) {
  console.error(validate.errors);
  process.exit(1);
}
if (fixture.attempt.phase !== "completed" || !fixture.attempt.rawWav || fixture.attempt.failure) {
  throw new Error("completed narration attempt outcome is inconsistent");
}
if (fixture.quality.attemptId !== fixture.attempt.attemptId) {
  throw new Error("quality report does not reference attempt");
}
const entry = fixture.manifest.entries[0];
if (entry.acceptedAttemptId !== fixture.attempt.attemptId || entry.qualityReportId !== fixture.quality.reportId) {
  throw new Error("manifest provenance does not reference accepted evidence");
}
if (fixture.manifest.captions[0].endSeconds > fixture.manifest.finalWav.durationSeconds) {
  throw new Error("caption exceeds measured final WAV");
}
if (fixture.legacy.duration_sec !== 1) {
  throw new Error("legacy compatibility fixture not loaded");
}
console.log("✅ Narration segment/attempt/quality/manifest and legacy compatibility fixtures pass");
