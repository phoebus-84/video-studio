#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Give every episode one manifest, and the declared tree around it.
//
//   node tools/migrate-episode-manifests.mjs --library ./library --dry-run
//   node tools/migrate-episode-manifests.mjs --library ./library
//
// Best effort by design. An episode that migrates cleanly is migrated; one
// whose manifests disagree, or whose episode.json will not parse, is printed
// with its reason and left exactly as it was. A skip is a normal outcome and
// does not change the exit code.
//
// Nothing is deleted. `library/` is gitignored, so a deleted file is gone for
// good — the retired episode.json is renamed, never removed.
// ---------------------------------------------------------------------------

import { readdir, readFile, writeFile, mkdir, rename, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  SERIES_CONTAINER,
  EPISODES_CONTAINER,
  EPISODE_DIRECTORIES,
  EPISODE_SEED_FILES,
} from "../studio/contracts/src/layout.mjs";
import {
  EPISODE_MANIFEST_FILE,
  renderEpisodeManifest,
} from "../studio/contracts/src/episode-manifest.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const libraryArg = args.find((a) => a.startsWith("--library="))?.slice("--library=".length)
  ?? (args.includes("--library") ? args[args.indexOf("--library") + 1] : undefined);
if (!libraryArg) {
  console.error("usage: migrate-episode-manifests.mjs --library <path> [--dry-run]");
  process.exit(2);
}
const LIBRARY = resolve(libraryArg);

const exists = (p) => access(p).then(() => true, () => false);
const listDirs = async (p) =>
  (await readdir(p, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name);

/** "giulio-cesare" -> "Giulio Cesare". Only ever a starting point for a human. */
function titleFromSlug(slug) {
  return slug.split("-").filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

const plan = [];
const skipped = [];

async function migrateEpisode(dir, channel, series, slug) {
  const yamlPath = join(dir, EPISODE_MANIFEST_FILE);
  const jsonPath = join(dir, "episode.json");
  const hasYaml = await exists(yamlPath);
  const hasJson = await exists(jsonPath);

  let json = null;
  if (hasJson) {
    try {
      json = JSON.parse(await readFile(jsonPath, "utf-8"));
    } catch (error) {
      skipped.push([`${channel}/${series}/${slug}`, `episode.json will not parse: ${error.message}`]);
      return;
    }
  }

  // Both present: only safe when they agree. Guessing which title a person
  // meant is the inference this whole change exists to remove.
  if (hasYaml && json) {
    const existing = await readFile(yamlPath, "utf-8");
    const titleLine = existing.match(/^title:\s*(.+)$/m);
    const existingTitle = titleLine ? titleLine[1].trim().replace(/^"|"$/g, "") : undefined;
    if (existingTitle && json.title && existingTitle !== json.title) {
      skipped.push([
        `${channel}/${series}/${slug}`,
        `episode.yaml says title ${JSON.stringify(existingTitle)}, episode.json says ${JSON.stringify(json.title)}`,
      ]);
      return;
    }
  }

  if (!hasYaml) {
    const manifest = renderEpisodeManifest({
      slug,
      channel,
      series,
      title: json?.title || titleFromSlug(slug),
      description: json?.description || undefined,
      // No createdAt: these episodes have no recorded creation time, and a
      // derived one would be a fabricated fact in an authoritative file.
      createdAt: undefined,
    });
    plan.push([`write ${EPISODE_MANIFEST_FILE}`, yamlPath]);
    if (!dryRun) await writeFile(yamlPath, manifest, "utf-8");
  }

  for (const relative of EPISODE_DIRECTORIES) {
    const target = join(dir, relative);
    if (await exists(target)) continue;
    plan.push(["mkdir", target]);
    if (!dryRun) await mkdir(target, { recursive: true });
  }

  for (const [relative, content] of Object.entries(EPISODE_SEED_FILES)) {
    const target = join(dir, relative);
    if (await exists(target)) continue;
    plan.push(["seed", target]);
    if (!dryRun) await writeFile(target, content, "utf-8");
  }

  if (hasJson) {
    const retired = join(dir, ".episode.json.migrated");
    plan.push(["retire episode.json", retired]);
    if (!dryRun) await rename(jsonPath, retired);
  }
}

for (const channel of await listDirs(LIBRARY)) {
  for (const series of await listDirs(join(LIBRARY, channel, SERIES_CONTAINER))) {
    const episodesDir = join(LIBRARY, channel, SERIES_CONTAINER, series, EPISODES_CONTAINER);
    for (const slug of await listDirs(episodesDir)) {
      await migrateEpisode(join(episodesDir, slug), channel, series, slug);
    }
  }
}

for (const [action, target] of plan) {
  console.log(`${dryRun ? "[dry-run] " : ""}${action}: ${target.slice(LIBRARY.length + 1)}`);
}
if (skipped.length > 0) {
  console.log(`\nskipped ${skipped.length} episode(s), left exactly as they were:`);
  for (const [name, why] of skipped) console.log(`  ${name} — ${why}`);
}
console.log(`\n${dryRun ? "would change" : "changed"} ${plan.length} path(s); skipped ${skipped.length} episode(s).`);
