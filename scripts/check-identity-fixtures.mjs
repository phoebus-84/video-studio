import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const loadJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const schema = await loadJson("schemas/v1alpha1/identity.schema.json");
const validCases = await loadJson("fixtures/identity/valid.json");
const invalidCases = await loadJson("fixtures/identity/invalid.json");
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(schema);

function validatorFor(definition) {
  const validator = ajv.getSchema(`${schema.$id}#/$defs/${definition}`);
  if (!validator) throw new Error(`Unknown identity definition: ${definition}`);
  return validator;
}

let failures = 0;
for (const fixture of validCases) {
  const validate = validatorFor(fixture.definition);
  if (!validate(fixture.value)) {
    failures += 1;
    console.error(`FAIL valid ${fixture.definition}: ${ajv.errorsText(validate.errors)}`);
  }
}
for (const fixture of invalidCases) {
  const validate = validatorFor(fixture.definition);
  if (validate(fixture.value)) {
    failures += 1;
    console.error(`FAIL invalid ${fixture.definition} was accepted: ${fixture.reason}`);
  }
}

if (failures) {
  console.error(`\n${failures} identity fixture(s) violated the schema expectations`);
  process.exitCode = 1;
} else {
  console.log(`${validCases.length} valid and ${invalidCases.length} invalid identity fixtures passed`);
}
