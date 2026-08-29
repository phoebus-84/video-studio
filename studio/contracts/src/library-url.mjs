/**
 * Library URLs — the browser-safe half of the workspace layout.
 *
 * `layout.mjs` is the source of truth for where things live on disk, but it
 * imports `node:path` and so cannot be bundled into the studio. The container
 * names and the URL shape are the parts the browser needs, and duplicating them
 * in the web app would mean the studio could drift from the gateway silently —
 * the failure mode being a 404 on every image, which reads as "the asset is
 * missing" rather than "the path is wrong".
 *
 * So they live here, with no Node dependency, and `layout.mjs` imports them.
 * One definition, two consumers.
 */

/** Directory inside a channel that holds its series. */
export const SERIES_CONTAINER = "series";

/** Directory inside a series that holds its episodes. */
export const EPISODES_CONTAINER = "episodes";

/**
 * Path segments for a workspace level, from a partial reference.
 *
 * Supplying only `channel` yields the channel, adding `series` yields the
 * series, and so on — matching `workspacePath` in `layout.mjs`.
 */
export function librarySegments({ channel, series, episode }) {
  if (!channel) return [];
  const segments = [channel];
  if (series) {
    segments.push(SERIES_CONTAINER, series);
    if (episode) segments.push(EPISODES_CONTAINER, episode);
  }
  return segments;
}

/**
 * The `/library/…` path for a file inside a workspace level.
 *
 * Every segment is percent-encoded, so a channel or file named with a space or
 * a `#` resolves rather than truncating at the fragment. `relative` may contain
 * `/` separators; each of its segments is encoded individually so the slashes
 * survive as path structure.
 *
 * Returns null when there is no channel to anchor to, or when `relative` tries
 * to climb out of the level — the static route would reject it anyway, but a
 * caller that gets null can say "no preview" instead of firing a doomed request.
 */
export function libraryUrlPath(ref, relative = "") {
  const segments = librarySegments(ref);
  if (segments.length === 0) return null;

  const parts = String(relative)
    .split("/")
    .filter((part) => part !== "" && part !== ".");

  if (parts.some((part) => part === "..")) return null;

  return (
    "/library/" +
    [...segments, ...parts].map((part) => encodeURIComponent(part)).join("/")
  );
}
