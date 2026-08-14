// ---------------------------------------------------------------------------
// Workspace initialization
//
// Creates channel, series, and episode trees on the filesystem using the
// canonical layout.  Every init is idempotent: re-running init on an
// existing workspace preserves user edits to metadata and only fills in
// missing template files.
//
// Each workspace level gets:
//   <slug>/
//     .workspace/
//       contract.json    -- schema version marker (never overwritten)
//       metadata.json    -- user-editable metadata (never overwritten)
// ---------------------------------------------------------------------------

import type { FileSystem } from "../ports/filesystem.js";
import type { Clock } from "../ports/clock.js";
import type { Logger } from "../logging.js";
import type { Result } from "../result.js";
import { ok, err } from "../result.js";
import { alreadyExists, notFound, internalError } from "../errors.js";
import { join as joinPath } from "node:path";
import {
  SERIES_CONTAINER,
  EPISODES_CONTAINER,
  CHANNEL_KNOWLEDGE,
  SERIES_KNOWLEDGE,
} from "@studio/contracts/src/layout.mjs";
import type { RuntimeError } from "../errors.js";
// result helpers are used indirectly via returned Results
import { validateSlug } from "./slugs.js";
import { resolveGuardedPath } from "./path-guard.js";
import { createContract, serialiseContract } from "./contracts.js";
import { WORKSPACE_DIR, CONTRACT_FILE, METADATA_FILE } from "./types.js";
import type { WorkspaceKind, WorkspaceMeta } from "./types.js";

// ---- Init options ----------------------------------------------------------

/** Options shared by all init operations. */
export interface InitOptions {
  /** Filesystem port (required). */
  fs: FileSystem;
  /** Clock for timestamps (required). */
  clock: Clock;
  /** Logger for diagnostics (optional). */
  logger?: Logger;
}

/** Result returned by every init operation. */
export interface InitResult {
  /** Absolute path to the created workspace root. */
  path: string;
  /** Validated slug. */
  slug: string;
  /** Contract document that was written or already present. */
  contractPath: string;
  /** Whether the workspace already existed (idempotent re-init). */
  existed: boolean;
  /** Workspace kind. */
  kind: WorkspaceKind;
}

// ---- Channel ---------------------------------------------------------------

/**
 * Initialize a channel workspace under `libraryRoot`.
 *
 * Creates:
 *   <libraryRoot>/<slug>/.workspace/contract.json
 *   <libraryRoot>/<slug>/.workspace/metadata.json
 *
 * Idempotent: if the channel already exists and has a valid `.workspace/`,
 * only missing template files are written.
 */
export async function initChannel(
  libraryRoot: string,
  slugRaw: string,
  meta: Partial<WorkspaceMeta> = {},
  opts: InitOptions,
): Promise<Result<InitResult, RuntimeError>> {
  // 1. Validate slug
  const slugR = validateSlug(slugRaw);
  if (!slugR.ok) return slugR;

  return initWorkspace("channel", libraryRoot, slugR.value, meta, opts);
}

// ---- Series ----------------------------------------------------------------

/**
 * Initialize a series workspace under an existing channel.
 *
 * `channelPath` must be the absolute path to an existing channel workspace
 * (containing `.workspace/contract.json`).
 */
export async function initSeries(
  channelPath: string,
  slugRaw: string,
  meta: Partial<WorkspaceMeta> = {},
  opts: InitOptions,
): Promise<Result<InitResult, RuntimeError>> {
  // 1. Validate slug
  const slugR = validateSlug(slugRaw);
  if (!slugR.ok) return slugR;

  // 2. Verify channelPath exists and is a channel workspace
  const channelCheck = await verifyWorkspaceKind("channel", channelPath, opts.fs, opts.logger);
  if (!channelCheck.ok) return channelCheck;

  // Layout 2: series live inside the channel's `series/` container, never
  // loose in the channel directory next to its own knowledge folders.
  return initWorkspace(
    "series",
    joinPath(channelPath, SERIES_CONTAINER),
    slugR.value,
    meta,
    opts,
  );
}

