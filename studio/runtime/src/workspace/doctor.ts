// ---------------------------------------------------------------------------
// Workspace doctor — validate on-disk workspace against canonical tree
// ---------------------------------------------------------------------------

import type { FileSystem } from "../ports/filesystem.js";
import { TREE_BY_KIND } from "./tree.js";
import { SERIES_CONTAINER, EPISODES_CONTAINER } from "@studio/contracts/src/layout.mjs";
import type { WorkspaceKind } from "./types.js";

// ---- Types -----------------------------------------------------------------

export interface DoctorFinding {
  level: WorkspaceKind;
  path: string;
  code: string;
  message: string;
}

export interface DoctorReport {
  ok: boolean;
  findings: DoctorFinding[];
}

// ---- Public API ------------------------------------------------------------

export interface DoctorOptions {
  fs: FileSystem;
  /** Absolute path to the library root. */
  libraryRoot: string;
  /** Optional: only check this channel (slug). */
  channel?: string;
  /** Optional: only check this series (slug, requires channel). */
  series?: string;
  /** Optional: only check this episode (slug, requires series). */
  episode?: string;
}

/**
 * Run workspace validation from the library root downward.
 *
 * Returns a report with zero or more findings.  `ok` is true when no
 * finding has a code prefixed with `"E_"` (error-level).
 */
export async function doctor(opts: DoctorOptions): Promise<DoctorReport> {
  const findings: DoctorFinding[] = [];

  // 1. Check library root exists
  const libExists = await opts.fs.exists(opts.libraryRoot);
  if (!libExists.ok || !libExists.value) {
    return {
      ok: false,
      findings: [{ level: "channel", path: opts.libraryRoot, code: "E_LIBRARY_MISSING", message: "Library root does not exist" }],
    };
  }

  // 2. Discover channels (or use explicit)
  const channels = opts.channel
    ? [opts.channel]
    : await listDirs(opts.fs, opts.libraryRoot);

  for (const channelSlug of channels) {
    const channelPath = `${opts.libraryRoot}/${channelSlug}`;
    await checkLevel(opts.fs, channelPath, "channel", findings);

    // Layout 2: descend through the explicit containers, so a channel's own
    // knowledge folders are never mistaken for series, nor a series for an
    // episode.
    const seriesRoot = `${channelPath}/${SERIES_CONTAINER}`;

    if (opts.series !== undefined) {
      // Specific series requested
      const seriesPath = `${seriesRoot}/${opts.series}`;
      await checkLevel(opts.fs, seriesPath, "series", findings);

      if (opts.episode !== undefined) {
        // Specific episode requested
        const episodePath = `${seriesPath}/${EPISODES_CONTAINER}/${opts.episode}`;
        await checkLevel(opts.fs, episodePath, "episode", findings);
      }
      // else: channel + series only — stop here
    } else if (opts.channel === undefined) {
      // No filters at all — discover and check everything
      const seriesList = await listDirs(opts.fs, seriesRoot);
      for (const seriesSlug of seriesList) {
        const seriesPath = `${seriesRoot}/${seriesSlug}`;
        await checkLevel(opts.fs, seriesPath, "series", findings);

        const episodeList = await listDirs(opts.fs, `${seriesPath}/${EPISODES_CONTAINER}`);
        for (const episodeSlug of episodeList) {
          const episodePath = `${seriesPath}/${EPISODES_CONTAINER}/${episodeSlug}`;
          await checkLevel(opts.fs, episodePath, "episode", findings);
        }
      }
    }
    // else: only channel filtered — stop at channel level
  }

  const ok = !findings.some((f) => f.code.startsWith("E_"));
  return { ok, findings };
}

// ---- Level check -----------------------------------------------------------

