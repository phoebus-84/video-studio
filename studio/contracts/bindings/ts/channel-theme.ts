/**
 * TypeScript bindings generated from channel-theme.schema.json
 * Schema: https://schemas.studio.video/v1alpha1/channel-theme.schema.json
 * Auto-generated — do not edit directly.
 */

import type { Slug, ContentHash, PortableRelativePath } from "./identity";

export type Color = string;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Point = unknown[];

export type Polygon = Point[];

export type ThemeVersion = string;

export interface ThemePin {
  id: Slug;
  version: ThemeVersion;
  hash: ContentHash;
}

export interface Look {
  colors: {
    ink: Color;
    text: Color;
    textDim: Color;
    accent: Color;
    highlight: Color;
    glow: Color;
    lightning: Color;
    plate: Color;
    plateLine: Color;
    shadow: Color;
    backdrop: Color;
    signal: Color;
  };
  /** Family names among the composer's bundled faces; kits use fixed weights per role. */
  fonts: {
    display: string;
    serif: string;
    sans: string;
  };
  measures: {
    plateRadius: number;
    textShadow: string;
    minTextPx: number;
  };
}

export interface Character {
  variant: "attore" | "attrice";
  outfit?: "gilet" | "giacca";
  hairstyle?: "coda" | "corto";
  accessories?: {
    earrings?: boolean;
    freckles?: boolean;
  };
  palette: {
    ink: Color;
    shirt: Color;
    shirtDark: Color;
    vest: Color;
    vestLight: Color;
    button: Color;
    inner: Color;
    innerDark: Color;
    skin: Color;
    skinDark: Color;
    trousers: Color;
    shoe: Color;
    sole: Color;
    hair?: Color;
    hairHi?: Color;
    hairGloss?: Color;
    lip?: Color;
    freckles?: Color;
  };
  poses?: Record<string, {
    lu?: number;
    lf?: number;
    ru?: number;
    rf?: number;
    head?: number;
    lean?: number;
    grip?: number;
    step?: number;
    twist?: number;
    dip?: number;
  }>;
}

export interface Sky {
  poly: Polygon;
  /** Seconds between strikes; a bolt lasts 1.6 s. */
  period?: number;
  seed?: number;
  scale?: number;
}

export interface Room {
  image: PortableRelativePath;
  sky?: Sky[];
  /** Lit by a flash. */
  windows?: Polygon[];
  /** Glow softly, more with a flash. */
  doors?: Box[];
  monitor?: {
    box: Box;
    video: PortableRelativePath;
  };
}

export interface ChannelTheme {
  apiVersion: "studio.video/v1alpha1";
  kind: "ChannelTheme";
  id: Slug;
  version: ThemeVersion;
  look: Look;
  /** Where the format puts things, when stricter than the output profile. */
  layout?: {
    safe?: {
    top: number;
    bottom: number;
  };
    floorY?: number;
    panel?: Box;
  };
  characters: Record<string, Character>;
  rooms: Record<string, Room>;
  brand: {
    text: string;
    icon: "bolt" | "none";
  };
  metadata?: Record<string, unknown>;
}
