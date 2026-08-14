// ---------------------------------------------------------------------------
// Workspace discovery
//
// Scans configured library roots and discovers channel, series, and episode
// workspaces.  Malformed or untrusted paths are skipped and reported as
// diagnostics; the scan continues.
// ---------------------------------------------------------------------------

import type { FileSystem } from "../ports/filesystem.js";
import type { Logger } from "../logging.js";
import { join as joinPath } from "node:path";
import { SERIES_CONTAINER, EPISODES_CONTAINER } from "@studio/contracts/src/layout.mjs";
import type { Result } from "../result.js";
import { ok, err } from "../result.js";
import { internalError } from "../errors.js";
import type { RuntimeError } from "../errors.js";
import { guardPath, validateRootPath } from "./path-guard.js";
import { parseContractJson, validateContractStructure } from "./contracts.js";
import { WORKSPACE_DIR, CONTRACT_FILE } from "./types.js";
import type { WorkspaceDescriptor, WorkspaceKind } from "./types.js";

// ---- Discovery result types ------------------------------------------------

/** Aggregate result of a discovery scan. */
export interface DiscoveryResult {
  /** Successfully discovered workspaces. */
  workspaces: WorkspaceDescriptor[];
  /** Diagnostics for skipped paths (malformed, untrusted, etc.). */
  diagnostics: DiscoveryDiagnostic[];
}

/** A single diagnostic produced during discovery. */
export interface DiscoveryDiagnostic {
  /** Absolute path that was skipped. */
  path: string;
  /** Machine-readable reason code. */
  reason: DiscoveryDiagnosticCode;
  /** Human-readable message. */
  message: string;
}

/** Machine-readable diagnostic codes for discovery issues. */
export type DiscoveryDiagnosticCode =
  | "missing-contract"
  | "invalid-contract-json"
  | "invalid-contract-structure"
  | "untrusted-path"
  | "not-a-directory"
  | "read-error"
  | "permission-denied";

// ---- Public API ------------------------------------------------------------

/**
 * Discover channel workspaces under a library root.
 *
 * Scans immediate children of `libraryRoot`.  Subdirectories that contain
 * `.workspace/contract.json` with `type: "channel"` are returned as
 * channel workspaces.  Everything else is added to diagnostics.
 */
export async function discoverChannels(
  libraryRoot: string,
  fs: FileSystem,
  logger?: Logger,
): Promise<Result<DiscoveryResult, RuntimeError>> {
  return discover("channel", libraryRoot, fs, logger);
}

/**
 * Discover series workspaces under a channel.
 *
 * Scans `<channelPath>/series`. Subdirectories that contain
 * `.workspace/contract.json` with `type: "series"` are returned.
 */
export async function discoverSeries(
  channelPath: string,
  fs: FileSystem,
  logger?: Logger,
): Promise<Result<DiscoveryResult, RuntimeError>> {
  return discover("series", joinPath(channelPath, SERIES_CONTAINER), fs, logger);
}

/**
 * Discover episode workspaces under a series.
 *
 * Scans `<seriesPath>/episodes`. Subdirectories that contain
 * `.workspace/contract.json` with `type: "episode"` are returned.
 */
export async function discoverEpisodes(
  seriesPath: string,
  fs: FileSystem,
  logger?: Logger,
): Promise<Result<DiscoveryResult, RuntimeError>> {
  return discover("episode", joinPath(seriesPath, EPISODES_CONTAINER), fs, logger);
}

// ---- Core discovery logic --------------------------------------------------

