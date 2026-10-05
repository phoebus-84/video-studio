import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => JSON.parse(readFileSync(resolve(root, rel), "utf-8"));

describe("word-timing schema", () => {
  const schema = read("schemas/v1alpha1/word-timing.schema.json");
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(schema);
  const validate = ajv.getSchema(`${schema.$id}#/$defs/WordTiming`);

  it("compiles in strict mode as a v1alpha1 kind", () => {
    assert.equal(schema.$id, "https://video.studio/schemas/v1alpha1/word-timing.schema.json");
    assert.ok(validate, "WordTiming definition was not registered");
  });

  it("accepts the two takes converted from CreativeStudio", () => {
    for (const file of ["epoca-take.json", "san-martino-recital.json"]) {
      const ok = validate(read(`fixtures/word-timing/valid/${file}`));
      assert.ok(ok, `${file}: ${ajv.errorsText(validate.errors)}`);
    }
  });

  it("keeps the written word and records the pronunciation only where it differs", () => {
    const doc = read("fixtures/word-timing/valid/epoca-take.json");
    assert.equal(doc.audio.hash, "sha256:f6a2b821d310658eefa4aac4fbe231c1e12e13099ba26bd377227487733d0013");
    assert.deepEqual(doc.words.filter((w) => w.spoken).map((w) => [w.text, w.spoken]), [["Myricae.", "Mirìce."]]);
  });

  it("rejects a three-element speech span and an energy value above 1", () => {
    const doc = read("fixtures/word-timing/valid/san-martino-recital.json");
    assert.equal(validate({ ...doc, speech: [[0, 1, 2]] }), false);
    assert.equal(validate({ ...doc, energy: { rate: 30, values: [1.5] } }), false);
  });
});
