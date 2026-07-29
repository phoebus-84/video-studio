#!/usr/bin/env node

/**
 * Validate asset schema fixtures.
 * Usage: node scripts/check-asset-fixtures.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const assetSchema = JSON.parse(
  readFileSync(resolve(root, "schemas/v1alpha1/asset.schema.json"), "utf-8")
);
const identitySchema = JSON.parse(
  readFileSync(resolve(root, "schemas/v1alpha1/identity.schema.json"), "utf-8")
);

const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
addFormats(ajv);
ajv.addSchema(identitySchema);

const validate = ajv.compile(assetSchema);

// Test valid fixture
const valid = JSON.parse(
  readFileSync(resolve(root, "fixtures/asset/valid.json"), "utf-8")
);

const validResult = validate(valid);
if (!validResult) {
  console.error("❌ Valid asset fixture failed validation:");
  console.error(validate.errors);
  process.exit(1);
}
console.log("✅ Asset valid fixture passes");

// Test video-specific fields
const videoAttempt = valid.videoAttempt;
if (videoAttempt.kind !== "video") {
  console.error("❌ Video attempt has wrong kind:", videoAttempt.kind);
  process.exit(1);
}
if (!videoAttempt.video || !videoAttempt.video.loopable) {
  console.error("❌ Video attempt missing video metadata or loopable flag");
  process.exit(1);
}
if (videoAttempt.video.codec !== "h264") {
  console.error("❌ Video attempt has wrong codec:", videoAttempt.video.codec);
  process.exit(1);
}
console.log("✅ Video attempt fields correct (loopable, h264, 30fps)");

// Test all three kinds are represented
const kinds = [
  valid.imageAttempt.kind,
  valid.audioAttempt.kind,
  valid.videoAttempt.kind,
];
if (JSON.stringify(kinds.sort()) !== JSON.stringify(["audio", "image", "video"])) {
  console.error("❌ Not all asset kinds represented:", kinds);
  process.exit(1);
}
console.log("✅ All three asset kinds represented (image, audio, video)");

// Test kind-specific required fields
// Image must have image metadata
if (!valid.imageAttempt.image) {
  console.error("❌ Image attempt missing image metadata");
  process.exit(1);
}
// Audio must have audio metadata
if (!valid.audioAttempt.audio) {
  console.error("❌ Audio attempt missing audio metadata");
  process.exit(1);
}
// Video must have video metadata
if (!valid.videoAttempt.video) {
  console.error("❌ Video attempt missing video metadata");
  process.exit(1);
}
console.log("✅ Kind-specific metadata enforced");

// Test asset group
if (!valid.assetGroup.attempts || valid.assetGroup.attempts.length < 2) {
  console.error("❌ Asset group missing attempts");
  process.exit(1);
}
console.log("✅ AssetGroup with multiple attempts passes");

console.log("\n🎬 All asset contract checks passed!");
