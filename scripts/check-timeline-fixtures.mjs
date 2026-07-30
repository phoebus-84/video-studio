#!/usr/bin/env node

/**
 * Validate edit-timeline schema fixtures.
 * Usage: node scripts/check-timeline-fixtures.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const schema = JSON.parse(
  readFileSync(resolve(root, "schemas/v1alpha1/edit-timeline.schema.json"), "utf-8")
);

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(schema);
const validate = ajv.getSchema(`${schema.$id}#/$defs/EditTimeline`);
if (!validate) throw new Error("EditTimeline schema definition was not registered");

let failures = 0;

// ── Valid fixtures ──────────────────────────────────────────────────────────

const validFixture = JSON.parse(
  readFileSync(resolve(root, "fixtures/timeline/valid/basic.json"), "utf-8")
);

if (!validate(validFixture)) {
  failures += 1;
  console.error("FAIL valid basic.json:", ajv.errorsText(validate.errors));
} else {
  console.log("PASS valid basic.json");
}

// ── Shape checks on valid fixture ───────────────────────────────────────────

const segs = validFixture.segments;
if (segs.length !== 3) {
  failures += 1;
  console.error(`FAIL valid fixture should have 3 segments, got ${segs.length}`);
} else {
  console.log("PASS valid fixture has 3 segments");
}

// Non-decreasing startSec
let prevEnd = 0;
let orderingOk = true;
for (let i = 0; i < segs.length; i++) {
  if (segs[i].startSec < prevEnd - 0.001) {
    failures += 1;
    console.error(`FAIL segment[${i}] startSec ${segs[i].startSec} < previous end ${prevEnd}`);
    orderingOk = false;
  }
  prevEnd = segs[i].startSec + segs[i].durationSec;
}
if (orderingOk) console.log("PASS segments are non-overlapping, non-decreasing");

// Verify first segment starts at 0
if (segs[0].startSec !== 0) {
  failures += 1;
  console.error(`FAIL first segment startSec should be 0, got ${segs[0].startSec}`);
} else {
  console.log("PASS first segment starts at 0");
}

// Verify durations are positive
for (let i = 0; i < segs.length; i++) {
  if (segs[i].durationSec <= 0) {
    failures += 1;
    console.error(`FAIL segment[${i}] durationSec must be positive`);
  }
}
console.log("PASS all durations positive");

// ── Invalid fixtures ────────────────────────────────────────────────────────

const invalidFixtures = [
  "fixtures/timeline/invalid/zero-duration.json",
  "fixtures/timeline/invalid/negative-start.json",
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

// ── Composer mapping verification ───────────────────────────────────────────
// Verify the valid fixture is convertible to the composer's Timeline type.
// Key mappings:
//   fps → profile.fps
//   resolution → canvas
//   segments[].sourceAsset → scenes[].asset.path
//   segments[].startSec → scenes[].timelineStart
//   segments[].durationSec → scenes[].duration (computed from inPoint/outPoint)
//   segments[].sourceKind → asset type classification
//   segments[].transition → scenes[].transition
//   segments[].caption → scenes[].caption
//   segments[].audio → scenes[].audio
//   segments[].transform → scenes[].transform
//   segments[].filters → scenes[].filters

const mappingIssues = [];

// All required composer fields must be present or derivable
for (let i = 0; i < segs.length; i++) {
  const s = segs[i];

  // composer requires: id, asset, inPoint, outPoint, timelineStart
  if (!s.id) mappingIssues.push(`segment[${i}]: missing id`);
  if (!s.sourceAsset) mappingIssues.push(`segment[${i}]: missing sourceAsset (→ asset.path)`);
  if (typeof s.startSec !== "number") mappingIssues.push(`segment[${i}]: missing startSec (→ timelineStart)`);
  if (typeof s.durationSec !== "number" || s.durationSec <= 0)
    mappingIssues.push(`segment[${i}]: invalid durationSec (→ outPoint − inPoint)`);

  // composer asset shape: { path, hash?, revision? }
  // Our sourceAsset maps to asset.path; hash/revision are optional
  // → the mapping is valid since we have path

  // Verify transition fields if present
  if (s.transition) {
    if (!["dissolve", "fade", "wipe", "none"].includes(s.transition.type))
      mappingIssues.push(`segment[${i}]: invalid transition.type "${s.transition.type}"`);
    if (typeof s.transition.duration !== "number" || s.transition.duration <= 0)
      mappingIssues.push(`segment[${i}]: transition.duration must be positive`);
  }

  // Verify caption fields if present
  if (s.caption) {
    if (!s.caption.text) mappingIssues.push(`segment[${i}]: caption missing text`);
    if (typeof s.caption.start !== "number" || s.caption.start < 0)
      mappingIssues.push(`segment[${i}]: caption.start invalid`);
    if (typeof s.caption.duration !== "number" || s.caption.duration <= 0)
      mappingIssues.push(`segment[${i}]: caption.duration must be positive`);
  }

  // Verify audio fields if present
  if (s.audio) {
    if (s.audio.volume !== undefined && (typeof s.audio.volume !== "number" || s.audio.volume < 0))
      mappingIssues.push(`segment[${i}]: audio.volume must be non-negative`);
    if (s.audio.fadeIn !== undefined && (typeof s.audio.fadeIn !== "number" || s.audio.fadeIn < 0))
      mappingIssues.push(`segment[${i}]: audio.fadeIn must be non-negative`);
    if (s.audio.fadeOut !== undefined && (typeof s.audio.fadeOut !== "number" || s.audio.fadeOut < 0))
      mappingIssues.push(`segment[${i}]: audio.fadeOut must be non-negative`);
  }

  // Verify transform fields if present
  if (s.transform) {
    if (s.transform.crop) {
      for (const f of ["x", "y", "width", "height"]) {
        if (typeof s.transform.crop[f] !== "number" || s.transform.crop[f] < 0)
          mappingIssues.push(`segment[${i}]: transform.crop.${f} must be non-negative`);
      }
    }
    if (s.transform.fit && !["contain", "cover", "fill", "none"].includes(s.transform.fit))
      mappingIssues.push(`segment[${i}]: invalid transform.fit "${s.transform.fit}"`);
    if (s.transform.position) {
      if (typeof s.transform.position.x !== "number")
        mappingIssues.push(`segment[${i}]: transform.position.x must be a number`);
      if (typeof s.transform.position.y !== "number")
        mappingIssues.push(`segment[${i}]: transform.position.y must be a number`);
    }
  }
}

if (mappingIssues.length > 0) {
  failures += 1;
  console.error("FAIL composer mapping issues:");
  for (const issue of mappingIssues) console.error(`  ${issue}`);
} else {
  console.log("PASS valid fixture maps to composer Timeline type");
}

// ── Verify resolution matches canvas ────────────────────────────────────────

if (validFixture.resolution.width !== 1920 || validFixture.resolution.height !== 1080) {
  failures += 1;
  console.error("FAIL valid fixture resolution should be 1920×1080");
} else {
  console.log("PASS resolution 1920×1080");
}

// ── Report ──────────────────────────────────────────────────────────────────

if (failures) {
  console.error(`\n${failures} timeline check(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`\n1 valid and ${invalidFixtures.length} invalid timeline fixtures passed`);
}
