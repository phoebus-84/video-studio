/**
 * TypeScript bindings generated from workspace.schema.json
 * Schema: https://schemas.studio.video/v1alpha1/workspace.schema.json
 * Auto-generated — do not edit directly.
 */

import type { ChannelId, SeriesId, EpisodeId, ArtifactId, AttemptId, Slug, RevisionNumber, ContentHash, PortableRelativePath, Timestamp, RevisionRef, MediaHash, SourceUri } from "./identity";

export type ResourceVersion = "studio.video/v1alpha1";

export type ResourceKind = "Channel" | "Series" | "Episode" | "RepositorySourceSnapshot" | "TextSourceSnapshot" | "VoiceProfileMetadata" | "VisualBibleMetadata" | "CurrentDeliverable" | "ChannelSettings" | "SeriesSettings";

export type CredentialFreeSourceUri = SourceUri & string;

export interface CredentialFreeSourceRevisionRef {
  uri: CredentialFreeSourceUri;
  revision: string;
  contentHash: ContentHash;
}

export interface LicenseMetadata {
  spdxId?: string;
  licenseUrl?: SourceUri;
  commercialUse: "allowed" | "restricted" | "unknown";
  attributionRequired: boolean;
  attributionText?: string;
  evidencePath?: PortableRelativePath;
}

export interface ApprovalPolicy {
  mode: "autopilot" | "guided" | "manual";
  onPaidAction: "continue" | "requireApproval";
  onBudgetExceeded: "requireApproval";
  onMaterialDowngrade: "requireApproval";
  onCapabilityUnavailable: "requireApproval";
  onValidationFailure: "requireApproval";
  onConflict: "requireApproval";
  onLicenseOrSafetyBlocker: "requireApproval";
}

export interface BudgetEnvelope {
  currency: string;
  limitMicros: number;
  warnAtMicros: number;
  reservationRequired: boolean;
}

export interface OutputProfileRef {
  /** An id of the output profile catalog, src/output-profiles.json; width and height must be that profile's. */
  id: "youtube-1920x1080" | "vertical-1080x1920";
  width: number;
  height: number;
  frameRate: 30;
}

export interface SettingsLayer {
  approvalPolicy: ApprovalPolicy;
  budget: BudgetEnvelope;
  outputProfile: OutputProfileRef;
  locale?: string;
  extensions?: Record<string, unknown>;
}

export interface ChannelSettings {
  apiVersion: ResourceVersion;
  kind: "ChannelSettings";
  channelId: ChannelId;
  values: SettingsLayer;
}

export interface SeriesSettings {
  apiVersion: ResourceVersion;
  kind: "SeriesSettings";
  seriesId: SeriesId;
  values: SettingsLayer;
}

export interface ChannelProfile {
  apiVersion: ResourceVersion;
  kind: "Channel";
  channelId: ChannelId;
  slug: Slug;
  title: string;
  audience: string;
  description?: string;
  metadata?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

export interface SeriesProfile {
  apiVersion: ResourceVersion;
  kind: "Series";
  seriesId: SeriesId;
  channelId: ChannelId;
  slug: Slug;
  title: string;
  format: string;
  description?: string;
  metadata?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

export interface CurrentDeliverable {
  apiVersion: ResourceVersion;
  kind: "CurrentDeliverable";
  episodeId: EpisodeId;
  renderAttemptId: AttemptId;
  media: {
    path: PortableRelativePath;
    hash: MediaHash;
  };
  renderReport: RevisionRef;
  updatedAt: Timestamp;
}

export interface EpisodeMetadata {
  apiVersion: ResourceVersion;
  kind: "Episode";
  episodeId: EpisodeId;
  seriesId: SeriesId;
  slug: Slug;
  title: string;
  settings: SettingsLayer;
  sourceSnapshotRefs?: RevisionRef[];
  currentDeliverablePath?: PortableRelativePath & "output/current.json";
  metadata?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

export interface RepositorySourceSnapshot {
  apiVersion: ResourceVersion;
  kind: "RepositorySourceSnapshot";
  artifactId: ArtifactId;
  revision: RevisionNumber;
  originUri: CredentialFreeSourceUri;
  commit: string;
  treeHash: ContentHash;
  license: LicenseMetadata;
  capturedAt: Timestamp;
  analysisPolicy: {
    readOnly: true;
    allowRepositoryExecution: false;
  };
}

export interface TextSourceSnapshot {
  apiVersion: ResourceVersion;
  kind: "TextSourceSnapshot";
  artifactId: ArtifactId;
  revision: RevisionNumber;
  source: CredentialFreeSourceRevisionRef;
  license: LicenseMetadata;
  capturedAt: Timestamp;
  sourceLanguage?: string;
}

export interface VoiceProfileMetadata {
  apiVersion: ResourceVersion;
  kind: "VoiceProfileMetadata";
  artifactId: ArtifactId;
  revision: RevisionNumber;
  name: string;
  voiceMode: "preset" | "clone" | "design";
  language: string;
  createdAt: Timestamp;
  referenceSource?: RevisionRef;
}

export interface VisualBibleMetadata {
  apiVersion: ResourceVersion;
  kind: "VisualBibleMetadata";
  artifactId: ArtifactId;
  revision: RevisionNumber;
  seriesId: SeriesId;
  themeId: string;
  createdAt: Timestamp;
  referenceAssets?: RevisionRef[];
}

export interface WorkspaceExample {
  channel: ChannelProfile;
  channelSettings: ChannelSettings;
  series: SeriesProfile;
  seriesSettings: SeriesSettings;
  episode: EpisodeMetadata;
  sourceSnapshot: RepositorySourceSnapshot | TextSourceSnapshot;
  voiceProfile: VoiceProfileMetadata;
  visualBible: VisualBibleMetadata;
  currentDeliverable: CurrentDeliverable;
}
