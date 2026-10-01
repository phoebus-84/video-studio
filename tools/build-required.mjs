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
const REQUIRED = ["packages/fal-media", "packages/video-composer", "studio/runtime", "studio/adapters"];

/**
 * Nothing must depend on a `dist/` that install does not build.
 *
 * `@av/fal-media` publishes through `dist/`, the agent began importing it, and
 * it was not on this list. Every existing checkout already had a `dist/` from
 * some earlier build, so it resolved everywhere it was tried and failed only on
 * a fresh clone — where `tsc` reported `Cannot find module '@av/fal-media'`,
 * and then a second, unrelated-looking implicit-`any` error from the inference
 * that module was carrying.
 *
 * The list stays explicit, for the reason above. This only refuses to let a new
 * omission be discovered by CI on someone else's machine.
 */
function checkListIsComplete(workspaces) {
  const declared = new Set(REQUIRED);
  const missing = [];

  for (const [dir, pkg] of workspaces) {
    const publishesDist = JSON.stringify(pkg.exports ?? pkg.main ?? "").includes("dist/");
    if (!publishesDist || declared.has(dir)) continue;

    const dependents = workspaces
      .filter(([otherDir, other]) =>
        otherDir !== dir
        && Object.keys({ ...other.dependencies, ...other.devDependencies }).includes(pkg.name))
      .map(([, other]) => other.name);

    if (dependents.length > 0) missing.push({ dir, name: pkg.name, dependents });
  }

  if (missing.length === 0) return;
  for (const { dir, name, dependents } of missing) {
    console.error(
      `${name} publishes through dist/ and is imported by ${dependents.join(", ")}, `
      + `but "${dir}" is not in REQUIRED. A fresh clone cannot resolve it.`,
    );
  }
  process.exit(1);
}

function allWorkspaces() {
  const root = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  return (root.workspaces ?? []).map((dir) => {
    try {
      return [dir, JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf-8"))];
    } catch {
      return null;
    }
  }).filter((entry) => entry !== null);
}

checkListIsComplete(allWorkspaces());

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
