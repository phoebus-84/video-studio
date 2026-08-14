// ---------------------------------------------------------------------------
// Workspace domain types
// ---------------------------------------------------------------------------

/** Workspace kind discriminator matching the contracts schema taxonomy. */
export type WorkspaceKind = "channel" | "series" | "episode";

/**
 * A workspace entity discovered from or created on the filesystem.
 *
 * Every workspace has a `.workspace/` directory at its root containing
 * at minimum a `contract.json` document.
 */
export interface WorkspaceDescriptor {
  /** Discriminator. */
  kind: WorkspaceKind;
  /** Absolute path on the filesystem. */
  path: string;
  /** URL-safe slug derived from the directory name. */
  slug: string;
  /** Schema identifier read from the contract document. */
  schema: string;
  /** Schema version string. */
  schemaVersion: string;
}

/** User-editable metadata stored alongside the contract in `.workspace/metadata.json`. */
export interface WorkspaceMeta {
  title?: string;
  description?: string;
  /** ISO-8601 timestamp of creation (set by the runtime). */
  createdAt: string;
  /** ISO-8601 timestamp of last update (set by the runtime). */
  updatedAt: string;
}

/**
 * Normalised path segment for the hidden workspace directory.
 *
 * Every workspace (channel, series, episode) contains a `.workspace/`
 * directory holding the contract document and user metadata.
 */
export const WORKSPACE_DIR = ".workspace";

/** Canonical filename for the contract document. */
export const CONTRACT_FILE = "contract.json";

/** Canonical filename for the user-editable metadata file. */
export const METADATA_FILE = "metadata.json";