// ---- Episode ---------------------------------------------------------------

/**
 * Initialize an episode workspace under an existing series.
 *
 * `seriesPath` must be the absolute path to an existing series workspace
 * (containing `.workspace/contract.json`).
 */
export async function initEpisode(
  seriesPath: string,
  slugRaw: string,
  meta: Partial<WorkspaceMeta> = {},
  opts: InitOptions,
): Promise<Result<InitResult, RuntimeError>> {
  // 1. Validate slug
  const slugR = validateSlug(slugRaw);
  if (!slugR.ok) return slugR;

  // 2. Verify seriesPath exists and is a series workspace
  const seriesCheck = await verifyWorkspaceKind("series", seriesPath, opts.fs, opts.logger);
  if (!seriesCheck.ok) return seriesCheck;

  // Layout 2: episodes live inside the series' `episodes/` container.
  return initWorkspace(
    "episode",
    joinPath(seriesPath, EPISODES_CONTAINER),
    slugR.value,
    meta,
    opts,
  );
}

// ---- Default channel convenience -------------------------------------------

/**
 * Default channel slug used when the caller does not specify a channel.
 *
 * This enables a "zero-config" flow where a single library root with
 * a default channel works out of the box.
 */
export const DEFAULT_CHANNEL_SLUG = "default";

/**
 * Ensure a default channel exists under `libraryRoot`.
 *
 * Idempotent: if the default channel already exists it is left untouched.
 * This is the recommended entry point for first-time setup.
 */
export async function ensureDefaultChannel(
  libraryRoot: string,
  opts: InitOptions,
): Promise<Result<InitResult, RuntimeError>> {
  return initChannel(libraryRoot, DEFAULT_CHANNEL_SLUG, {
    title: "Default Channel",
    description: "Auto-created default channel",
  }, opts);
}

// ---- Core init logic -------------------------------------------------------

async function initWorkspace(
  kind: WorkspaceKind,
  parentPath: string,
  slug: string,
  meta: Partial<WorkspaceMeta>,
  opts: InitOptions,
): Promise<Result<InitResult, RuntimeError>> {
  const log = opts.logger;

  // 1. Guard: path must resolve within the parent
  const pathR = await resolveGuardedPath(parentPath, slug, opts.fs);
  if (!pathR.ok) return pathR;

  const wsPath = pathR.value;
  const wsDir = `${wsPath}/${WORKSPACE_DIR}`;
  const contractPath = `${wsDir}/${CONTRACT_FILE}`;
  const metaPath = `${wsDir}/${METADATA_FILE}`;

  log?.debug(`Initializing ${kind} workspace at ${wsPath}`);

  // 2. Check for collision: only fail if the path exists but is NOT a
  //    valid workspace of the expected kind.
  const existsR = await opts.fs.exists(wsPath);
  if (!existsR.ok) return err(internalError("Failed to check existence", existsR.error));
  const existed = existsR.value;

  if (existed) {
    // Path exists. Verify it's the right kind.
    const verifyR = await verifyWorkspaceKind(kind, wsPath, opts.fs, log);
    if (!verifyR.ok) {
      // If the path has a contract of the wrong kind, propagate the specific error.
      // Otherwise it's a non-workspace path collision.
      if (verifyR.error.code === "E_ALREADY_EXISTS") {
        return verifyR;
      }
      return err(
        alreadyExists(
          `Path ${wsPath} already exists but is not a ${kind} workspace`,
          { path: wsPath, expectedKind: kind, reason: "path-collision" },
        ),
      );
    }

    // Idempotent: workspace exists and is valid. Preserve user edits.
    log?.info(`${kind} workspace already exists at ${wsPath}, preserving edits`);
    return ok({
      path: wsPath,
      slug,
      contractPath,
      existed: true,
      kind,
    });
  }

  // 3. Create workspace directory and .workspace/ subdirectory.
  const mkdirR = await opts.fs.mkdir(wsDir, true);
  if (!mkdirR.ok) {
    return err(internalError("Failed to create workspace directory", mkdirR.error));
  }

  // 4. Write contract document.
  const now = opts.clock.now().toISOString();
  const contract = createContract(kind, now);
  const contractJson = serialiseContract(contract);

  const writeContractR = await opts.fs.writeText(contractPath, contractJson);
  if (!writeContractR.ok) {
    // Best-effort cleanup: remove the directory we just created
    await opts.fs.removeDir(wsPath);
    return err(internalError("Failed to write contract document", writeContractR.error));
  }

  // 5. Write metadata template (user-editable, only written on first init).
  const metaDoc: WorkspaceMeta = {
    title: meta.title,
    description: meta.description,
    createdAt: now,
    updatedAt: now,
  };
  const metaJson = JSON.stringify(metaDoc, null, 2) + "\n";

  const writeMetaR = await opts.fs.writeText(metaPath, metaJson);
  if (!writeMetaR.ok) {
    // Contract was written; try to clean up both.
    await opts.fs.removeDir(wsPath);
    return err(internalError("Failed to write metadata file", writeMetaR.error));
  }

  log?.info(`Created ${kind} workspace at ${wsPath}`, { slug, kind, contractPath });

  // 6. Create canonical skeleton files and directories.
  await createSkeleton(kind, wsPath, slug, now, opts);

  return ok({
    path: wsPath,
    slug,
    contractPath,
    existed: false,
    kind,
  });
}

