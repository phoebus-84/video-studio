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
  id: "youtube-1080p-30";
  width: 1920;
  height: 1080;
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

export interface EpisodeManifest {
  apiVersion: ResourceVersion;
  kind: "Episode";
  slug: Slug;
  channel?: Slug;
  series?: Slug;
  title?: string;
  description?: string;
  createdAt?: string;
  /** Episode-level overrides only. Settings resolve system -> channel -> series -> episode, so an episode that overrides nothing omits this key rather than restating what it inherits. */
  settings?: SettingsLayer;
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
