/**
 * TypeScript bindings generated from edit-timeline.schema.json
 * Schema: https://video.studio/schemas/v1alpha1/edit-timeline.schema.json
 * Auto-generated — do not edit directly.
 */

export interface EpisodeRef {
  channel: string;
  series: string;
  episode: string;
}

export interface Resolution {
  width: number;
  height: number;
}

export interface AssetRef {
  path: string;
  hash?: string;
  revision?: string;
}

export interface SegmentTransition {
  "type": "dissolve" | "fade" | "wipe" | "none";
  duration: number;
  easing?: string;
}

export interface SegmentCaption {
  text: string;
  start: number;
  duration: number;
  font?: string;
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
  position?: "top" | "bottom" | "center";
  offsetY?: number;
}

export interface SegmentAudio {
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  mute?: boolean;
}

export interface VisualTransform {
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  fit?: "contain" | "cover" | "fill" | "none";
  scale?: number;
  position?: {
    x: number;
    y: number;
  };
}

export interface VideoFilter {
  name: string;
  params?: Record<string, unknown>;
}

export interface Segment {
  id: string;
  sourceAsset: string;
  sourceKind?: "markdown" | "json" | "yaml" | "audio" | "video" | "image" | "captions" | "tape" | "directory";
  startSec: number;
  durationSec: number;
  transition?: SegmentTransition;
  caption?: SegmentCaption;
  audio?: SegmentAudio;
  transform?: VisualTransform;
  filters?: VideoFilter[];
}

export interface TimelineCaption {
  text: string;
  segmentIndex: number;
  start: number;
  duration: number;
  font?: string;
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
  position?: "top" | "bottom" | "center";
}

export interface TimelineTransition {
  "type": "dissolve" | "fade" | "wipe" | "none";
  afterSegmentIndex: number;
  duration: number;
  easing?: string;
}

export interface EditTimeline {
  apiVersion: "studio.video/v1alpha1";
  kind: "EditTimeline";
  episodeRef: EpisodeRef;
  revision: number;
  fps: number;
  resolution: Resolution;
  segments: Segment[];
  captions?: TimelineCaption[];
  transitions?: TimelineTransition[];
  codec?: string;
  pixelFormat?: string;
}
