import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OUTPUT_PROFILES, outputProfile, validateOutputProfile } from "../src/output-profiles.mjs";

describe("output profiles", () => {
  it("has the 16:9 and 9:16 profiles", () => {
    assert.deepEqual(OUTPUT_PROFILES.map((p) => [p.id, p.width, p.height]), [
      ["youtube-1920x1080", 1920, 1080],
      ["vertical-1080x1920", 1080, 1920],
    ]);
  });

  it("keeps every profile valid, with a unique id", () => {
    for (const p of OUTPUT_PROFILES) assert.deepEqual(validateOutputProfile(p), [], p.id);
    assert.equal(new Set(OUTPUT_PROFILES.map((p) => p.id)).size, OUTPUT_PROFILES.length);
  });

  it("keeps the 9:16 safe zone clear of the platforms' interface", () => {
    assert.deepEqual(outputProfile("vertical-1080x1920").safeZone, { top: 120, right: 140, bottom: 380, left: 60 });
    assert.equal(outputProfile("vertical-1080x1920").loudness.integrated, -14);
    assert.equal(outputProfile("youtube-1920x1080").loudness.integrated, -15);
  });

  it("finds nothing for an unknown id", () => {
    assert.equal(outputProfile("square-1080"), undefined);
  });

  it("cannot be changed through the catalog", () => {
    assert.throws(() => {
      OUTPUT_PROFILES[0].safeZone.top = 0;
    }, TypeError);
  });

  it("refuses a safe zone that leaves no usable area, on either axis", () => {
    const p = structuredClone(outputProfile("vertical-1080x1920"));
    p.safeZone.top = 1600;
    p.safeZone.left = 1000;
    const problems = validateOutputProfile(p, "$.profile");
    assert.deepEqual(problems.map((x) => [x.code, x.path]), [
      ["profile-safe-zone", "$.profile.safeZone"],
      ["profile-safe-zone", "$.profile.safeZone"],
    ]);
    assert.match(problems[0].message, /top 1600 \+ bottom 380 leaves nothing of height 1920/);
    assert.match(problems[1].message, /left 1000 \+ right 140 leaves nothing of width 1080/);
  });
});
