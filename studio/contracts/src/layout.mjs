/**
 * Canonical workspace layout — the single source of truth for where things live.
 *
 * Every consumer computes paths through this module rather than joining strings
 * itself. That is the whole point: the previous layout put series directly
 * inside the channel directory, mixed in with the channel's own files, so
 * nothing could tell a series apart from a support folder by looking. The
 * gateway coped with a hardcoded denylist of folder names that are *not*
 * series, which meant adding `characters/` to a channel invented a phantom
 * series.
 *
 * Layout 2 makes containment explicit:
 *
 *   [channel]/
 *     channel.md  settings.yaml  .workspace/
 *     brand/ characters/ references/ skills/ voices/     <- channel knowledge
 *     series/
 *       [series]/
 *         series.md  settings.yaml  .workspace/
 *         visual-bible/ skills/ templates/ sources/ pipelines/  <- series knowledge
 *         episodes/
 *           [episode]/
 *             episode.yaml artifacts/ assets/ attempts/ …
 *
 * A directory inside `series/` is a series. A directory inside `episodes/` is
 * an episode. Nothing has to be guessed, and a channel can grow as many
 * knowledge folders as it likes without any of them being mistaken for content.
 */

import { join } from "node:path";

/* The container names are shared with the browser, which cannot import this
   module because of `node:path` above. They are defined once, next to the URL
   builder that needs them, and re-exported here so on-disk and in-URL layout
   cannot drift apart. */
import {
  SERIES_CONTAINER,
  EPISODES_CONTAINER,
} from "./library-url.mjs";

export { SERIES_CONTAINER, EPISODES_CONTAINER };

/** Current layout version, recorded in each workspace contract. */
export const LAYOUT_VERSION = 2;

/**
 * Knowledge folders created at the channel level.
 *
 * These describe the channel itself — who it is and what it knows — as opposed
 * to the series and episodes it contains.
 */
export const CHANNEL_KNOWLEDGE = Object.freeze([
  "brand",
  "characters",
  "references",
  "skills",
  "sources",
  "voices",
]);

/** Knowledge folders created at the series level. */
export const SERIES_KNOWLEDGE = Object.freeze([
  "visual-bible",
  "skills",
  "templates",
  "sources",
  "pipelines",
  "voice-profiles",
]);

/** Marker directory identifying a directory as a workspace of some kind. */
export const WORKSPACE_DIR = ".workspace";

// ── Path builders ───────────────────────────────────────────────────────────

/** `<root>/<channel>` */
export function channelPath(root, channel) {
  return join(root, channel);
}

/** `<root>/<channel>/series` */
export function seriesContainerPath(root, channel) {
  return join(root, channel, SERIES_CONTAINER);
}

/** `<root>/<channel>/series/<series>` */
export function seriesPath(root, channel, series) {
  return join(seriesContainerPath(root, channel), series);
}

/** `<root>/<channel>/series/<series>/episodes` */
export function episodesContainerPath(root, channel, series) {
  return join(seriesPath(root, channel, series), EPISODES_CONTAINER);
}

/** `<root>/<channel>/series/<series>/episodes/<episode>` */
export function episodePath(root, channel, series, episode) {
  return join(episodesContainerPath(root, channel, series), episode);
}

/** Path to a channel source: shared material episodes pin, never copy (ADR-0035). */
export function sourcePath(root, channel, name) {
  return join(channelPath(root, channel), "sources", name);
}

/**
 * Path to a workspace of any level, from a partial reference.
 * Supplying only `channel` yields the channel path, and so on.
 */
export function workspacePath(root, { channel, series, episode }) {
  if (episode) {
    if (!channel || !series) throw new Error("episode path requires channel and series");
    return episodePath(root, channel, series, episode);
  }
  if (series) {
    if (!channel) throw new Error("series path requires channel");
    return seriesPath(root, channel, series);
  }
  if (!channel) throw new Error("a path requires at least a channel");
  return channelPath(root, channel);
}

// ── Layout detection ────────────────────────────────────────────────────────

/**
 * Names that layout 1 had to treat as "not a series" when scanning a channel
 * directory. Retained only so a migration can recognise a legacy tree; nothing
 * in layout 2 consults it.
 */
export const LEGACY_SERIES_SUPPORT_DIRECTORIES = Object.freeze([
  "assets",
  "pipelines",
  "rigs",
  "shared-assets",
  "skills",
  "sources",
  "templates",
  "voice-profiles",
]);

/**
 * Whether a channel directory listing looks like layout 2.
 *
 * @param entryNames directory names directly inside the channel
 */
export function isLayout2Channel(entryNames) {
  return entryNames.includes(SERIES_CONTAINER);
}

/**
 * Whether a series directory listing looks like layout 2.
 *
 * @param entryNames directory names directly inside the series
 */
export function isLayout2Series(entryNames) {
  return entryNames.includes(EPISODES_CONTAINER);
}
