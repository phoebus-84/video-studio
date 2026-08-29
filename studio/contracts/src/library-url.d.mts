// Type declarations for the library URL contract.

/** A partial reference to a workspace level. */
export interface LevelReference {
  channel?: string | undefined;
  series?: string | undefined;
  episode?: string | undefined;
}

/** Directory inside a channel that holds its series. */
export const SERIES_CONTAINER: string;

/** Directory inside a series that holds its episodes. */
export const EPISODES_CONTAINER: string;

/** Path segments for a workspace level, deepest level the reference supports. */
export function librarySegments(ref: LevelReference): string[];

/**
 * The `/library/…` path for a file inside a workspace level, or null when
 * there is no channel to anchor to or the path climbs out of the level.
 */
export function libraryUrlPath(
  ref: LevelReference,
  relative?: string,
): string | null;
