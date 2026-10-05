// The minimal kit registry (avg-tk7.1). A kit is a named, versioned React
// component with a zod schema for its props. A timeline asks for a kit by
// name and version; an unknown one is refused before rendering starts.
// Versioning policy, previews and per-kit test conventions are avg-tk7.3.

import type React from 'react';
import {z} from 'zod';
import {Still} from './Still.js';
import {Clip} from './Clip.js';
import {Captions} from './Captions.js';

/** A `{ "$asset": "<id>" }` reference, as the timeline writes it. */
export const AssetRef = z.object({$asset: z.string().min(1)}).strict();

const fit = z.enum(['cover', 'contain']);

export const StillProps = z.object({src: AssetRef, fit: fit.optional(), scale: z.number().positive().optional()}).strict();
export const ClipProps = z.object({src: AssetRef, fit: fit.optional()}).strict();
export const CaptionsProps = z.object({
  text: z.string().min(1),
  position: z.enum(['top', 'bottom', 'center']).optional(),
  fontSize: z.number().positive().optional(),
  color: z.string().min(1).optional(),
  backgroundColor: z.string().min(1).optional(),
  font: z.string().min(1).optional(),
}).strict();

/** What a kit component receives: props with every asset reference resolved. */
export interface KitContext {
  /** Frames a clip asset lasts, for kits that must freeze at its end. */
  assetFrames: Record<string, number>;
}

export interface KitDefinition {
  version: string;
  props: z.ZodTypeAny;
  // Props arrive resolved: `src` is a URL, not an asset reference.
  component: React.FC<{props: Record<string, unknown>; context: KitContext}>;
}

export const KITS: Readonly<Record<string, KitDefinition>> = Object.freeze({
  still: {version: '1.0.0', props: StillProps, component: Still},
  clip: {version: '1.0.0', props: ClipProps, component: Clip},
  captions: {version: '1.0.0', props: CaptionsProps, component: Captions},
});

export const listKits = (): {name: string; version: string}[] =>
  Object.entries(KITS).map(([name, kit]) => ({name, version: kit.version}));
