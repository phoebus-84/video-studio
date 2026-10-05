import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => JSON.parse(readFileSync(resolve(root, rel), "utf-8"));

describe("edit-timeline v1alpha2 schema", () => {
  const schema = read("schemas/v1alpha2/edit-timeline.schema.json");
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(schema);
  const validate = ajv.getSchema(`${schema.$id}#/$defs/EditTimeline`);

  it("compiles in strict mode under its v1alpha2 $id", () => {
    assert.equal(schema.$id, "https://video.studio/schemas/v1alpha2/edit-timeline.schema.json");
    assert.ok(validate, "EditTimeline definition was not registered");
  });

  it("accepts the reference lesson excerpt", () => {
    const ok = validate(read("fixtures/timeline/v1alpha2/valid/lesson-excerpt.json"));
    assert.ok(ok, ajv.errorsText(validate.errors));
  });

  it("rejects fractional frames and a v1alpha1 apiVersion", () => {
    const doc = read("fixtures/timeline/v1alpha2/valid/lesson-excerpt.json");
    assert.equal(validate({ ...doc, durationInFrames: 900.5 }), false);
    assert.equal(validate({ ...doc, apiVersion: "studio.video/v1alpha1" }), false);
  });
});
