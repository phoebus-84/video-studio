import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const load = async (relative) => JSON.parse(await readFile(new URL(relative, import.meta.url), "utf8"));
const schema = await load("../schemas/v1alpha1/identity.schema.json");
const validCases = await load("../fixtures/identity/valid.json");
const invalidCases = await load("../fixtures/identity/invalid.json");

function createValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(schema);
  return {
    ajv,
    definition(name) {
      const validate = ajv.getSchema(`${schema.$id}#/$defs/${name}`);
      assert.ok(validate, `schema definition ${name} exists`);
      return validate;
    },
  };
}

test("valid identity fixtures satisfy Draft 2020-12 definitions", () => {
  const { ajv, definition } = createValidator();
  for (const fixture of validCases) {
    const validate = definition(fixture.definition);
    assert.equal(validate(fixture.value), true, `${fixture.definition}: ${ajv.errorsText(validate.errors)}`);
  }
});

test("invalid fixtures are rejected for their assigned primitive", () => {
  const { definition } = createValidator();
  for (const fixture of invalidCases) {
    assert.equal(definition(fixture.definition)(fixture.value), false, `${fixture.definition} accepted: ${fixture.reason}`);
  }
});

test("renaming a slug does not mutate stable identity", () => {
  const { definition } = createValidator();
  const before = { id: "ep_01ARZ3NDEKTSV4RRFFQ69G5FAV", slug: "frog-prince" };
  const after = { ...before, slug: "the-frog-prince" };
  assert.equal(definition("EpisodeId")(before.id), true);
  assert.equal(definition("Slug")(before.slug), true);
  assert.equal(definition("Slug")(after.slug), true);
  assert.equal(after.id, before.id);
  assert.notEqual(after.slug, before.slug);
});

test("revision references reject untyped IDs and unknown fields", () => {
  const { definition } = createValidator();
  const validate = definition("RevisionRef");
  assert.equal(validate({ id: "unknown_01ARZ3NDEKTSV4RRFFQ69G5FAV", revision: 1 }), false);
  assert.equal(validate({ id: "art_01ARZ3NDEKTSV4RRFFQ69G5FAV", revision: 1, latest: true }), false);
});
