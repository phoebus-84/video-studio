import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EDIT_TIMELINE_API_VERSION,
  jsonPath,
  migrateEditTimelineV1alpha1,
  validateEditTimeline,
} from "../src/edit-timeline.mjs";
import { applyPatch } from "../scripts/lib/json-patch.mjs";
import { outputProfile } from "../src/output-profiles.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const v2 = resolve(root, "fixtures/timeline/v1alpha2");
const read = (path) => JSON.parse(readFileSync(path, "utf-8"));
const lesson = () => read(resolve(v2, "valid/lesson-excerpt.json"));
const codes = (problems) => [...new Set(problems.map((p) => p.code))].sort();

describe("validateEditTimeline", () => {
  it("accepts every valid v1alpha2 fixture", () => {
    for (const file of readdirSync(resolve(v2, "valid"))) {
      assert.deepEqual(validateEditTimeline(read(resolve(v2, "valid", file))), [], file);
    }
  });

  it("rejects every invalid fixture with exactly its expected code", () => {
    for (const file of readdirSync(resolve(v2, "invalid"))) {
      const fixture = read(resolve(v2, "invalid", file));
      const doc = applyPatch(read(resolve(v2, "valid", fixture.base)), fixture.patch);
      assert.deepEqual(codes(validateEditTimeline(doc)), [fixture.expect], file);
    }
  });

  it("reports schema problems with a JSON path and nothing else", () => {
    const doc = lesson();
    doc.tracks[2].items[0].from = 0.5;
    const problems = validateEditTimeline(doc);
    assert.ok(problems.length > 0);
    assert.ok(problems.every((p) => p.code === "schema"));
    assert.ok(problems.some((p) => p.path === "$.tracks[2].items[0].from"));
  });

  it("accepts a timeline that declares its loop, and refuses a loop that is not a boolean", () => {
    const doc = lesson();
    doc.loop = true;
    assert.deepEqual(validateEditTimeline(doc), []);
    doc.loop = "yes";
    assert.ok(validateEditTimeline(doc).some((p) => p.code === "schema" && p.path === "$.loop"));
  });

  it("reports a resolution that is not its profile's, and a safe zone that leaves nothing", () => {
    const doc = lesson();
    doc.resolution = { width: 1280, height: 720 };
    doc.profile.safeZone.left = 1900;
    const problems = validateEditTimeline(doc);
    assert.deepEqual(problems.map((p) => [p.code, p.path]), [
      ["profile-resolution-mismatch", "$.profile"],
      ["profile-safe-zone", "$.profile.safeZone"],
    ]);
    assert.match(problems[0].message, /resolution 1280x720 is not profile "youtube-1920x1080" \(1920x1080\)/);
  });

  it("accepts a profile that is not in the catalog", () => {
    const doc = lesson();
    doc.profile.id = "house-style";
    doc.profile.loudness.integrated = -16;
    assert.deepEqual(validateEditTimeline(doc), []);
  });

  it("collects every semantic problem, not just the first", () => {
    const doc = lesson();
    doc.tracks[4].z = 5;
    doc.sections[1].from = 100;
    assert.deepEqual(codes(validateEditTimeline(doc)), ["section-overlap", "z-on-audio"]);
  });

  it("points at the offending field", () => {
    const doc = lesson();
    delete doc.tracks[1].items[1].transitionIn;
    assert.deepEqual(validateEditTimeline(doc).map((p) => p.path), ["$.tracks[1].items[1].from"]);
  });

  it("checks overlaps in time order even when items are listed out of order", () => {
    const doc = lesson();
    doc.tracks[1].items.reverse();
    assert.deepEqual(validateEditTimeline(doc), []);
  });

  it("rejects a crossfade item that ends inside the previous item", () => {
    const doc = lesson();
    doc.tracks[1].items[1].duration = 8; // ends at 420, exactly where painting-1 ends
    assert.deepEqual(codes(validateEditTimeline(doc)), ["bad-crossfade"]);
  });

  it("rejects a crossfade that would put three items on screen at once", () => {
    const doc = lesson();
    const still = (id, from, duration, crossfade) => ({
      id, from, duration, kit: { name: "still", version: "1.0.0" }, props: { src: { $asset: "painting-1" } },
      ...(crossfade ? { transitionIn: { type: "crossfade", duration: crossfade } } : {}),
    });
    doc.tracks[1].items = [still("a", 100, 100), still("b", 190, 110, 10), still("c", 195, 205, 105)];
    assert.deepEqual(validateEditTimeline(doc).map((p) => [p.code, p.path]), [["bad-crossfade", "$.tracks[1].items[2].transitionIn"]]);
  });

  it("rejects a crossfade that starts on the same frame as the previous item", () => {
    const doc = lesson();
    doc.tracks[1].items[1].from = 120; // same frame as painting-1, which ends at 420
    doc.tracks[1].items[1].duration = 350; // ends at 470, after painting-1
    doc.tracks[1].items[1].transitionIn.duration = 300; // overlap 420 - 120
    assert.deepEqual(codes(validateEditTimeline(doc)), ["bad-crossfade"]);
  });

  it("finds asset references nested in arrays and next to other keys", () => {
    const doc = lesson();
    doc.tracks[3].items[0].props.layers = [{ image: { $asset: "nowhere", fit: "cover" } }];
    doc.tracks[3].items[0].props["timing-curve"] = { $asset: "also-nowhere" };
    assert.deepEqual(validateEditTimeline(doc).map((p) => p.path).sort(), [
      "$.tracks[3].items[0].props.layers[0].image.$asset",
      '$.tracks[3].items[0].props["timing-curve"].$asset',
    ]);
  });

  it("accepts an empty track and a timeline without sections", () => {
    const doc = lesson();
    doc.tracks.push({ id: "overlay", type: "visual", z: 50, items: [] });
    delete doc.sections;
    assert.deepEqual(validateEditTimeline(doc), []);
  });
});

