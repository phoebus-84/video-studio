/**
 * TypeScript bindings generated from editorial-artifact.schema.json
 * Schema: https://schemas.studio.video/v1alpha1/editorial-artifact.schema.json
 * Auto-generated — do not edit directly.
 */

import type { ArtifactId, RevisionNumber, ContentHash, PortableRelativePath, Timestamp, Provenance } from "./identity";

export type ArtifactType = "brief" | "adapted-story" | "script" | "tts-script" | "art-direction" | "narration-script" | "tape" | "scene-plan" | "edit-timeline";

export interface TapeMetadata {
  /** Scene this tape produces a recording for. */
  sceneId: string;
  outputFormat?: "mp4" | "gif" | "webm" | "png";
  /** VHS version used to render. Recorded in the tape file or added at render time. */
  vhsVersion?: string;
  /** Reference to the VHS theme used (e.g., 'dyne'). Inlined in the tape, tracked here for search. */
  themeId?: string;
  estimatedDurationSeconds?: number;
}

export interface EditorialArtifact {
  apiVersion: "studio.video/v1alpha1";
  artifactId: ArtifactId;
  kind: ArtifactType;
  revision: RevisionNumber;
  path: PortableRelativePath;
  contentHash?: ContentHash;
  tape?: TapeMetadata;
  provenance: Provenance;
}

export interface ArtifactCatalog {
  artifacts: EditorialArtifact[];
  updatedAt: Timestamp;
}

export interface EditorialExample {
  briefArtifact: EditorialArtifact;
  scriptArtifact: EditorialArtifact;
  tapeArtifact: EditorialArtifact;
  catalog: ArtifactCatalog;
}
