#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  SERIES_TEMPLATE_FILES, validateSeriesTemplate, validateTemplateBundle,
  validateEpisodeSpec, validateSeriesReference,
} from "../src/series-templates.mjs";

const root = fileURLToPath(new URL("../fixtures/series-template/", import.meta.url));
const read = (name) => readFileSync(path.join(root, name), "utf8");
const json = (name) => JSON.parse(read(name));
const release = "example/templates/poetry-short/1.0.0/";
const bundle = {
  manifest: read(release + "series-template.json"),
  files: Object.fromEntries(Object.values(SERIES_TEMPLATE_FILES).map((name) => [name, read(release + name)])),
};
assert.deepEqual(validateSeriesTemplate(JSON.parse(bundle.manifest)), []);
assert.deepEqual(validateTemplateBundle(bundle), []);
assert.deepEqual(validateEpisodeSpec(json("example/episode-spec.json"), bundle), []);
assert.deepEqual(validateSeriesReference(json("example/templates/poetry-short/references/morning-v1.json")), []);

const invalid = json("invalid.json");
for (const { name, type, document } of invalid) {
  const problems = type === "template" ? validateSeriesTemplate(document)
    : type === "reference" ? validateSeriesReference(document) : validateEpisodeSpec(document, bundle);
  assert.ok(problems.length > 0, `Invalid fixture accepted: ${name}`);
}
console.log(`Series template bundle/spec/reference and ${invalid.length} invalid fixtures passed`);
