import type { GateReview } from "./gate-review.mjs";

export declare const FILL: "__FILL__";
export declare const SERIES_TEMPLATE_FILES: Readonly<{
  schema: "episode-spec.schema.json";
  template: "episode-spec.template.json";
  standard: "FORMAT.md";
}>;
/** A self-contained CommonJS module the release sealed (avg-d1x), relative to the release. */
export interface CodeBundle { path: string; hash: string }
/** With `bundle`, the release's own code; without, the application's registered compiler or validator. */
export interface SeriesComponentRef { id: string; version: string; bundle?: CodeBundle }
export interface TemplatePin { id: string; version: string; hash: string }
export interface SeriesFileRef { path: string; hash: string }
export interface SeriesEpisodeRef { channel: string; series: string; episode: string }
/** One layout-sheet instant per matching section (avg-3th.1). */
export interface SheetInstantRule {
  at: "start" | "middle" | "end";
  offsetSeconds?: number;
  /** Exact section ids, or prefixes ending in `*`; absent: every section. */
  sections?: string[];
}
export interface SheetRules { instants: SheetInstantRule[] }
export interface SeriesTemplate {
  apiVersion: "studio.video/v1alpha1";
  kind: "SeriesTemplate";
  id: string;
  version: string;
  compiler: SeriesComponentRef;
  validator?: SeriesComponentRef;
  /** The channel theme release this series draws with (ADR-0040). */
  theme?: { id: string; version: string; hash: string };
  files: { schema: SeriesFileRef; template: SeriesFileRef; standard: SeriesFileRef };
  sheet?: SheetRules;
  metadata?: Record<string, unknown>;
}
export interface EpisodeSpec {
  apiVersion: "studio.video/v1alpha1";
  kind: "EpisodeSpec";
  episodeRef: SeriesEpisodeRef;
  revision: number;
  template: TemplatePin;
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}
export interface SeriesReference {
  apiVersion: "studio.video/v1alpha1";
  kind: "SeriesReference";
  id: string;
  episodeRef: SeriesEpisodeRef;
  template: TemplatePin;
  spec: SeriesFileRef;
  timeline: SeriesFileRef;
  render: SeriesFileRef;
  report: SeriesFileRef;
  approval: GateReview;
  metadata?: Record<string, unknown>;
}
/** Exact UTF-8 texts, read safely by the caller; hashes refer to bytes, not parsed JSON. */
export interface SeriesTemplateBundle { manifest: string; files: Record<string, string> }
export interface SeriesTemplateProblem { code: string; path: string; message: string }

export declare function validateSeriesTemplate(doc: unknown): SeriesTemplateProblem[];
export declare function validateTemplateBundle(bundle: unknown): SeriesTemplateProblem[];
export declare function placeholderPaths(value: unknown, base?: string): string[];
/** Throws on an invalid bundle or identity. Returns an editable draft, without writes. */
export declare function instantiateEpisodeSpec(bundle: SeriesTemplateBundle, episodeRef: SeriesEpisodeRef): EpisodeSpec;
/** Ready-to-compile check: exact release pin, no __FILL__, series data schema. */
export declare function validateEpisodeSpec(doc: unknown, bundle: SeriesTemplateBundle): SeriesTemplateProblem[];
/** Shape/bindings only: NOT signature, file verification or approval. */
export declare function validateSeriesReference(doc: unknown): SeriesTemplateProblem[];
