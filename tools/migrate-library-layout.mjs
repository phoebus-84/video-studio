#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Migrate a library from layout 1 to layout 2.
//
//   layout 1:  [channel]/[series]/[episode]
//   layout 2:  [channel]/series/[series]/episodes/[episode]
//
// Layout 1 could not distinguish a series from a channel-level support folder,
// so the gateway carried a denylist of names that are not series. Layout 2
// makes containment explicit and deletes that guesswork.
//
//   node tools/migrate-library-layout.mjs --library ./library --dry-run
//   node tools/migrate-library-layout.mjs --library ./library
//
// Moves are `rename` within one filesystem, so no media is copied or rewritten.
// Every step is printed. Nothing is deleted: migration only ever moves
// directories deeper into the tree, and --dry-run shows the full plan first.
// ---------------------------------------------------------------------------

import { readdirSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  SERIES_CONTAINER,
  EPISODES_CONTAINER,
  CHANNEL_KNOWLEDGE,
  LEGACY_SERIES_SUPPORT_DIRECTORIES,
  isLayout2Channel,
} from "@studio/contracts/src/layout.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const libraryArg = args.find((a) => a.startsWith("--library="))
  ?? (args.includes("--library") ? args[args.indexOf("--library") + 1] : null);

if (!libraryArg) {
  console.error("usage: migrate-library-layout.mjs --library <path> [--dry-run]");
  process.exit(2);
}

const LIBRARY = resolve(libraryArg);
if (!existsSync(LIBRARY)) {
  console.error(`No library at ${LIBRARY}`);
  process.exit(2);
}

const SUPPORT = new Set(LEGACY_SERIES_SUPPORT_DIRECTORIES);
/** Channel-level files and folders that must never be mistaken for a series. */
const CHANNEL_OWN = new Set([...CHANNEL_KNOWLEDGE, ".workspace", "_media", "_exports"]);

/**
 * Directory names at a level. Dot-prefixed entries are metadata and
 * underscore-prefixed entries are reserved holding areas (_media, _exports);
 * neither is ever content.
 */
const dirs = (p) => {
  try {
    return readdirSync(p, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("_"))
      .map((e) => e.name);
  } catch {
    return [];
  }
};

const plan = [];

for (const channel of dirs(LIBRARY)) {
  const channelDir = join(LIBRARY, channel);
  const entries = dirs(channelDir);

  if (isLayout2Channel(entries)) {
    console.log(`· ${channel}: already layout 2, skipping`);
    continue;
  }

  // Anything that is not a known channel-level folder is a series.
  const series = entries.filter((n) => !SUPPORT.has(n) && !CHANNEL_OWN.has(n));
  const kept = entries.filter((n) => SUPPORT.has(n) || CHANNEL_OWN.has(n));

  if (kept.length) {
    console.log(`· ${channel}: keeping at channel level → ${kept.join(", ")}`);
  }

  for (const s of series) {
    const from = join(channelDir, s);
    const to = join(channelDir, SERIES_CONTAINER, s);
    plan.push({ from, to, kind: "series", label: `${channel}/${s}` });

    // Episodes are every directory inside the series that is not itself a
    // series-level support folder.
    const episodes = dirs(from).filter((n) => !SUPPORT.has(n) && n !== EPISODES_CONTAINER);
    for (const e of episodes) {
      plan.push({
        from: join(to, e),
        to: join(to, EPISODES_CONTAINER, e),
        kind: "episode",
        label: `${channel}/${s}/${e}`,
        after: true, // depends on the series move landing first
      });
    }
  }
}

if (plan.length === 0) {
  console.log("\nNothing to migrate.");
  process.exit(0);
}

console.log(`\n${plan.length} move(s):\n`);
for (const m of plan) {
  console.log(`  ${m.kind.padEnd(7)} ${m.label}`);
}

/**
 * Every file under a directory, with its size. Used to prove the migration is
 * conservative: moving directories must not change the set of files at all.
 */
function inventory(dir) {
  const found = new Map();
  const walk = (d, rel = "") => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      const key = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(full, key);
      else if (e.isFile()) {
        try {
          found.set(key, statSync(full).size);
        } catch { /* vanished mid-walk */ }
      }
    }
  };
  walk(dir);
  return found;
}

if (dryRun) {
  console.log("\n--dry-run: nothing was moved.");
  process.exit(0);
}

// Inventory before, so the result can be checked rather than trusted.
const before = inventory(LIBRARY);
console.log(`\nBefore: ${before.size} files, ${[...before.values()].reduce((a, b) => a + b, 0)} bytes`);

console.log("\nMigrating…");

// Series first, then episodes, because episode targets live inside the moved
// series directory.
for (const m of plan.filter((x) => !x.after)) {
  mkdirSync(join(m.to, ".."), { recursive: true });
  renameSync(m.from, m.to);
  console.log(`  moved ${m.label}`);
}
for (const m of plan.filter((x) => x.after)) {
  if (!existsSync(m.from)) continue;
  mkdirSync(join(m.to, ".."), { recursive: true });
  renameSync(m.from, m.to);
  console.log(`  moved ${m.label}`);
}

// ── Integrity check ────────────────────────────────────────────────────────
// A migration only relocates directories, so the multiset of file sizes must
// be identical afterwards. Paths change; content must not.
const after = inventory(LIBRARY);

const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
const beforeBytes = sum(before);
const afterBytes = sum(after);

console.log(`After:  ${after.size} files, ${afterBytes} bytes`);

if (after.size !== before.size || afterBytes !== beforeBytes) {
  console.error(
    `\n✗ INTEGRITY CHECK FAILED\n` +
      `  files: ${before.size} -> ${after.size}\n` +
      `  bytes: ${beforeBytes} -> ${afterBytes}\n` +
      `\nThe migration must never change what is on disk, only where it lives.\n` +
      `Restore from backup and report this.`,
  );

  // Name what went missing, by basename, so it can be found in a backup.
  const beforeNames = new Map();
  for (const [p, s] of before) beforeNames.set(`${p.split("/").pop()}:${s}`, p);
  for (const [p, s] of after) beforeNames.delete(`${p.split("/").pop()}:${s}`);
  if (beforeNames.size) {
    console.error(`\nUnaccounted for (${beforeNames.size}):`);
    for (const p of [...beforeNames.values()].slice(0, 40)) console.error(`  ${p}`);
  }
  process.exit(1);
}

console.log("✓ Integrity check passed: same files, same bytes, new locations.");
console.log("\n✓ Migration complete.");
