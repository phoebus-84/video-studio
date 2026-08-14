#!/usr/bin/env node
// ---------------------------------------------------------------------------
// The workspace must install from a fresh clone on any machine.
//
// The predecessor layout used `file:../` dependencies, which npm and bun
// materialize as symlinks holding ABSOLUTE paths. The tree was authored under
// one developer's home directory, so every link dangled elsewhere and 20 of 28
// runtime test files failed at import on any other machine.
//
// This fails if a symlink escapes the repo, or a tracked file hardcodes a home
// directory. Test fixtures using synthetic paths as data are exempt.
// ---------------------------------------------------------------------------

import { readdirSync, readlinkSync, readFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { execSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
// `library` is deliberately allowed to be a link to data kept outside the
// repository (it is gitignored production media); the rule this guards is that
// *code and configuration* never depend on an absolute path.
const SKIP = new Set([".git", ".venv", "models", ".svelte-kit", "dist", ".beads", "library"]);

const problems = [];

// ── Symlinks escaping the repo ──────────────────────────────────────────────

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const target = readlinkSync(full);
      const resolved = resolve(dir, target);
      if (relative(ROOT, resolved).startsWith("..")) {
        problems.push(`symlink escapes repo: ${relative(ROOT, full)} -> ${target}`);
      }
      continue;
    }
    if (entry.isDirectory()) walk(full);
  }
}

walk(ROOT);

// ── Absolute home paths in tracked files ────────────────────────────────────

const HOME_PATH = /\/(?:Users|home)\/[A-Za-z0-9_.-]+\//;
// Test fixtures, generated evaluation records and changelogs legitimately
// contain absolute paths as DATA — they never configure an install.
const EXEMPT = /(^|\/)(\.beads|tests?|__tests__|fixtures|evaluation|CHANGELOG\.md|.*\.lock)(\/|$)/;
const BINARY = /\.(png|jpg|jpeg|gif|mp3|mp4|wav|zip|ico|woff2?|pdf|svg)$/i;

let tracked = [];
try {
  tracked = execSync("git ls-files", { cwd: ROOT, encoding: "utf-8" }).trim().split("\n").filter(Boolean);
} catch {
  // Not a git repo yet — the symlink half of the check still applies.
}

for (const file of tracked) {
  if (BINARY.test(file) || EXEMPT.test(file)) continue;
  let text;
  try {
    text = readFileSync(join(ROOT, file), "utf-8");
  } catch {
    continue;
  }
  if (text.length > 2_000_000) continue;
  const match = text.match(HOME_PATH);
  if (match) {
    const line = text.slice(0, match.index).split("\n").length;
    problems.push(`tracked file hardcodes a home path: ${file}:${line} (${match[0]})`);
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

if (problems.length) {
  console.error(`✗ ${problems.length} foreign-path problem(s):\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error("\nUse `workspace:*` dependencies, never `file:../`, and never commit absolute paths.");
  process.exit(1);
}

console.log("✓ No symlinks escape the repo and no tracked file hardcodes a home path.");
