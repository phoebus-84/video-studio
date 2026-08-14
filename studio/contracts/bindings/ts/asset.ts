/**
 * TypeScript bindings generated from asset.schema.json
 * Schema: https://schemas.studio.video/v1alpha1/asset.schema.json
 * Auto-generated — do not edit directly.
 */

import type { AssetId, PortableRelativePath, Timestamp, ProviderIdentity, Money, Provenance } from "./identity";

export type AssetKind = "image" | "audio" | "video";

export type AssetState = "idle" | "ready" | "generating" | "failed";

export interface ImageMetadata {
  width: number;
  height: number;
  format?: "png" | "jpg" | "jpeg" | "webp";
}

export interface AudioMetadata {
  durationSeconds: number;
  sampleRate: 16000 | 22050 | 24000 | 44100 | 48000;
  channels: 1 | 2;
  codec?: "pcm_s16le" | "pcm_f32le" | "aac" | "mp3";
}

export interface VideoMetadata {
  width: number;
  height: number;
  durationSeconds: number;
  framerate: number;
  codec: "h264" | "h265" | "vp8" | "vp9" | "av1";
  /** Whether the video can be seamlessly looped (e.g., terminal recordings with static end state). */
  loopable?: boolean;
  bitrateKbps?: number;
}

export interface AssetAttempt {
  id: AssetId;
  /** Scene identifier (e.g., s1, s4a) */
  sceneId: string;
  kind: AssetKind;
  state: AssetState;
  provider?: ProviderIdentity;
  /** Generation prompt for AI-generated assets; null for deterministic renders. */
  prompt?: string;
  referenceImages?: PortableRelativePath[];
  seed?: number | null;
  image?: ImageMetadata;
  audio?: AudioMetadata;
  video?: VideoMetadata;
  cost?: Money;
  /** License or usage terms for the generated asset. */
  license?: string;
  filePath: PortableRelativePath;
  fileAvailable?: boolean;
  selected?: boolean;
  provenance: Provenance;
}

export interface AssetGroup {
  sceneId: string;
  sceneTitle: string;
  attempts: AssetAttempt[];
}

export interface AssetManifest {
  assets: AssetAttempt[];
  updatedAt: Timestamp;
}

export interface AssetExample {
  imageAttempt: AssetAttempt;
  audioAttempt: AssetAttempt;
  videoAttempt: AssetAttempt;
  assetGroup: AssetGroup;
  assetManifest: AssetManifest;
}
