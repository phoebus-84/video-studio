#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Builds only the packages that other workspaces import as *built* artifacts.
//
// Most modules here are consumed from source. A few publish through `dist/`
// (their package.json `exports` point there), so a consumer cannot even load
// them until they are built. Those must exist immediately after install, or a
// fresh clone fails at import time rather than at build time — which is far
// more confusing.
//
// This is deliberately a short, explicit list rather than "build everything":
// a module with a pre-existing build failure should not block installation of
// the parts that do work.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");

/** Workspaces whose `exports` resolve into `dist/`. */
const REQUIRED = ["packages/video-composer", "studio/runtime"];

let failed = 0;

for (const dir of REQUIRED) {
  const pkg = JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf-8"));
  process.stdout.write(`building ${pkg.name} … `);

  const result = spawnSync("npm", ["run", "--silent", "build"], {
    cwd: join(ROOT, dir),
    encoding: "utf-8",
    env: process.env,
  });

  if (result.status === 0) {
    console.log("ok");
  } else {
    failed++;
    console.log("FAILED");
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
  }
}

if (failed) {
  console.error(
    `\n${failed} required build(s) failed. Consumers import these from dist/, ` +
      `so they must build for the workspace to be usable.`,
  );
  process.exit(1);
}
