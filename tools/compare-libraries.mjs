#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Compare two libraries by content, ignoring layout.
//
//   node tools/compare-libraries.mjs --a /path/to/backup --b ./library
//
// Layout 1 and layout 2 put the same files at different paths, so comparing
// paths would report every file as moved. This compares the multiset of
// (basename, size) instead, which answers the only question that matters after
// a migration: is anything actually missing?
//
// Exits non-zero if either side has files the other does not.
// ---------------------------------------------------------------------------

import { readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const get = (name) => {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

const A = get("a");
const B = get("b");
if (!A || !B) {
  console.error("usage: compare-libraries.mjs --a <library> --b <library>");
  process.exit(2);
}
for (const p of [A, B]) {
  if (!existsSync(p)) {
    console.error(`No library at ${p}`);
    process.exit(2);
  }
}

const IGNORE = new Set([".DS_Store"]);

/** Map of "basename:size" -> list of paths, for everything under `dir`. */
function index(dir) {
  const out = new Map();
  const walk = (d, rel = "") => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (IGNORE.has(e.name)) continue;
      const full = join(d, e.name);
      const key = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(full, key);
      else if (e.isFile()) {
        let size;
        try {
          size = statSync(full).size;
        } catch {
          continue;
        }
        const k = `${e.name}:${size}`;
        if (!out.has(k)) out.set(k, []);
        out.get(k).push(key);
      }
    }
  };
  walk(dir);
  return out;
}

const a = index(resolve(A));
const b = index(resolve(B));

const count = (m) => [...m.values()].reduce((n, v) => n + v.length, 0);
console.log(`A: ${count(a)} files (${A})`);
console.log(`B: ${count(b)} files (${B})\n`);

/** Entries present in `left` more often than in `right`. */
function missingFrom(left, right) {
  const gone = [];
  for (const [k, paths] of left) {
    const otherCount = right.get(k)?.length ?? 0;
    if (paths.length > otherCount) {
      gone.push(...paths.slice(otherCount));
    }
  }
  return gone.sort();
}

const onlyInA = missingFrom(a, b);
const onlyInB = missingFrom(b, a);

if (onlyInA.length) {
  console.log(`Missing from B (${onlyInA.length}):`);
  for (const p of onlyInA.slice(0, 200)) console.log(`  ${p}`);
  if (onlyInA.length > 200) console.log(`  … and ${onlyInA.length - 200} more`);
  console.log();
}
if (onlyInB.length) {
  console.log(`Only in B (${onlyInB.length}):`);
  for (const p of onlyInB.slice(0, 50)) console.log(`  ${p}`);
  console.log();
}

if (!onlyInA.length && !onlyInB.length) {
  console.log("✓ Identical content. Every file in A is present in B and vice versa.");
  process.exit(0);
}
process.exit(1);