// ---- Helpers ---------------------------------------------------------------

/**
 * Verify that `wsPath` contains a `.workspace/contract.json` for the
 * expected kind.  Returns Ok(wsPath) on success, Err on mismatch.
 */
async function verifyWorkspaceKind(
  expectedKind: WorkspaceKind,
  wsPath: string,
  fs: FileSystem,
  logger?: Logger,
): Promise<Result<string, RuntimeError>> {
  const contractPath = `${wsPath}/${WORKSPACE_DIR}/${CONTRACT_FILE}`;

  const existsR = await fs.exists(contractPath);
  if (!existsR.ok) {
    return err(internalError("Failed to check contract existence", existsR.error));
  }
  if (!existsR.value) {
    logger?.debug(`No contract found at ${contractPath}`);
    return err(
      notFound(`Not a ${expectedKind} workspace: missing contract at ${contractPath}`, {
        path: wsPath,
        expectedKind,
        reason: "missing-contract",
      }),
    );
  }

  const readR = await fs.readText(contractPath);
  if (!readR.ok) {
    return err(internalError("Failed to read contract", readR.error));
  }

  const { parseContractJson, validateContractStructure } =
    await import("./contracts.js");

  const parsed = parseContractJson(readR.value);
  if ("parseError" in parsed) {
    return err(
      internalError(`Invalid contract JSON at ${contractPath}: ${parsed.parseError}`),
    );
  }

  const validation = validateContractStructure(parsed.value);
  if (!validation.valid || !validation.contract) {
    return err(
      internalError(
        `Invalid contract structure at ${contractPath}: ${validation.diagnostics.join("; ")}`,
      ),
    );
  }

  if (validation.contract.type !== expectedKind) {
    return err(
      alreadyExists(
        `Path ${wsPath} is a ${validation.contract.type} workspace, not a ${expectedKind}`,
        {
          path: wsPath,
          expectedKind,
          actualKind: validation.contract.type,
          reason: "kind-mismatch",
        },
      ),
    );
  }

  return ok(wsPath);
}

// ---- Canonical skeleton creation -------------------------------------------

async function createSkeleton(
  kind: WorkspaceKind,
  wsPath: string,
  slug: string,
  now: string,
  opts: InitOptions,
): Promise<void> {
  switch (kind) {
    case "channel":
      await createChannelSkeleton(wsPath, slug, now, opts);
      break;
    case "series":
      await createSeriesSkeleton(wsPath, slug, now, opts);
      break;
    case "episode":
      await createEpisodeSkeleton(wsPath, slug, now, opts);
      break;
  }
}

