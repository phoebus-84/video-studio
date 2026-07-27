import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyCompatibilityChange, validateCompatibilityCase } from "../src/compatibility-policy.mjs";

test("classifies additive and breaking changes according to durable-reader policy", () => {
  assert.deepEqual(classifyCompatibilityChange("new-kind"), {
    classification: "additive",
    minimumPackageBump: "minor",
    apiVersionChange: false,
    migrationRequired: false,
  });
  assert.deepEqual(classifyCompatibilityChange("closed-enum-change"), {
    classification: "breaking",
    minimumPackageBump: "major",
    apiVersionChange: true,
    migrationRequired: true,
  });
});

test("rejects unknown change types", () => {
  assert.throws(() => classifyCompatibilityChange("quietly-guess"), /Unknown compatibility change type/);
});

test("requires an apiVersion example for breaking changes", () => {
  const result = validateCompatibilityCase({
    name: "bad breaking fixture",
    change: "field-rename",
    before: { apiVersion: "studio.video/v1alpha1" },
    after: { apiVersion: "studio.video/v1alpha1" },
    expected: classifyCompatibilityChange("field-rename"),
  });
  assert.equal(result.valid, false);
  assert.match(result.mismatches.join("\n"), /changed apiVersion/);
});

test("all checked-in examples conform to policy", async () => {
  const url = new URL("../fixtures/compatibility/cases.json", import.meta.url);
  const cases = JSON.parse(await readFile(url, "utf8"));
  assert.ok(cases.some((entry) => entry.expected.classification === "breaking"));
  assert.ok(cases.some((entry) => entry.expected.classification === "additive"));
  for (const testCase of cases) {
    const result = validateCompatibilityCase(testCase);
    assert.equal(result.valid, true, `${testCase.name}: ${result.mismatches.join(", ")}`);
  }
});
