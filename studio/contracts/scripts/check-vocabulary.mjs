#!/usr/bin/env node

/**
 * Validate vocabulary schema enums and src/vocabulary.mjs arrays are in sync.
 * Usage: node scripts/check-vocabulary.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { CAPABILITIES, ARTIFACT_KINDS, isCapability, isArtifactKind } from "../src/vocabulary.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const vocabSchema = JSON.parse(
  readFileSync(resolve(root, "schemas/v1alpha1/vocabulary.schema.json"), "utf-8")
);

let failures = 0;

// ── 1. Schema enum ↔ src/vocabulary.mjs array identity ──────────────────────

const schemaCapabilities = vocabSchema.$defs.Capability.enum;
const schemaArtifactKinds = vocabSchema.$defs.ArtifactKind.enum;

// Compare capabilities (order-independent)
const schemaCapSet = new Set(schemaCapabilities);
const srcCapSet = new Set(CAPABILITIES);
const capOnlyInSchema = schemaCapabilities.filter((c) => !srcCapSet.has(c));
const capOnlyInSrc = CAPABILITIES.filter((c) => !schemaCapSet.has(c));
if (capOnlyInSchema.length > 0 || capOnlyInSrc.length > 0) {
  failures += 1;
  console.error("FAIL capability vocabulary drift:");
  if (capOnlyInSchema.length) console.error("  In schema only:", capOnlyInSchema);
  if (capOnlyInSrc.length) console.error("  In src only:", capOnlyInSrc);
} else {
  console.log(`PASS capabilities: ${CAPABILITIES.length} values match between schema and src`);
}

// Compare artifact kinds (order-independent)
const schemaArtSet = new Set(schemaArtifactKinds);
const srcArtSet = new Set(ARTIFACT_KINDS);
const artOnlyInSchema = schemaArtifactKinds.filter((k) => !srcArtSet.has(k));
const artOnlyInSrc = ARTIFACT_KINDS.filter((k) => !schemaArtSet.has(k));
if (artOnlyInSchema.length > 0 || artOnlyInSrc.length > 0) {
  failures += 1;
  console.error("FAIL artifact-kind vocabulary drift:");
  if (artOnlyInSchema.length) console.error("  In schema only:", artOnlyInSchema);
  if (artOnlyInSrc.length) console.error("  In src only:", artOnlyInSrc);
} else {
  console.log(`PASS artifact kinds: ${ARTIFACT_KINDS.length} values match between schema and src`);
}

// ── 2. Validate bindings fixture against vocabulary schema ──────────────────

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(vocabSchema);

// Bindings schema: each binding has a capability field from the vocabulary
const bindingsSchema = {
  type: "object",
  required: ["bindings"],
  properties: {
    bindings: {
      type: "array",
      uniqueItems: true,
      items: {
        type: "object",
        additionalProperties: true,
        required: ["capability", "provider", "model"],
        properties: {
          capability: { $ref: `${vocabSchema.$id}#/$defs/Capability` },
          provider: { type: "string", minLength: 1 },
          model: { type: "string", minLength: 1 },
        },
      },
    },
  },
};
ajv.addSchema(bindingsSchema, "bindings-schema");
const validateBindings = ajv.getSchema("bindings-schema");

const bindings = JSON.parse(
  readFileSync(resolve(root, "fixtures/vocabulary/valid/bindings.json"), "utf-8")
);

if (!validateBindings(bindings)) {
  failures += 1;
  console.error("FAIL bindings fixture:", ajv.errorsText(validateBindings.errors));
} else {
  console.log(`PASS bindings fixture: ${bindings.bindings.length} capability bindings valid`);
}

// ── 3. Verify all capabilities have a binding ───────────────────────────────

const boundCaps = new Set(bindings.bindings.map((b) => b.capability));
const unbound = CAPABILITIES.filter((c) => !boundCaps.has(c));
if (unbound.length > 0) {
  failures += 1;
  console.error("FAIL bindings fixture missing capabilities:", unbound);
} else {
  console.log("PASS all capabilities have a recorded binding");
}

// ── 4. Verify helpers ───────────────────────────────────────────────────────

for (const cap of CAPABILITIES) {
  if (!isCapability(cap)) {
    failures += 1;
    console.error(`FAIL isCapability("${cap}") returned false`);
  }
}
if (isCapability("llm")) {
  failures += 1;
  console.error('FAIL isCapability("llm") should return false — llm is not a capability');
}
if (isCapability("")) {
  failures += 1;
  console.error('FAIL isCapability("") should return false');
}

for (const kind of ARTIFACT_KINDS) {
  if (!isArtifactKind(kind)) {
    failures += 1;
    console.error(`FAIL isArtifactKind("${kind}") returned false`);
  }
}
if (isArtifactKind("unknown")) {
  failures += 1;
  console.error('FAIL isArtifactKind("unknown") should return false');
}
console.log("PASS vocabulary helpers");

// ── 5. Verify freeze semantics ──────────────────────────────────────────────

const frozenCap = CAPABILITIES;
try {
  frozenCap.push("evil");
  failures += 1;
  console.error("FAIL CAPABILITIES should be frozen (push succeeded)");
} catch {
  // Expected: frozen array rejects mutation
}
console.log("PASS CAPABILITIES is frozen");

// ── Report ──────────────────────────────────────────────────────────────────

if (failures) {
  console.error(`\n${failures} vocabulary check(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`\nAll vocabulary checks passed: ${CAPABILITIES.length} capabilities, ${ARTIFACT_KINDS.length} artifact kinds`);
}