async function createChannelSkeleton(
  wsPath: string,
  slug: string,
  now: string,
  opts: InitOptions,
): Promise<void> {
  // channel.md with frontmatter
  await writeIfMissing(
    opts, `${wsPath}/channel.md`,
    `---
channelId: ${slug}
title: ${slug}
createdAt: ${now}
---\n`,
  );

  // settings.yaml
  await writeIfMissing(
    opts, `${wsPath}/settings.yaml`,
    `# Channel settings for ${slug}\n`,
  );

  // Channel knowledge, plus the explicit `series/` container.
  await makeDirs(opts, wsPath, [...CHANNEL_KNOWLEDGE, SERIES_CONTAINER]);
}

async function createSeriesSkeleton(
  wsPath: string,
  slug: string,
  now: string,
  opts: InitOptions,
): Promise<void> {
  // series.md with frontmatter
  await writeIfMissing(
    opts, `${wsPath}/series.md`,
    `---
seriesId: ${slug}
title: ${slug}
createdAt: ${now}
---\n`,
  );

  // settings.yaml
  await writeIfMissing(
    opts, `${wsPath}/settings.yaml`,
    `# Series settings for ${slug}\n`,
  );

  // visual-bible.md
  await writeIfMissing(
    opts, `${wsPath}/visual-bible.md`,
    `# Visual Bible for ${slug}\n`,
  );

  // Directories, including the explicit `episodes/` container that makes a
  // directory's role unambiguous (layout 2).
  await makeDirs(opts, wsPath, [...SERIES_KNOWLEDGE, EPISODES_CONTAINER]);
}

/** Create each directory under `wsPath`, ignoring ones that already exist. */
async function makeDirs(opts: InitOptions, wsPath: string, names: readonly string[]): Promise<void> {
  for (const name of names) {
    await opts.fs.mkdir(`${wsPath}/${name}`, true).catch(() => { /* idempotent */ });
  }
}

async function createEpisodeSkeleton(
  wsPath: string,
  slug: string,
  now: string,
  opts: InitOptions,
): Promise<void> {
  // episode.yaml
  await writeIfMissing(
    opts, `${wsPath}/episode.yaml`,
    `# Episode ${slug}\nslug: ${slug}\ncreatedAt: ${now}\n`,
  );

  // Directories
  const dirs = [
    `${wsPath}/source`,
    `${wsPath}/artifacts`,
    `${wsPath}/prompts`,
    `${wsPath}/assets/images`,
    `${wsPath}/assets/graphics`,
    `${wsPath}/assets/audio`,
    `${wsPath}/attempts`,
    `${wsPath}/reviews`,
    `${wsPath}/journal`,
    `${wsPath}/output`,
  ];
  for (const dir of dirs) {
    await opts.fs.mkdir(dir, true).catch(() => { /* idempotent — directory may exist */ });
  }

  // assets/manifest.json
  const manifest = {
    apiVersion: "v1alpha1",
    kind: "AssetManifest",
    assets: [] as unknown[],
  };
  await writeIfMissing(
    opts, `${wsPath}/assets/manifest.json`,
    JSON.stringify(manifest, null, 2) + "\n",
  );

  // reviews/threads.jsonl (empty)
  await writeIfMissing(opts, `${wsPath}/reviews/threads.jsonl`, "");

  // journal/events.jsonl (empty)
  await writeIfMissing(opts, `${wsPath}/journal/events.jsonl`, "");

  // output/current.json
  const current = {
    apiVersion: "v1alpha1",
    kind: "CurrentDeliverable",
    renderId: null,
  };
  await writeIfMissing(
    opts, `${wsPath}/output/current.json`,
    JSON.stringify(current, null, 2) + "\n",
  );
}

/** Write a file only if it does not already exist (idempotent). */
async function writeIfMissing(
  opts: InitOptions,
  filePath: string,
  content: string,
): Promise<void> {
  const existsR = await opts.fs.exists(filePath);
  if (existsR.ok && existsR.value) return; // already exists, skip
  await opts.fs.writeText(filePath, content);
}
