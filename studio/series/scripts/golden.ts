// Write a released compiler's golden output — only when the version is new.
//
//   node --import tsx scripts/golden.ts poetry-short 1.0.0
//
// Refuses to overwrite: a released version's golden never changes.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileSpec } from "../src/index.js";

const [id, version] = process.argv.slice(2);
if (!id || !version) throw new Error("usage: golden.ts <compiler-id> <version>");
const dir = join(import.meta.dirname, "..", "fixtures", id, version);
const out = join(dir, "expected-timeline.json");
if (existsSync(out)) throw new Error(`${out} exists: a released version's golden never changes; add a new version instead`);
const result = compileSpec(JSON.parse(readFileSync(join(dir, "input.json"), "utf-8")));
if (!result.ok) throw new Error(`the fixture does not compile: ${JSON.stringify(result.problems, null, 2)}`);
writeFileSync(out, `${JSON.stringify(result.timeline, null, 2)}\n`);
console.log(`wrote ${out}`);
