#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Enforces the one rule that makes packages/ genuinely reusable:
//
//   packages/* may NOT depend on studio/*.
//
// A package that imports the studio's contracts, runtime or agent is not a
// tool any more — it is a piece of this product wearing a tool's name. The
// integration between a reusable package and the studio belongs on the studio
// side of the line (studio/agent), never inside the package.
//
// Also checks that nothing reaches across a package boundary by relative path
// (../../other-package/src/...), which is how the previous polyrepo layout
// coupled modules while claiming they were independent.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const { workspaces } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));

const problems = [];

// ── 1. Declared dependencies ────────────────────────────────────────────────

const nameByPath = new Map();
for (const ws of workspaces) {
  const pkgPath = join(ROOT, ws, "package.json");
  if (!existsSync(pkgPath)) continue;
  nameByPath.set(ws, JSON.parse(readFileSync(pkgPath, "utf-8")).name);
}

for (const ws of workspaces) {
  if (!ws.startsWith("packages/")) continue;
  const pkgPath = join(ROOT, ws, "package.json");
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  for (const dep of Object.keys(deps)) {
    if (dep.startsWith("@studio/")) {
      problems.push(`${ws}/package.json depends on ${dep} — packages/ must not depend on studio/`);
    }
  }
}

// ── 2. Source imports ───────────────────────────────────────────────────────

const SOURCE = /\.(ts|tsx|mts|cts|js|mjs|cjs|svelte)$/;
const SKIP = new Set(["node_modules", ".git", "dist", ".svelte-kit", ".venv", "models", ".beads", "test", "tests", "__tests__"]);

function* sources(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(full);
    else if (SOURCE.test(entry.name)) yield full;
  }
}

const STUDIO_IMPORT = /from\s+["'](@studio\/[^"']+)["']|require\(\s*["'](@studio\/[^"']+)["']\s*\)/g;
const ESCAPING_RELATIVE = /["'](\.\.\/\.\.\/[^"']*\/src\/[^"']+)["']/g;

for (const ws of workspaces) {
  const isPackage = ws.startsWith("packages/");
  for (const file of sources(join(ROOT, ws))) {
    const text = readFileSync(file, "utf-8");
    const label = relative(ROOT, file);

    if (isPackage) {
      for (const m of text.matchAll(STUDIO_IMPORT)) {
        problems.push(`${label} imports ${m[1] ?? m[2]} — packages/ must not depend on studio/`);
      }
    }

    for (const m of text.matchAll(ESCAPING_RELATIVE)) {
      problems.push(
        `${label} reaches into another workspace by relative path (${m[1]}) — import the package instead`,
      );
    }
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

if (problems.length) {
  console.error(`✗ ${problems.length} boundary violation(s):\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "\npackages/* are meant to be usable outside this repository. Studio-specific\n" +
      "integration belongs in studio/agent, not inside the package.",
  );
  process.exit(1);
}

console.log("✓ packages/ does not depend on studio/, and no workspace reaches across by relative path.");
