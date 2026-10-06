// What a kit version is (avg-tk7.3). A kit is a named, versioned React
// component with a zod schema for its props, a description, and examples
// that the one-frame tests and the previews render. Types only: a version
// file must not share runtime code, or a change here would alter old versions.

import type React from 'react';
import type {ZodTypeAny} from 'zod';

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
