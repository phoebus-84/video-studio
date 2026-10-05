/**
 * TypeScript bindings generated from source-pin.schema.json
 * Schema: https://video.studio/schemas/v1alpha1/source-pin.schema.json
 * Auto-generated — do not edit directly.
 */

export type ContentHash = string;

export type LocalId = string;

export interface ChannelSource {
  kind: "channel-source";
  name: LocalId;
}

export interface EpisodeSource {
  kind: "episode";
  series: LocalId;
  episode: LocalId;
}

export type SourceRef = ChannelSource | EpisodeSource;

export type RelativePath = string;

export interface InventoryEntry {
  hash: ContentHash;
  size: number;
  mtimeMs: number;
}

export interface SourcePin {
  apiVersion: "studio.video/v1alpha1";
  kind: "SourcePin";
  id: LocalId;
  source: SourceRef;
  paths?: RelativePath[];
  usedBy: string[];
  pinnedAt: string;
  files: Record<string, InventoryEntry>;
}