describe("jsonPath", () => {
  it("turns JSON pointers into JSON paths", () => {
    assert.equal(jsonPath(""), "$");
    assert.equal(jsonPath("/tracks/2/items/0/from"), "$.tracks[2].items[0].from");
    assert.equal(jsonPath("/assets/take-epoca/hash"), '$.assets["take-epoca"].hash');
    assert.equal(jsonPath("/a~1b/c~0d"), '$["a/b"]["c~d"]');
  });
});

describe("migrateEditTimelineV1alpha1", () => {
  const basic = () => read(resolve(root, "fixtures/timeline/valid/basic.json"));
  const hashes = {
    "assets/images/scene-01-woods.png": `sha256:${"1".repeat(64)}`,
    "assets/images/scene-02-grandma.png": `sha256:${"2".repeat(64)}`,
    "assets/images/scene-03-ending.png": `sha256:${"3".repeat(64)}`,
  };

  it("maps the v1alpha1 basic fixture to the v1alpha2 explainer fixture", () => {
    const migrated = migrateEditTimelineV1alpha1(basic(), { assetHashes: hashes });
    assert.deepEqual(migrated, read(resolve(v2, "valid/explainer.json")));
    assert.equal(migrated.apiVersion, EDIT_TIMELINE_API_VERSION);
    assert.deepEqual(validateEditTimeline(migrated), []);
  });

  it("refuses to invent a content hash", () => {
    const partial = { ...hashes };
    delete partial["assets/images/scene-02-grandma.png"];
    assert.throws(
      () => migrateEditTimelineV1alpha1(basic(), { assetHashes: partial }),
      /no content hash for: assets\/images\/scene-02-grandma\.png/,
    );
  });

  it("refuses a fractional frame rate", () => {
    assert.throws(() => migrateEditTimelineV1alpha1({ ...basic(), fps: 29.97 }, { assetHashes: hashes }), /not an integer/);
  });

  it("gives a 1920x1080 timeline the 16:9 profile and a 1080x1920 one the 9:16 profile", () => {
    assert.deepEqual(migrateEditTimelineV1alpha1(basic(), { assetHashes: hashes }).profile, outputProfile("youtube-1920x1080"));
    const vertical = { ...basic(), resolution: { width: 1080, height: 1920 } };
    const migrated = migrateEditTimelineV1alpha1(vertical, { assetHashes: hashes });
    assert.deepEqual(migrated.profile, outputProfile("vertical-1080x1920"));
    assert.deepEqual(validateEditTimeline(migrated), []);
  });

  it("uses the profile it is given, and refuses a size no profile has", () => {
    const square = { ...basic(), resolution: { width: 1080, height: 1080 } };
    assert.throws(
      () => migrateEditTimelineV1alpha1(square, { assetHashes: hashes }),
      /no output profile is 1080x1080 \(youtube-1920x1080 1920x1080, vertical-1080x1920 1080x1920\)/,
    );
    const profile = { id: "square-1080", width: 1080, height: 1080, safeZone: { top: 54, right: 54, bottom: 54, left: 54 }, loudness: { integrated: -14, truePeak: -1, range: 11 } };
    assert.deepEqual(migrateEditTimelineV1alpha1(square, { assetHashes: hashes, profile }).profile, profile);
  });

  it("copies the catalog profile, so the timeline is free of the catalog", () => {
    const migrated = migrateEditTimelineV1alpha1(basic(), { assetHashes: hashes });
    migrated.profile.safeZone.top = 0;
    assert.equal(outputProfile("youtube-1920x1080").safeZone.top, 54);
  });

  it("refuses anything but a v1alpha1 timeline", () => {
    assert.throws(() => migrateEditTimelineV1alpha1(lesson(), { assetHashes: hashes }), /v1alpha1 EditTimeline/);
  });
  it("rounds absolute times, so adjacent segments never overlap after migration", () => {
    const doc = {
      ...basic(),
      fps: 25,
      segments: [
        { id: "a", sourceAsset: "assets/images/scene-01-woods.png", sourceKind: "image", startSec: 0.02, durationSec: 1.02 },
        { id: "b", sourceAsset: "assets/images/scene-02-grandma.png", sourceKind: "image", startSec: 1.04, durationSec: 1 },
      ],
    };
    const migrated = migrateEditTimelineV1alpha1(doc, { assetHashes: hashes });
    assert.deepEqual(migrated.tracks[0].items.map((it) => [it.from, it.duration]), [[1, 25], [26, 25]]);
    assert.deepEqual(validateEditTimeline(migrated), []);
  });

  it("keeps the sound of a video segment unless it is muted", () => {
    const video = (id, audio) => ({ id, sourceAsset: `assets/clips/${id}.mp4`, sourceKind: "video", startSec: 0, durationSec: 2, ...(audio ? { audio } : {}) });
    const doc = { ...basic(), segments: [video("c1")] };
    const migrated = migrateEditTimelineV1alpha1(doc, { assetHashes: { "assets/clips/c1.mp4": `sha256:${"4".repeat(64)}` } });
    assert.deepEqual(migrated.tracks.find((t) => t.id === "sound")?.items, [{ id: "c1-sound", from: 0, duration: 60, asset: "c1" }]);
    const muted = { ...basic(), segments: [video("c2", { mute: true })] };
    const silent = migrateEditTimelineV1alpha1(muted, { assetHashes: { "assets/clips/c2.mp4": `sha256:${"5".repeat(64)}` } });
    assert.equal(silent.tracks.find((t) => t.id === "sound"), undefined);
  });

  it("throws instead of returning a timeline that fails validation", () => {
    const doc = basic();
    doc.segments[0].id = "scene 01";
    assert.throws(() => migrateEditTimelineV1alpha1(doc, { assetHashes: hashes }), /not a valid v1alpha2 timeline:.*schema/);
  });
});
