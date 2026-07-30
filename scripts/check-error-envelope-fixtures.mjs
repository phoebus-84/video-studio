#!/usr/bin/env node

/**
 * Validate error-envelope schema fixtures.
 * Usage: node scripts/check-error-envelope-fixtures.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const schema = JSON.parse(
  readFileSync(resolve(root, "schemas/v1alpha1/error-envelope.schema.json"), "utf-8")
);

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(schema);
const validate = ajv.getSchema(`${schema.$id}#/$defs/ErrorEnvelope`);
if (!validate) throw new Error("ErrorEnvelope schema definition was not registered");

let failures = 0;

// ── Valid fixtures ──────────────────────────────────────────────────────────

const validFixtures = [
  { path: "fixtures/error-envelope/valid/gateway-style.json", label: "gateway-style" },
  { path: "fixtures/error-envelope/valid/runtime-style.json", label: "runtime-style" },
];

for (const { path, label } of validFixtures) {
  const fixture = JSON.parse(readFileSync(resolve(root, path), "utf-8"));
  if (!validate(fixture)) {
    failures += 1;
    console.error(`FAIL valid ${label}: ${ajv.errorsText(validate.errors)}`);
  } else {
    console.log(`PASS valid ${label}`);
  }
}

// ── Code style checks ───────────────────────────────────────────────────────

const gateway = JSON.parse(readFileSync(resolve(root, validFixtures[0].path), "utf-8"));
const runtime = JSON.parse(readFileSync(resolve(root, validFixtures[1].path), "utf-8"));

// Gateway uses SCREAMING_SNAKE_CASE
if (!/^[A-Z][A-Z0-9]*(?:_[A-Z][A-Z0-9]*)*$/.test(gateway.error.code)) {
  failures += 1;
  console.error(`FAIL gateway-style code "${gateway.error.code}" should be SCREAMING_SNAKE_CASE`);
} else {
  console.log("PASS gateway-style code uses SCREAMING_SNAKE_CASE");
}

// Runtime uses dotted.style
if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/.test(runtime.error.code)) {
  failures += 1;
  console.error(`FAIL runtime-style code "${runtime.error.code}" should be dotted.style`);
} else {
  console.log("PASS runtime-style code uses dotted.style");
}

// Both have retryable
if (typeof gateway.error.retryable !== "boolean" || typeof runtime.error.retryable !== "boolean") {
  failures += 1;
  console.error("FAIL retryable must be a boolean");
} else {
  console.log("PASS retryable is boolean on both fixtures");
}

// Both have details
if (!gateway.error.details || !runtime.error.details) {
  failures += 1;
  console.error("FAIL both fixtures should have details");
} else {
  console.log("PASS details present on both fixtures");
}

// ── Invalid fixtures ────────────────────────────────────────────────────────

const invalidFixtures = [
  "fixtures/error-envelope/invalid/missing-code.json",
  "fixtures/error-envelope/invalid/missing-correlationId.json",
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
  console.error(`\n${failures} error envelope check(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`\n${validFixtures.length} valid and ${invalidFixtures.length} invalid error envelope fixtures passed`);
}
