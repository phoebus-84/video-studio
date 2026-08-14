#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Runs one npm script across every TypeScript module in the workspace.
//
// Modules that do not define the requested script are skipped, not failed —
// not every module has a `typecheck`. Any module that defines it and fails
// makes the whole run fail, so CI cannot go green on a broken module.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const script = process.argv[2];

if (!script) {
  console.error("usage: node scripts/run-all.mjs <script-name>");
  process.exit(2);
}

const { workspaces } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));

const skipped = [];
const passed = [];
const failed = [];

for (const dir of workspaces) {
  const pkgPath = join(ROOT, dir, "package.json");
  if (!existsSync(pkgPath)) {
    skipped.push(`${dir} (no package.json)`);
    continue;
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  if (!pkg.scripts?.[script]) {
    skipped.push(`${dir} (no "${script}" script)`);
    continue;
  }

  console.log(`\n━━━ ${dir}: ${script} ━━━`);
  const result = spawnSync("npm", ["run", "--silent", script], {
    cwd: join(ROOT, dir),
    stdio: "inherit",
    env: process.env,
  });

  if (result.status === 0) passed.push(dir);
  else failed.push(dir);
}

console.log(`\n${"═".repeat(70)}`);
console.log(`${script}: ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped`);
if (skipped.length) for (const s of skipped) console.log(`  skip  ${s}`);
if (failed.length) {
  for (const f of failed) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
