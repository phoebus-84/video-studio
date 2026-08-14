import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { validateWorkspaceSemantics } from "../src/workspace-semantics.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const loadJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const [identity, workspace, fairyTale, repository, invalidCases] = await Promise.all([
  loadJson("schemas/v1alpha1/identity.schema.json"),
  loadJson("schemas/v1alpha1/workspace.schema.json"),
  loadJson("fixtures/workspace/fairy-tale.json"),
  loadJson("fixtures/workspace/repository.json"),
  loadJson("fixtures/workspace/invalid.json"),
]);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(identity);
ajv.addSchema(workspace);
const validate = ajv.getSchema(`${workspace.$id}#/$defs/WorkspaceExample`);
if (!validate) throw new Error("WorkspaceExample schema definition was not registered");

function applyMutation(document, fixture) {
  const copy = structuredClone(document);
  const segments = fixture.path.split(".");
  const key = segments.pop();
  const parent = segments.reduce((value, segment) => value[segment], copy);
  if (!parent || !key) throw new Error(`Invalid mutation path: ${fixture.path}`);
  if (fixture.operation === "delete") delete parent[key];
  else if (fixture.operation === "set") parent[key] = fixture.value;
  else throw new Error(`Unknown mutation operation: ${fixture.operation}`);
  return copy;
}

let failures = 0;
for (const [name, fixture] of [["fairy-tale", fairyTale], ["repository", repository]]) {
  const schemaValid = validate(fixture);
  const semanticErrors = validateWorkspaceSemantics(fixture);
  if (!schemaValid || semanticErrors.length) {
    failures += 1;
    console.error(`FAIL valid ${name}: ${ajv.errorsText(validate.errors)} ${JSON.stringify(semanticErrors)}`);
  } else console.log(`PASS valid ${name}`);
}

for (const fixture of invalidCases) {
  const base = fixture.base === "fairy-tale" ? fairyTale : repository;
  const mutated = applyMutation(base, fixture);
  const rejected = !validate(mutated) || validateWorkspaceSemantics(mutated).length > 0;
  if (!rejected) {
    failures += 1;
    console.error(`FAIL invalid ${fixture.name} was accepted`);
  } else console.log(`PASS invalid ${fixture.name}`);
}

if (failures) {
  console.error(`\n${failures} workspace fixture(s) violated contract expectations`);
  process.exitCode = 1;
} else console.log(`\n2 valid and ${invalidCases.length} invalid workspace fixtures passed`);
