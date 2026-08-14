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

if (dryRun) {
  console.log("\n--dry-run: nothing was moved.");
  process.exit(0);
}

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

console.log("\n✓ Migration complete.");
