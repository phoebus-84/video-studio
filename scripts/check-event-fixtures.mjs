#!/usr/bin/env node

/**
 * Validate journal event schema fixtures.
 * Usage: node scripts/check-event-fixtures.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const schema = JSON.parse(
  readFileSync(resolve(root, "schemas/v1alpha1/journal-event.schema.json"), "utf-8")
);

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(schema);
const validate = ajv.getSchema(`${schema.$id}#/$defs/JournalEvent`);
if (!validate) throw new Error("JournalEvent schema definition was not registered");

let failures = 0;

// ── Valid fixtures ──────────────────────────────────────────────────────────

const validFixtures = [
  "fixtures/event/valid/stage-started.json",
  "fixtures/event/valid/artifact-created.json",
  "fixtures/event/valid/approval-requested.json",
  "fixtures/event/valid/deliverable-changed.json",
];

for (const fixturePath of validFixtures) {
  const fixture = JSON.parse(readFileSync(resolve(root, fixturePath), "utf-8"));
  if (!validate(fixture)) {
    failures += 1;
    console.error(`FAIL valid ${fixturePath}: ${ajv.errorsText(validate.errors)}`);
  } else {
    console.log(`PASS valid ${fixturePath}`);
  }
}

// ── Invalid fixtures ────────────────────────────────────────────────────────

const invalidFixtures = [
  "fixtures/event/invalid/unknown-type.json",
  "fixtures/event/invalid/missing-actor.json",
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

// ── Runtime event type coverage check ───────────────────────────────────────
// Every event type written by video-pipeline-runtime/src/journal/types.ts
// must be representable in the schema's EventType enum.

const runtimeEventTypes = [
  "episode.created",
  "episode.status_changed",
  "stage.started",
  "stage.completed",
  "stage.failed",
  "artifact.created",
  "artifact.updated",
  "budget.updated",
  "review.created",
  "review.resolved",
  "settings.changed",
  "snapshot.created",
];

const schemaEventTypes = new Set(schema.$defs.EventType.enum);

const uncovered = runtimeEventTypes.filter((t) => !schemaEventTypes.has(t));
if (uncovered.length > 0) {
  failures += 1;
  console.error("FAIL runtime event types not covered by schema enum:", uncovered);
} else {
  console.log(`PASS all ${runtimeEventTypes.length} runtime event types covered by schema enum`);
}

// ── Verify all enum values ──────────────────────────────────────────────────

const knownTypes = schema.$defs.EventType.enum;
if (knownTypes.length < 24) {
  failures += 1;
  console.error(`FAIL EventType enum has ${knownTypes.length} values, expected at least 24`);
} else {
  console.log(`PASS EventType enum has ${knownTypes.length} values`);
}

// Must include the canonical hyphenated types
const canonicalTypes = [
  "stage-leased", "stage-started", "stage-completed", "stage-failed",
  "attempt-recorded", "approval-granted", "approval-requested", "comment-added",
  "artifact-written", "staleness-marked", "supersession-recorded",
  "deliverable-current-changed",
];
const missingCanonical = canonicalTypes.filter((t) => !schemaEventTypes.has(t));
if (missingCanonical.length > 0) {
  failures += 1;
  console.error("FAIL canonical event types missing from schema:", missingCanonical);
} else {
  console.log(`PASS all ${canonicalTypes.length} canonical event types present`);
}

// ── Report ──────────────────────────────────────────────────────────────────

if (failures) {
  console.error(`\n${failures} event fixture check(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`\n${validFixtures.length} valid and ${invalidFixtures.length} invalid event fixtures passed`);
}
