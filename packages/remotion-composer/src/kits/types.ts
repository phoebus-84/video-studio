// What a kit version is (avg-tk7.3). A kit is a named, versioned React
// component with a zod schema for its props, a description, and examples
// that the one-frame tests and the previews render.

import type React from 'react';
import type {ZodTypeAny} from 'zod';
import {z} from 'zod';

/** A `{ "$asset": "<id>" }` reference, as a timeline writes it. */
export const AssetRef = z.object({$asset: z.string().min(1)}).strict();

/** What a kit component receives besides its props (which arrive with $asset resolved to URLs). */
export interface KitContext {
  /** Asset URL → how many frames that video lasts, for kits that freeze at its end. */
  assetFrames: Record<string, number>;
}

export interface KitExample {
  /** ^[a-z0-9]+(-[a-z0-9]+)*$ */
  id: string;
  /** As a timeline writes them; $asset ids name entries of `samples`. */
  props: Record<string, unknown>;
  durationInFrames: number;
  /** The frame rendered by the one-frame test and the preview. */
  frame: number;
  /** $asset id → file in kits/samples/. */
  samples?: Record<string, string>;
}

export interface KitVersion {
  name: string;
  version: string;
  description: string;
  /** Validates props as a timeline writes them. */
  props: ZodTypeAny;
  component: React.FC<{props: Record<string, unknown>; context: KitContext}>;
  examples: KitExample[];
}
