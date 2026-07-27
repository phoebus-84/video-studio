import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { validateCompatibilityCase } from "../src/compatibility-policy.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "../fixtures/compatibility/cases.json");
const cases = JSON.parse(await readFile(fixturePath, "utf8"));
let failed = 0;

for (const testCase of cases) {
  const result = validateCompatibilityCase(testCase);
  if (!result.valid) {
    failed += 1;
    console.error(`FAIL ${testCase.name}`);
    for (const mismatch of result.mismatches) console.error(`  - ${mismatch}`);
  } else {
    console.log(`PASS ${testCase.name}: ${result.actual.classification}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} compatibility fixture(s) violate policy`);
  process.exitCode = 1;
} else {
  console.log(`\n${cases.length} compatibility fixtures conform to policy`);
}
