// ---------------------------------------------------------------------------
// Canonical workspace tree — shared definition
// ---------------------------------------------------------------------------
// Consumed by both workspace init (src/workspace/init.ts) and the doctor
// command (src/workspace/doctor.ts).
//
// Every path is relative to the workspace root at its level.
// ---------------------------------------------------------------------------

/** Files and directories created at the channel level. */
export const CHANNEL_TREE = [
  "channel.md",
  "settings.yaml",
  // Channel knowledge — what this channel is and what it knows, as opposed to
  // the series it contains.
  "brand",
  "characters",
  "references",
  "skills",
  "voices",
  // Explicit container: a directory in here is a series, and nothing else has
  // to be inferred (see studio/contracts/src/layout.mjs).
  "series",
  ".workspace/contract.json",
  ".workspace/metadata.json",
] as const;

/** Files and directories created at the series level. */
export const SERIES_TREE = [
  "series.md",
  "settings.yaml",
  "visual-bible.md",
  "voice-profiles",
  "pipelines",
  "skills",
  "sources",
  "templates",
  // Explicit container: a directory in here is an episode.
  "episodes",
  ".workspace/contract.json",
  ".workspace/metadata.json",
] as const;

/** Files and directories created at the episode level. */
export const EPISODE_TREE = [
  "episode.yaml",
  "source",
  "artifacts",
  "prompts",
  "assets/images",
  "assets/graphics",
  "assets/audio",
  "assets/manifest.json",
  "attempts",
  "reviews/threads.jsonl",
  "journal/events.jsonl",
  "output",
  "output/current.json",
  ".workspace/contract.json",
  ".workspace/metadata.json",
] as const;

/** All path lists indexed by workspace kind. */
export const TREE_BY_KIND = {
  channel: CHANNEL_TREE,
  series: SERIES_TREE,
  episode: EPISODE_TREE,
} as const;
