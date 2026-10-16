// What a kit version is (avg-tk7.3). A kit is a named, versioned React
// component with a zod schema for its props, a description, and examples
// that the one-frame tests and the previews render. Types only: a version
// file must not share runtime code, or a change here would alter old versions.

import type React from 'react';
import type {ZodTypeAny} from 'zod';

/** The frame a kit draws into: the output profile's size and safe zone (avg-tk7.4). */
export interface KitProfile {
  id: string;
  width: number;
  height: number;
  /** Pixels inset from each edge where overlay kits keep their text and graphics. */
  safeZone: {top: number; right: number; bottom: number; left: number};
}

/** What a kit component receives besides its props (which arrive with $asset resolved to URLs). */
export interface KitContext {
  /** Asset URL → how many frames that video lasts, for kits that freeze at its end. */
  assetFrames: Record<string, number>;
  profile: KitProfile;
  /**
   * Which half of the render is being drawn: a render may draw the picture
   * (muted) and the sound in separate passes. Only a kit that plays sound
   * (`sound: true`) is mounted in the sound pass, and it should draw nothing
   * there; absent, the kit draws both.
   */
  pass?: 'picture' | 'sound';
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
  /**
   * "overlay": draws text or graphics over the picture, and must stay inside
   * the profile's safe zone (checked on every example). Absent: fills the frame.
   */
  layer?: 'overlay';
  /**
   * The output profiles the kit is drawn for (ADR-0039); absent: every
   * profile. A format's kit laid out for 9:16 says so, and is neither tested
   * nor accepted in another profile.
   */
  profiles?: string[];
  /** Validates props as a timeline writes them. */
  props: ZodTypeAny;
  /**
   * The kit plays sound itself (<Audio> inside the component), as a runtime
   * ported whole does: its items are mounted in the sound pass too, with
   * `context.pass` saying which pass it is, and the render mixes and
   * normalises their sound with the timeline's audio tracks.
   */
  sound?: boolean;
  component: React.FC<{props: Record<string, unknown>; context: KitContext}>;
  examples: KitExample[];
}
