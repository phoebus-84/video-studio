#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Give every episode one manifest, and the declared tree around it.
//
//   node tools/migrate-episode-manifests.mjs --library ./library --dry-run
//   node tools/migrate-episode-manifests.mjs --library ./library
//
// Best effort by design. An episode that migrates cleanly is migrated; one
// whose manifests disagree, or whose episode.yaml/episode.json will not parse,
// is printed with its reason and left as it was. A skip is a normal outcome
// and does not change the exit code.
//
// Three manifest states are handled, because a library that predates this
// contract holds all three:
//
//   absent            -> written fresh, folding in episode.json
//   legacy            -> parses, but has no apiVersion/kind: re-rendered
//                        through the contract, preserving every value it
//                        already holds. This is the common case — every
//                        episode.yaml the old creators wrote is legacy, and
//                        every one of them fails `vpr doctor` until upgraded.
//   already conforming -> left completely alone, no action recorded
//
// Nothing this tool writes is trusted on the way out: the rendered manifest is
// parsed back and validated against `EpisodeManifest` before it touches the
// disk. A channel or series directory whose name is not a valid slug produces
// an invalid manifest, and writing it would hand `doctor` a file this tool had
// already reported as migrated.
//
// Nothing is deleted. `library/` is gitignored, so a deleted file is gone for
// good — the retired episode.json is renamed, never removed. If a retirement
// would overwrite an already-retired file (a second episode.json turning up
// after a prior migration), the episode is skipped instead: overwriting the
// first retired copy would destroy it just as surely as deleting it would.
// ---------------------------------------------------------------------------

