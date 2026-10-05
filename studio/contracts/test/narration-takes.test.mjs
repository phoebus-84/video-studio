import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateNarrationTakes } from "../src/narration-takes.mjs";
import { applyPatch } from "../scripts/lib/json-patch.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(root, "fixtures/narration-takes");
const read = (path) => JSON.parse(readFileSync(resolve(root, path), "utf-8"));
const doc = () => read("fixtures/narration-takes/valid/il-lampo.json");
const timings = () => ({
  epoca: read("fixtures/word-timing/valid/epoca-take.json"),
  recitazione: read("fixtures/word-timing/valid/san-martino-recital.json"),
});
const codes = (problems) => [...new Set(problems.map((p) => p.code))].sort();

describe("validateNarrationTakes", () => {
  it("accepts the Il lampo fixture", () => {
    assert.deepEqual(validateNarrationTakes(doc()), []);
  });

  it("rejects every invalid fixture with exactly its expected code", () => {
    for (const file of readdirSync(resolve(dir, "invalid"))) {
      const fixture = JSON.parse(readFileSync(resolve(dir, "invalid", file), "utf-8"));
      const broken = applyPatch(JSON.parse(readFileSync(resolve(dir, "valid", fixture.base), "utf-8")), fixture.patch);
      assert.deepEqual(codes(validateNarrationTakes(broken)), [fixture.expect], file);
    }
  });

  it("collects every problem with its path", () => {
    const d = doc();
    d.units[1].sequence[0].take = "genesi";
    delete d.units[2].sequence[1].pauseBefore;
    assert.deepEqual(validateNarrationTakes(d).map((p) => [p.code, p.path]), [
      ["unknown-take", "$.units[1].sequence[0].take"],
      ["bad-pause", "$.units[2].sequence[1]"],
    ]);
  });
});
