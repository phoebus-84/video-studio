// A structural zod mirror of studio.video/v1alpha2 EditTimeline
// (studio/contracts/schemas/v1alpha2/edit-timeline.schema.json, ADR-0034).
//
// This package may not import studio/contracts, so it keeps its own mirror.
// Mirrors drift: test/schema.test.ts checks that this schema accepts and
// rejects the contracts' own fixtures the way the JSON Schema does.
// Structure only — overlaps, crossfades and references are checked by the
// contracts' validateEditTimeline, which the caller runs first.

import {z} from 'zod';

const contentHash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const frame = z.number().int().min(0);
const frameCount = z.number().int().min(1);
const localId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const semver = z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
const specPath = z.string().min(1);

const transitionIn = z.object({type: z.enum(['fade', 'crossfade']), duration: frameCount}).strict();
const transitionOut = z.object({type: z.literal('fade'), duration: frameCount}).strict();

export const VisualItemSchema = z.object({
  id: localId,
  from: frame,
  duration: frameCount,
  kit: z.object({name: z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/), version: semver}).strict(),
  props: z.record(z.unknown()),
  source: specPath.optional(),
  transitionIn: transitionIn.optional(),
  transitionOut: transitionOut.optional(),
}).strict();

export const AudioItemSchema = z.object({
  id: localId,
  from: frame,
  duration: frameCount,
  asset: localId,
  trimStart: frame.optional(),
  gain: z.number().min(0).optional(),
  fadeIn: frame.optional(),
  fadeOut: frame.optional(),
  source: specPath.optional(),
  transitionIn: transitionIn.optional(),
  transitionOut: transitionOut.optional(),
}).strict();

export const DuckSchema = z.object({
  under: z.array(localId).min(1).refine((ids) => new Set(ids).size === ids.length, 'must be unique'),
  gain: z.number().min(0).max(1),
  attack: frame.optional(),
  release: frame.optional(),
}).strict();

export const TrackSchema = z.object({
  id: localId,
  name: z.string().min(1).optional(),
  type: z.enum(['visual', 'audio']),
  z: z.number().int().optional(),
  duck: DuckSchema.optional(),
  muted: z.boolean().optional(),
  hidden: z.boolean().optional(),
  items: z.array(z.union([VisualItemSchema, AudioItemSchema])),
}).strict();

export const AssetSchema = z.object({
  path: z.string().min(1),
  hash: contentHash,
  kind: z.enum(['markdown', 'json', 'yaml', 'audio', 'video', 'image', 'captions', 'tape']),
}).strict();

export const EditTimelineSchema = z.object({
  apiVersion: z.literal('studio.video/v1alpha2'),
  kind: z.literal('EditTimeline'),
  episodeRef: z.object({channel: z.string().min(1), series: z.string().min(1), episode: z.string().min(1)}).strict(),
  revision: z.number().int().min(1),
  derivedFrom: z.object({
    spec: z.object({path: z.string().min(1), hash: contentHash, revision: z.number().int().min(1).optional()}).strict(),
    compiler: z.object({id: z.string().min(1), version: semver}).strict(),
  }).strict().optional(),
  fps: z.number().int().min(1),
  durationInFrames: frameCount,
  resolution: z.object({width: z.number().int().min(1).max(7680), height: z.number().int().min(1).max(4320)}).strict(),
  assets: z.record(localId, AssetSchema),
  tracks: z.array(TrackSchema).min(1),
  sections: z.array(z.object({
    id: localId,
    from: frame,
    duration: frameCount,
    source: specPath.optional(),
    chapter: z.object({number: z.number().int().min(1).optional(), title: z.string().min(1)}).strict().optional(),
  }).strict()).optional(),
  metadata: z.record(z.unknown()).optional(),
}).strict();

export type EditTimeline = z.infer<typeof EditTimelineSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type VisualItem = z.infer<typeof VisualItemSchema>;
export type AudioItem = z.infer<typeof AudioItemSchema>;

export const isAudioItem = (item: VisualItem | AudioItem): item is AudioItem => 'asset' in item;
