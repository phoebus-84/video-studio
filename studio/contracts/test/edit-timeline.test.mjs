import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EDIT_TIMELINE_API_VERSION,
  jsonPath,
  validateEditTimeline,
} from "../src/edit-timeline.mjs";
import { applyPatch } from "../scripts/lib/json-patch.mjs";

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