import { readdir, readFile, writeFile, mkdir, rename, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { load as loadYaml } from "js-yaml";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  SERIES_CONTAINER,
  EPISODES_CONTAINER,
  EPISODE_DIRECTORIES,
  EPISODE_SEED_FILES,
  WORKSPACE_DIR,
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

// ── The manifest validator ──────────────────────────────────────────────────
//
// The same schema, loaded the same way, as `runtime/src/workspace/doctor.ts`.
// A manifest this tool writes and the manifest `doctor` accepts have to be the
// same document, so they are checked against the same definition rather than
// against two hand-kept ideas of it. `workspace.schema.json` $refs
// `identity.schema.json`, so both are registered.
const schemaJson = async (name) =>
  JSON.parse(await readFile(
    new URL(`../studio/contracts/schemas/v1alpha1/${name}`, import.meta.url), "utf-8"));
const workspaceSchema = await schemaJson("workspace.schema.json");
const identitySchema = await schemaJson("identity.schema.json");
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
ajv.addSchema(identitySchema);
ajv.addSchema(workspaceSchema);
const validateEpisodeManifest = ajv.getSchema(`${workspaceSchema.$id}#/$defs/EpisodeManifest`);

/**
 * Validate a rendered manifest by reading it back the way `doctor` will.
 * Returns null when it conforms, or a human-readable reason when it does not.
 */
function manifestRejection(rendered) {
  let parsed;
  try {
    parsed = loadYaml(rendered);
  } catch (error) {
    return `the rendered manifest will not parse: ${error.message}`;
  }
  if (!validateEpisodeManifest(parsed)) {
    const detail = (validateEpisodeManifest.errors ?? [])
      .map((err) => `${err.instancePath || "/"} ${err.message}`)
      .join("; ");
    return `the rendered manifest does not match the contract: ${detail}`;
  }
  return null;
}

// ── The workspace contract ──────────────────────────────────────────────────
//
// `.workspace/contract.json` is what marks a directory as an episode workspace,
// and `doctor.checkLevel` early-returns with a *warning* when it is missing —
// so an episode without one is never checked at all, and this tool would be
// reporting manifests as migrated that nothing has looked at. The shapes and
// constants below mirror `runtime/src/workspace/contracts.ts` and
// `runtime/src/workspace/init.ts`; that module is TypeScript and this tool
// runs as plain node, which is the only reason they are restated here.
const CONTRACT_FILE = "contract.json";
const METADATA_FILE = "metadata.json";
const CONTRACT_SCHEMA = "video-workspace-contracts/workspace-v1";
const CONTRACT_VERSION = "0.1.0";

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

/** A field's value only when it is a non-empty string; otherwise undefined. */
function text(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

const plan = [];
const skipped = [];

async function migrateEpisode(dir, channel, series, slug) {
  const name = `${channel}/${series}/${slug}`;
  const yamlPath = join(dir, EPISODE_MANIFEST_FILE);
  const jsonPath = join(dir, "episode.json");
  const retiredPath = join(dir, ".episode.json.migrated");
  const hasYaml = await exists(yamlPath);
  const hasJson = await exists(jsonPath);

  let json = null;
  if (hasJson) {
    try {
      json = JSON.parse(await readFile(jsonPath, "utf-8"));
    } catch (error) {
      skipped.push([name, `episode.json will not parse: ${error.message}`]);
      return;
    }
  }

  // The existing manifest, read as a document rather than scraped with a
  // regex. The old creator wrote `title:` unquoted, so a legacy title holding
  // a colon does not parse — that is a fact about the file, and guessing past
  // it would be inventing one.
  let existing;
  if (hasYaml) {
    const raw = await readFile(yamlPath, "utf-8");
    try {
      const parsed = loadYaml(raw);
      // A document of nothing but comments parses to undefined. It holds no
      // values to preserve, which makes it a legacy manifest with every field
      // absent rather than a parse failure.
      existing = (parsed !== null && typeof parsed === "object") ? parsed : {};
    } catch (error) {
      skipped.push([name, `${EPISODE_MANIFEST_FILE} will not parse: ${error.message}`]);
      return;
    }
  }

  // A prior migration already retired one episode.json under this exact
  // name. Renaming a second one on top of it would silently destroy the
  // first — `rename` overwrites without complaint — so this is never safe
  // to do quietly. A human has to look: two generations of episode.json
  // under one directory is a fact about the library, not something this
  // tool gets to resolve by picking a winner.
  if (hasJson && (await exists(retiredPath))) {
    skipped.push([
      name,
      `episode.json would overwrite the already-retired .episode.json.migrated — left both in place`,
    ]);
    return;
  }

  // Both present: only safe when they agree. Guessing which title a person
  // meant is the inference this whole change exists to remove.
  if (existing && json) {
    const existingTitle = text(existing.title);
    if (existingTitle && json.title && existingTitle !== json.title) {
      skipped.push([
        name,
        `${EPISODE_MANIFEST_FILE} says title ${JSON.stringify(existingTitle)}, episode.json says ${JSON.stringify(json.title)}`,
      ]);
      return;
    }
  }

  // A manifest that already declares its apiVersion and kind conforms to the
  // contract this migration exists to establish. It is not re-rendered, not
  // reformatted, and not recorded: an action line for a file nothing touched
  // would be the tool reporting something other than what it did.
  const conforming = existing !== undefined
    && text(existing.apiVersion) !== undefined
    && text(existing.kind) !== undefined;

  let title;
  let description;

  if (!conforming) {
    const fields = existing === undefined
      ? {
        // No manifest at all. The directory name is the slug, and the title is
        // seeded from it so a human has somewhere to start.
        slug,
        channel,
        series,
        title: text(json?.title) ?? titleFromSlug(slug),
        description: text(json?.description),
        // No createdAt: these episodes have no recorded creation time, and a
        // derived one would be a fabricated fact in an authoritative file.
        createdAt: undefined,
      }
      : {
        // A legacy manifest. Every value it holds is carried over verbatim —
        // its createdAt above all, which is the one record of when the episode
        // was made and cannot be reconstructed from anything else. No title is
        // derived here: unlike a fresh write, this file was authored, and
        // adding a field its author left out would be inventing content.
        slug: text(existing.slug) ?? slug,
        channel,
        series,
        title: text(existing.title) ?? text(json?.title),
        description: text(existing.description) ?? text(json?.description),
        createdAt: text(existing.createdAt),
      };

    const manifest = renderEpisodeManifest(fields);
    const rejection = manifestRejection(manifest);
    if (rejection) {
      skipped.push([name, rejection]);
      return;
    }

    title = fields.title;
    description = fields.description;
    plan.push([
      existing === undefined ? `write ${EPISODE_MANIFEST_FILE}` : `upgrade ${EPISODE_MANIFEST_FILE}`,
      yamlPath,
    ]);
    if (!dryRun) await writeFile(yamlPath, manifest, "utf-8");
  } else {
    title = text(existing.title) ?? text(json?.title);
    description = text(existing.description) ?? text(json?.description);
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

  await ensureWorkspace(dir, title, description);

  if (hasJson) {
    plan.push(["retire episode.json", retiredPath]);
    if (!dryRun) await rename(jsonPath, retiredPath);
  }
}

/**
 * Create `.workspace/contract.json` and `.workspace/metadata.json` when they
 * are absent, matching what `initWorkspace` writes. Neither is ever
 * overwritten: `metadata.json` is user-editable, and `contract.json` carries
 * the episode's real creation time when one was recorded.
 */
async function ensureWorkspace(dir, title, description) {
  const wsDir = join(dir, WORKSPACE_DIR);
  const contractPath = join(wsDir, CONTRACT_FILE);
  const metadataPath = join(wsDir, METADATA_FILE);
  const missingContract = !(await exists(contractPath));
  const missingMetadata = !(await exists(metadataPath));
  if (!missingContract && !missingMetadata) return;

  // Now, not the episode's creation time. These two documents are being
  // written at this moment, and that is what the timestamps record. The
  // episode's own creation time lives in `episode.yaml` when it is known at
  // all; copying it here would have the contract claim it was written on a day
  // it did not exist, and deriving one from a directory's mtime would be worse.
  const now = new Date().toISOString();

  if (missingContract) {
    const contract = {
      schema: CONTRACT_SCHEMA,
      version: CONTRACT_VERSION,
      type: "episode",
      createdAt: now,
      updatedAt: now,
    };
    plan.push([`write ${WORKSPACE_DIR}/${CONTRACT_FILE}`, contractPath]);
    if (!dryRun) {
      await mkdir(wsDir, { recursive: true });
      await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`, "utf-8");
    }
  }

  if (missingMetadata) {
    // An unknown title is omitted, never written as "". A metadata file
    // claiming an empty title asserts something nobody holds.
    const metadata = { title, description, createdAt: now, updatedAt: now };
    for (const key of ["title", "description"]) {
      if (metadata[key] === undefined) delete metadata[key];
    }
    plan.push([`write ${WORKSPACE_DIR}/${METADATA_FILE}`, metadataPath]);
    if (!dryRun) {
      await mkdir(wsDir, { recursive: true });
      await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
    }
  }
}

// The plan is printed in a `finally` so that a failure anywhere still reports
// what was done. `library/` is gitignored: a half-migrated tree with no record
// of which half cannot be diffed against anything.
try {
  for (const channel of await listDirs(LIBRARY)) {
    for (const series of await listDirs(join(LIBRARY, channel, SERIES_CONTAINER))) {
      const episodesDir = join(LIBRARY, channel, SERIES_CONTAINER, series, EPISODES_CONTAINER);
      for (const slug of await listDirs(episodesDir)) {
        try {
          await migrateEpisode(join(episodesDir, slug), channel, series, slug);
        } catch (error) {
          // One unexpected episode — a file where a directory was expected, a
          // permission the tool does not have — is that episode's problem. The
          // rest of the library still migrates, and the reason is recorded.
          skipped.push([
            `${channel}/${series}/${slug}`,
            `migration stopped part-way: ${error.message} (any steps listed above for it were applied)`,
          ]);
        }
      }
    }
  }
} finally {
  for (const [action, target] of plan) {
    console.log(`${dryRun ? "[dry-run] " : ""}${action}: ${target.slice(LIBRARY.length + 1)}`);
  }
  if (skipped.length > 0) {
    console.log(`\nskipped ${skipped.length} episode(s):`);
    for (const [name, why] of skipped) console.log(`  ${name} — ${why}`);
  }
  console.log(`\n${dryRun ? "would change" : "changed"} ${plan.length} path(s); skipped ${skipped.length} episode(s).`);
}
