export type Color = string;
export interface Box { x: number; y: number; w: number; h: number }
export type Point = [number, number];
export interface Look {
  colors: Record<"ink" | "text" | "textDim" | "accent" | "highlight" | "glow" | "lightning" | "plate" | "plateLine" | "shadow" | "backdrop" | "signal", Color>;
  fonts: { display: string; serif: string; sans: string };
  measures: { plateRadius: number; textShadow: string; minTextPx: number };
}
export interface ThemeCharacter {
  variant: "attore" | "attrice";
  outfit?: "gilet" | "giacca";
  hairstyle?: "coda" | "corto";
  accessories?: { earrings?: boolean; freckles?: boolean };
  palette: Record<string, Color>;
  poses?: Record<string, Partial<Record<"lu" | "lf" | "ru" | "rf" | "head" | "lean" | "grip" | "step" | "twist" | "dip", number>>>;
}
export interface ThemeRoom {
  image: string;
  sky?: { poly: Point[]; period?: number; seed?: number; scale?: number }[];
  windows?: Point[][];
  doors?: Box[];
  monitor?: { box: Box; video: string };
}
/** A file the series share besides the rooms, offered as the asset theme-<name>. */
export interface ThemeMedia {
  path: string;
  kind: "image" | "audio" | "video";
  description?: string;
}
export interface ChannelTheme {
  apiVersion: "studio.video/v1alpha1";
  kind: "ChannelTheme";
  id: string;
  version: string;
  look: Look;
  layout?: { safe?: { top: number; bottom: number }; floorY?: number; panel?: Box };
  characters: Record<string, ThemeCharacter>;
  rooms: Record<string, ThemeRoom>;
  media?: Record<string, ThemeMedia>;
  brand: { text: string; icon: "bolt" | "none" };
  /** Sealed: each named file, relative to the release, with its sha256. */
  files?: Record<string, string>;
  metadata?: Record<string, unknown>;
}
export declare const themeReleasePath: (id: string, version: string) => string;
export declare const THEME_FILE: "theme.json";
export declare const BUNDLED_FONTS: Readonly<Record<"Anton" | "Fraunces" | "Inter", readonly string[]>>;
export declare const ROLE_FACES: Readonly<{ display: readonly string[]; serif: readonly string[]; sans: readonly string[] }>;
/** The files a theme names, relative to its release: each room's image, each monitor's video and each media file. */
export declare function themeFilePaths(doc: ChannelTheme): string[];
export declare function validateChannelTheme(doc: unknown): { code: string; path: string; message: string }[];
