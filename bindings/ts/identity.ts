/**
 * TypeScript bindings generated from identity.schema.json
 * Schema: https://schemas.studio.video/v1alpha1/identity.schema.json
 * Auto-generated — do not edit directly.
 */

export type ChannelId = string;

export type SeriesId = string;

export type EpisodeId = string;

export type ArtifactId = string;

export type AttemptId = string;

export type AssetId = string;

export type JobId = string;

export type ReviewThreadId = string;

export type EventId = string;

export type StableId = ChannelId | SeriesId | EpisodeId | ArtifactId | AttemptId | AssetId | JobId | ReviewThreadId | EventId;

export type Slug = string;

export type RevisionNumber = number;

export type ContentHash = string;

export type PortableRelativePath = string;

export type Timestamp = string;

export interface RevisionRef {
  id: StableId;
  revision: RevisionNumber;
  contentHash?: ContentHash;
}

export interface MediaHash {
  contentHash: ContentHash;
  byteLength: number;
}

export type SourceUri = string;

export interface SourceRevisionRef {
  uri: SourceUri;
  revision: string;
  contentHash?: ContentHash;
}

export interface ProviderIdentity {
  provider: string;
  model: string;
  endpointRevision?: string;
}

export interface Money {
  currency: string;
  micros: number;
}

export interface Provenance {
  createdAt: Timestamp;
  source?: SourceRevisionRef;
  generator?: ProviderIdentity;
  requestHash?: ContentHash;
  inputs?: RevisionRef[];
}
