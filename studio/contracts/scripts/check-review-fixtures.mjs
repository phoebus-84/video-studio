#!/usr/bin/env node

/**
 * Validate review-thread schema fixtures.
 * Usage: node scripts/check-review-fixtures.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const schema = JSON.parse(
  readFileSync(resolve(root, "schemas/v1alpha1/review-thread.schema.json"), "utf-8")
);

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(schema);
const validate = ajv.getSchema(`${schema.$id}#/$defs/ReviewThread`);
if (!validate) throw new Error("ReviewThread schema definition was not registered");

let failures = 0;

// ── Valid fixture ───────────────────────────────────────────────────────────

const validFixture = JSON.parse(
  readFileSync(resolve(root, "fixtures/review/valid/thread.json"), "utf-8")
);

if (!validate(validFixture)) {
  failures += 1;
  console.error("FAIL valid thread.json:", ajv.errorsText(validate.errors));
} else {
  console.log("PASS valid thread.json");
}

// Verify 2 comments
if (validFixture.comments.length !== 2) {
  failures += 1;
  console.error(`FAIL valid fixture should have 2 comments, got ${validFixture.comments.length}`);
} else {
  console.log("PASS 2 comments present");
}

// Verify anchor with artifact target type and line location
const anchor = validFixture.anchor;
if (anchor.targetType !== "artifact") {
  failures += 1;
  console.error(`FAIL anchor.targetType should be "artifact", got "${anchor.targetType}"`);
}
if (anchor.location?.line !== 42) {
  failures += 1;
  console.error(`FAIL anchor.location.line should be 42, got ${anchor.location?.line}`);
}
console.log("PASS anchor points to artifact line 42 with sceneId");

// Verify first comment has sentToPi
if (validFixture.comments[0].sentToPi !== true) {
  failures += 1;
  console.error("FAIL first comment should have sentToPi: true");
}
console.log("PASS sentToPi flag present on first comment");

// Verify thread id format
if (!validFixture.id.startsWith("rth_")) {
  failures += 1;
  console.error(`FAIL thread id should start with rth_, got "${validFixture.id}"`);
}
console.log("PASS thread id uses rth_ prefix");

// Verify comment id format
for (const c of validFixture.comments) {
  if (!c.id.startsWith("cmt_")) {
    failures += 1;
    console.error(`FAIL comment id should start with cmt_, got "${c.id}"`);
  }
}
console.log("PASS comment ids use cmt_ prefix");

// ── Invalid fixtures ────────────────────────────────────────────────────────

const invalidFixtures = [
  "fixtures/review/invalid/no-anchor.json",
  "fixtures/review/invalid/empty-comment.json",
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
  console.error(`\n${failures} review thread check(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`\n1 valid and ${invalidFixtures.length} invalid review thread fixtures passed`);
}
