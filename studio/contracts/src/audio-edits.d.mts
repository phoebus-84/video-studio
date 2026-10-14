export declare const EDIT_SUFFIX: ".edit.json";
export declare const PEAKS_SUFFIX: ".peaks.json";
export interface AudioEditPlacement { track: string; clip: string; source: string; in: number; out: number; start: number; end: number; fadeIn: number; fadeOut: number; take?: string }
export interface AudioEditRecord {
  apiVersion: "studio.video/v1alpha1";
  kind: "AudioEdit";
  recipe: Record<string, unknown>;
  resolved: Record<string, unknown>;
  inputs: Record<string, string>;
  output: { path: string; hash: string; durationSeconds: number };
  placements: AudioEditPlacement[];
  report: {
    loudness: { integrated: number | null; range: number | null; truePeak: number | null };
    normalization: "none" | "gain" | "gain+limiter";
    clipped: number;
    headTrim: number;
    joins: { track: string; before: string; after: string; at: number; click: boolean; jumpDb: number | null }[];
    concerns: string[];
  };
  words?: { text: string; start: number; end: number }[];
  createdAt: string;
}
export declare function validateAudioEdit(doc: unknown): { code: string; path: string; message: string }[];
