// ---------------------------------------------------------------------------
// Canonical workspace tree — shared definition
// ---------------------------------------------------------------------------
// Consumed by both workspace init (src/workspace/init.ts) and the doctor
// command (src/workspace/doctor.ts).
//
// Every path is relative to the workspace root at its level.
// ---------------------------------------------------------------------------

import { EPISODE_TREE } from "@studio/contracts/src/layout.mjs";

/**
 * What a channel must have to be a channel.
 *
 * Kept to what the contract genuinely depends on. Knowledge folders are
 * created for convenience but are not required: a channel with no
 * `characters/` is perfectly valid, and demanding one would condemn every
 * library created before those folders existed.
 */
export const CHANNEL_TREE = [
  "channel.md",
  "settings.yaml",
  // Explicit container: a directory in here is a series, and nothing else has
  // to be inferred (see studio/contracts/src/layout.mjs).
  "series",
  ".workspace/contract.json",
  ".workspace/metadata.json",
] as const;

/** What a series must have to be a series. See CHANNEL_TREE on knowledge folders. */
export const SERIES_TREE = [
  "series.md",
  "settings.yaml",
  // Explicit container: a directory in here is an episode.
  "episodes",
  ".workspace/contract.json",
  ".workspace/metadata.json",
] as const;

/**
 * Files and directories created at the episode level.
 *
 * Re-exported from @studio/contracts rather than declared here: the agent has
 * its own episode creator and cannot import this module, so the one place both
 * can read from is contracts. Pinned by
 * test/unit/workspace/episode-tree-agreement.test.ts.
 */
export { EPISODE_TREE };

/** All path lists indexed by workspace kind. */
export const TREE_BY_KIND = {
  channel: CHANNEL_TREE,
  series: SERIES_TREE,
  episode: EPISODE_TREE,
} as const;