async function checkLevel(
  fs: FileSystem,
  wsPath: string,
  kind: WorkspaceKind,
  findings: DoctorFinding[],
): Promise<void> {
  // Check if this path exists and is a valid workspace
  const contractPath = `${wsPath}/.workspace/contract.json`;
  const contractExists = await fs.exists(contractPath);
  if (!contractExists.ok || !contractExists.value) {
    // Not a workspace — skip (might be a non-workspace directory)
    // Only report if it sort of looks like a workspace
    const wsExists = await fs.exists(wsPath);
    if (wsExists.ok && wsExists.value) {
      // It exists but no contract — warn
      findings.push({
        level: kind,
        path: wsPath,
        code: "W_MISSING_CONTRACT",
        message: `Directory exists but ${kind} workspace contract not found`,
      });
    }
    return;
  }

  // Check required tree
  const tree = TREE_BY_KIND[kind];
  for (const relPath of tree) {
    const fullPath = `${wsPath}/${relPath}`;
    const existsR = await fs.exists(fullPath);
    if (!existsR.ok) {
      findings.push({
        level: kind,
        path: fullPath,
        code: "E_IO_ERROR",
        message: `Failed to check existence: ${existsR.error.message}`,
      });
      continue;
    }
    if (!existsR.value) {
      findings.push({
        level: kind,
        path: fullPath,
        code: "E_MISSING_REQUIRED",
        message: `Required ${kind} file/directory missing: ${relPath}`,
      });
    }
  }

  // Validate JSON files
  await validateJsonFiles(fs, wsPath, kind, findings);
}

// ---- JSON validation -------------------------------------------------------

const JSON_FILES = [
  ".workspace/contract.json",
  ".workspace/metadata.json",
  "assets/manifest.json",
  "output/current.json",
] as const;

async function validateJsonFiles(
  fs: FileSystem,
  wsPath: string,
  kind: WorkspaceKind,
  findings: DoctorFinding[],
): Promise<void> {
  for (const relPath of JSON_FILES) {
    const fullPath = `${wsPath}/${relPath}`;
    const existsR = await fs.exists(fullPath);
    if (!existsR.ok || !existsR.value) continue; // already reported as missing

    const readR = await fs.readText(fullPath);
    if (!readR.ok) {
      findings.push({
        level: kind,
        path: fullPath,
        code: "E_READ_ERROR",
        message: `Cannot read file: ${readR.error.message}`,
      });
      continue;
    }

    try {
      JSON.parse(readR.value);
    } catch {
      findings.push({
        level: kind,
        path: fullPath,
        code: "E_INVALID_JSON",
        message: "File contains invalid JSON",
      });
    }
  }

  // Validate JSONL files (events.jsonl, threads.jsonl)
  const jsonlFiles = ["journal/events.jsonl", "reviews/threads.jsonl"];
  for (const relPath of jsonlFiles) {
    const fullPath = `${wsPath}/${relPath}`;
    const existsR = await fs.exists(fullPath);
    if (!existsR.ok || !existsR.value) continue;

    const readR = await fs.readText(fullPath);
    if (!readR.ok) {
      findings.push({
        level: kind,
        path: fullPath,
        code: "E_READ_ERROR",
        message: `Cannot read file: ${readR.error.message}`,
      });
      continue;
    }

    // Each non-empty line must be valid JSON
    const lines = readR.value.split("\n").filter((l) => l.trim().length > 0);
    for (let i = 0; i < lines.length; i++) {
      try {
        JSON.parse(lines[i]!);
      } catch {
        findings.push({
          level: kind,
          path: fullPath,
          code: "E_INVALID_JSONL",
          message: `Line ${i + 1} is not valid JSON`,
        });
      }
    }
  }
}

// ---- Helpers ---------------------------------------------------------------

async function listDirs(fs: FileSystem, parentPath: string): Promise<string[]> {
  const readR = await fs.readDir(parentPath);
  if (!readR.ok) return [];
  // Return subdirectory names that look like workspace slugs (not hidden)
  return readR.value.filter((name) => !name.startsWith(".") && !name.startsWith("_"));
}