async function discover(
  kind: WorkspaceKind,
  parentPath: string,
  fs: FileSystem,
  logger?: Logger,
): Promise<Result<DiscoveryResult, RuntimeError>> {
  const workspaces: WorkspaceDescriptor[] = [];
  const diagnostics: DiscoveryDiagnostic[] = [];

  // 1. Validate and guard the parent path.
  const rootR = validateRootPath(parentPath);
  if (!rootR.ok) return rootR;

  const guardedR = await guardPath(rootR.value, ".", fs);
  if (!guardedR.ok) {
    return err(
      internalError(`Cannot access library root: ${guardedR.error.message}`, guardedR.error),
    );
  }

  const normalisedRoot = guardedR.value;

  // 2. Verify the parent exists and is a directory.
  const parentStatR = await fs.stat(normalisedRoot);
  if (!parentStatR.ok) {
    return err(internalError(`Cannot stat library root: ${parentStatR.error.message}`, parentStatR.error));
  }
  if (!parentStatR.value.isDirectory) {
    return err(
      internalError(`Library root is not a directory: ${normalisedRoot}`),
    );
  }

  // 3. List immediate children.
  const childrenR = await fs.readDir(normalisedRoot);
  if (!childrenR.ok) {
    return err(internalError(`Cannot read library root: ${childrenR.error.message}`, childrenR.error));
  }

  logger?.debug(`Discovering ${kind} workspaces under ${normalisedRoot}`, {
    childrenCount: childrenR.value.length,
  });

  // 4. Scan each child.
  for (const childName of childrenR.value) {
    // Skip hidden entries (including .workspace which is internal metadata)
    if (childName.startsWith(".")) {
      continue;
    }

    const childPath = `${normalisedRoot}/${childName}`;

    // Guard the child path against traversal.
    const childGuardedR = await guardPath(normalisedRoot, childName, fs);
    if (!childGuardedR.ok) {
      diagnostics.push({
        path: childPath,
        reason: "untrusted-path",
        message: childGuardedR.error.message,
      });
      logger?.warn(`Skipping untrusted path: ${childPath}`, {
        reason: childGuardedR.error.message,
      });
      continue;
    }

    // Stat the child: must be a directory.
    const childStatR = await fs.stat(childGuardedR.value);
    if (!childStatR.ok) {
      diagnostics.push({
        path: childPath,
        reason: "read-error",
        message: childStatR.error.message,
      });
      continue;
    }
    if (!childStatR.value.isDirectory) {
      // Not a directory – skip silently (files at this level are ignored).
      continue;
    }

    // Check for .workspace/contract.json
    const contractPath = `${childGuardedR.value}/${WORKSPACE_DIR}/${CONTRACT_FILE}`;
    const contractExistsR = await fs.exists(contractPath);
    if (!contractExistsR.ok || !contractExistsR.value) {
      diagnostics.push({
        path: childPath,
        reason: "missing-contract",
        message: `No ${WORKSPACE_DIR}/${CONTRACT_FILE} found`,
      });
      continue;
    }

    // Read and parse contract.
    const contractReadR = await fs.readText(contractPath);
    if (!contractReadR.ok) {
      diagnostics.push({
        path: childPath,
        reason: "read-error",
        message: contractReadR.error.message,
      });
      continue;
    }

    const parsed = parseContractJson(contractReadR.value);
    if ("parseError" in parsed) {
      diagnostics.push({
        path: childPath,
        reason: "invalid-contract-json",
        message: parsed.parseError,
      });
      logger?.warn(`Skipping ${childPath}: ${parsed.parseError}`);
      continue;
    }

    const validation = validateContractStructure(parsed.value);
    if (!validation.valid || !validation.contract) {
      diagnostics.push({
        path: childPath,
        reason: "invalid-contract-structure",
        message: validation.diagnostics.join("; "),
      });
      logger?.warn(`Skipping ${childPath}: ${validation.diagnostics.join("; ")}`);
      continue;
    }

    const contract = validation.contract;

    // Check kind match.
    if (contract.type !== kind) {
      diagnostics.push({
        path: childPath,
        reason: "invalid-contract-structure",
        message: `Expected ${kind} workspace but contract type is ${contract.type}`,
      });
      continue;
    }

    // Success: this is a valid workspace.
    workspaces.push({
      kind: contract.type as WorkspaceKind,
      path: childGuardedR.value,
      slug: childName,
      schema: contract.schema,
      schemaVersion: contract.version,
    });

    logger?.debug(`Discovered ${kind} workspace: ${childName}`, {
      path: childGuardedR.value,
      schema: contract.schema,
      version: contract.version,
    });
  }

  logger?.info(
    `Discovered ${workspaces.length} ${kind} workspace(s) under ${normalisedRoot}`,
    { diagnosticCount: diagnostics.length },
  );

  return ok({ workspaces, diagnostics });
}
