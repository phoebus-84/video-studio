// Type declarations for the canonical workspace layout.
// Kept alongside layout.mjs so TypeScript consumers get the same contract the
// runtime and gateway rely on at runtime.

export declare const LAYOUT_VERSION: number;
export declare const SERIES_CONTAINER: string;
export declare const EPISODES_CONTAINER: string;
export declare const WORKSPACE_DIR: string;
export declare const EPISODE_SCRATCH: string;
export declare const EPISODE_DIRECTORIES: readonly string[];
export declare const EPISODE_FILES: readonly string[];
export declare const EPISODE_SEED_FILES: Readonly<Record<string, string>>;
export declare const EPISODE_TREE: readonly string[];
export declare const CHANNEL_KNOWLEDGE: readonly string[];
export declare const SERIES_KNOWLEDGE: readonly string[];
export declare const LEGACY_SERIES_SUPPORT_DIRECTORIES: readonly string[];

export declare function channelPath(root: string, channel: string): string;
export declare function seriesContainerPath(root: string, channel: string): string;
export declare function seriesPath(root: string, channel: string, series: string): string;
export declare function episodesContainerPath(root: string, channel: string, series: string): string;
export declare function episodePath(root: string, channel: string, series: string, episode: string): string;
export declare function workspacePath(
  root: string,
  ref: { channel?: string; series?: string; episode?: string },
): string;
export declare function isLayout2Channel(entryNames: readonly string[]): boolean;
export declare function isLayout2Series(entryNames: readonly string[]): boolean;
