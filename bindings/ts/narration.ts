/**
 * TypeScript bindings generated from narration.schema.json
 * Schema: https://schemas.studio.video/v1alpha1/narration.schema.json
 * Auto-generated — do not edit directly.
 */

import type { ContentHash, PortableRelativePath, Timestamp } from "./identity";

export interface SourceSpan {
  start: number;
  end: number;
}

export type SpeechRole = "narrator" | "dialogue";

export interface SegmentContext {
  policy: "none" | "metadata_only";
  before: string;
  after: string;
}

export interface DeliveryDelta {
  pace?: "slower" | "steady" | "quicker";
  articulation?: "soft" | "natural" | "crisp";
  energy?: "low" | "medium" | "high";
  emotion?: "neutral" | "warm" | "joyful" | "curious" | "somber" | "tense" | "urgent";
  intensity?: "restrained" | "moderate" | "strong";
  intent?: "narrate" | "explain" | "reassure" | "wonder" | "warn" | "question" | "exclaim";
  distance?: "intimate" | "conversational" | "projected";
}

export interface VoiceDirection {
  directionVersion: string;
  baseDirectionId: string;
  baseInstruction: string;
  delta: DeliveryDelta;
  composedInstruction: string;
}

export interface NarrationSegment {
  schemaVersion: "0.1.0";
  segmentId: string;
  sourceDocumentHash: ContentHash;
  sourceBlockIds: string[];
  sourceSpans: SourceSpan[];
  preprocessingVersion: string;
  displayText: string;
  spokenText: string;
  language: string;
  role: SpeechRole;
  speakerProfileId: string;
  direction: VoiceDirection;
  context: SegmentContext;
  pauseAfterMs: number;
}

export interface ModelIdentity {
  modelId: string;
  modelProfile: "custom_voice";
  modelHash: ContentHash;
  quantization: string;
  mlxAudioVersion: string;
  mlxVersion: string;
}

export interface SamplingProfile {
  temperature: number;
  topK: number;
  topP: number;
  repetitionPenalty: number;
  maxTokens: number;
  seed: number;
}

export interface SynthesisProfile {
  schemaVersion: "0.1.0";
  profileId: string;
  profileRevision: string;
  model: ModelIdentity;
  speaker: string;
  language: string;
  sampleRate: 24000;
  channels: 1;
  sampleWidthBytes: 2;
  sampling: SamplingProfile;
}

export interface WavArtifact {
  path: PortableRelativePath;
  contentHash: ContentHash;
  sizeBytes: number;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  sampleWidthBytes: number;
}

export interface AttemptFailure {
  code: "invalid_request" | "model_unavailable" | "generation_failed" | "missing_output" | "invalid_wav" | "validation_rejected" | "cancelled";
  message: string;
  retryable: boolean;
}

export interface SynthesisAttempt {
  schemaVersion: "0.1.0";
  attemptId: string;
  segmentId: string;
  requestFingerprint: ContentHash;
  phase: "completed" | "failed" | "cancelled";
  profile: SynthesisProfile;
  direction: VoiceDirection;
  rawWav?: WavArtifact;
  failure?: AttemptFailure;
  retryOf?: string;
  createdAt: Timestamp;
  completedAt: Timestamp;
  processingSeconds: number;
  peakMemoryBytes?: number;
}

export interface SignalMetrics {
  peakDbfs: number;
  rmsDbfs: number;
  clippedSampleRatio: number;
  dcOffset: number;
  leadingSilenceMs: number;
  trailingSilenceMs: number;
  spokenWordsPerMinute: number;
}

export interface QualityCheck {
  checkId: string;
  status: "pass" | "warn" | "fail";
  observed: string;
  expected: string;
}

export interface SegmentQualityReport {
  schemaVersion: "0.1.0";
  reportId: string;
  validatorVersion: string;
  attemptId: string;
  metrics: SignalMetrics;
  checks: QualityCheck[];
  decision: "accept" | "reject" | "review";
  overrideActor?: string;
  overrideReason?: string;
  createdAt: Timestamp;
}

export interface NarrationEntry {
  segmentId: string;
  acceptedAttemptId: string;
  qualityReportId: string;
  wav: WavArtifact;
  pauseAfterMs: number;
  transformIds: string[];
}

export interface MasteringMetrics {
  integratedLufs: number;
  truePeakDbtp: number;
  loudnessRangeLu: number;
}

export interface CaptionCue {
  segmentId: string;
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface NarrationManifest {
  schemaVersion: "0.1.0";
  manifestId: string;
  episodeId: string;
  sourceRevision: string;
  entries: NarrationEntry[];
  masteringProfileId: string;
  finalWav: WavArtifact;
  mastering: MasteringMetrics;
  captions: CaptionCue[];
  createdAt: Timestamp;
}

export interface LegacyNarrationSidecar {
  id?: string;
  scene?: string;
  duration?: number;
  duration_sec?: number;
  durationSeconds?: number;
  wav_path?: string;
  path?: string;
  text?: string;
  voice?: string;
  speakers?: string[];
}

export interface NarrationExample {
  segment: NarrationSegment;
  attempt: SynthesisAttempt;
  quality: SegmentQualityReport;
  manifest: NarrationManifest;
  legacy: LegacyNarrationSidecar;
}
