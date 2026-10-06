/**
 * TypeScript bindings generated from edit-timeline.schema.json
 * Schema: https://video.studio/schemas/v1alpha2/edit-timeline.schema.json
 * Auto-generated — do not edit directly.
 */

export type ContentHash = string;

export type Frame = number;

export type FrameCount = number;

export type LocalId = string;

export type SpecPath = string;

export interface EpisodeRef {
  channel: string;
  series: string;
  episode: string;
}

export interface Resolution {
  width: number;
  height: number;
}

export interface SafeZone {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface LoudnessTarget {
  /** Integrated loudness, LUFS. */
  integrated: number;
  /** True peak, dBTP. */
  truePeak: number;
  /** Loudness range, LU. */
  range: number;
}

export interface OutputProfile {
  id: string;
  width: number;
  height: number;
  safeZone: SafeZone;
  loudness: LoudnessTarget;
}

export interface DerivedFrom {
  spec: {
    path: string;
    hash: ContentHash;
    revision?: number;
  };
  compiler: {
    id: string;
    version: string;
  };
}

export interface Asset {
  path: string;
  hash: ContentHash;
  kind: "markdown" | "json" | "yaml" | "audio" | "video" | "image" | "captions" | "tape";
}

export interface KitRef {
  name: string;
  version: string;
}

export interface TransitionIn {
  "type": "fade" | "crossfade";
  duration: FrameCount;
}

export interface TransitionOut {
  "type": "fade";
  duration: FrameCount;
}

export interface VisualItem {
  id: LocalId;
  from: Frame;
  duration: FrameCount;
  kit: KitRef;
  /** Kit props, validated by the composer against the kit's own schema. An object with a string $asset key references an entry of the timeline's assets map. */
  props: Record<string, unknown>;
  source?: SpecPath;
  transitionIn?: TransitionIn;
  transitionOut?: TransitionOut;
}

export interface AudioItem {
  id: LocalId;
  from: Frame;
  duration: FrameCount;
  asset: LocalId;
  trimStart?: Frame;
  gain?: number;
  fadeIn?: Frame;
  fadeOut?: Frame;
  source?: SpecPath;
  transitionIn?: TransitionIn;
  transitionOut?: TransitionOut;
}

export interface Duck {
  under: LocalId[];
  gain: number;
  attack?: Frame;
  release?: Frame;
}

export interface Track {
  id: LocalId;
  name?: string;
  "type": "visual" | "audio";
  /** Stacking order of a visual track; higher draws on top. Required on visual tracks, forbidden on audio tracks. */
  z?: number;
  duck?: Duck;
  muted?: boolean;
  hidden?: boolean;
  items: (VisualItem | AudioItem)[];
}

export interface Chapter {
  number?: number;
  title: string;
}

export interface Section {
  id: LocalId;
  from: Frame;
  duration: FrameCount;
  source?: SpecPath;
  chapter?: Chapter;
}

export interface EditTimeline {
  apiVersion: "studio.video/v1alpha2";
  kind: "EditTimeline";
  episodeRef: EpisodeRef;
  revision: number;
  derivedFrom?: DerivedFrom;
  fps: number;
  durationInFrames: FrameCount;
  resolution: Resolution;
  profile: OutputProfile;
  assets: Record<string, Asset>;
  tracks: Track[];
  sections?: Section[];
  metadata?: Record<string, unknown>;
}
