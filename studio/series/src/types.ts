// ---------------------------------------------------------------------------
// What a series compiler takes and gives (avg-jao.2, ADR-0037)
// ---------------------------------------------------------------------------
// A compiler is pure: everything it needs arrives already read, checked and
// hashed by its caller (the agent's loader). It reads no file, asks no clock
// and keeps no state, so a released version compiles the same input to the
// same timeline for as long as it exists — which its golden test holds it to.
// ---------------------------------------------------------------------------

import type { EpisodeSpec, SeriesTemplate } from "@studio/contracts/src/series-templates.mjs";
import type { NarrationTakes } from "@studio/contracts/bindings/ts/narration-takes.ts";
import type { WordTiming } from "@studio/contracts/bindings/ts/word-timing.ts";
import type { EditTimeline } from "@studio/contracts/bindings/ts/v1alpha2/edit-timeline.ts";
import type { ChannelTheme } from "@studio/contracts/src/channel-themes.mjs";

export type { ChannelTheme, EditTimeline, EpisodeSpec, NarrationTakes, SeriesTemplate, WordTiming };

/** A file the timeline refers to, relative to the episode. */
export interface CompileAsset {
  path: string;
  hash: string;
  kind: "image" | "audio" | "video";
}

export interface CompileInput {
  /** Already passed validateEpisodeSpec against its pinned release. */
  spec: EpisodeSpec;
  /** The pinned release's manifest. */
  template: SeriesTemplate;
  /** artifacts/narration/takes.json, already passed validateNarrationTakes. */
  narration: NarrationTakes;
  /** Take id → its WordTiming, valid and made for that take's audio. */
  timings: Record<string, WordTiming>;
  /**
   * Asset id → file. The loader names them `image-<assetId>` for
   * assets/images/<assetId>.<ext> and `narration-<take>` for each take's audio.
   */
  assets: Record<string, CompileAsset>;
  /** Relative path → "sha256:…" of every file read, recorded as provenance. */
  inputs: Record<string, string>;
  /**
   * The channel theme the release pins (ADR-0040), already checked against
   * the pin and the contract; its rooms' images are assets theme-<room>.
   */
  theme?: ChannelTheme;
}

/** Something in the input that stops compilation, located by a JSON path. */
export interface CompileProblem {
  code: string;
  message: string;
  path: string;
}

export type CompileResult =
  | { ok: true; timeline: EditTimeline; warnings: string[] }
  | { ok: false; problems: CompileProblem[] };

export interface SeriesCompiler {
  /** ^[a-z0-9]+(-[a-z0-9]+)*$, as a SeriesTemplate's `compiler.id`. */
  id: string;
  /** Exact x.y.z. */
  version: string;
  /** One sentence. */
  description: string;
  compile(input: CompileInput): CompileResult;
}

/** What a series validator checks: the compile input, the timeline to render and the compiled reference. */
export interface ValidateInput extends CompileInput {
  /** The timeline about to be rendered: stored (possibly hand-edited) or fresh. */
  timeline: EditTimeline;
  /** What the release's compiler makes of the same inputs: the reference. */
  compiled: EditTimeline;
}

/**
 * One breach of a series rule. Paths $.tracks…, $.profile and
 * $.durationInFrames point into `timeline`; $.data… into the spec.
 */
export interface Finding {
  code: string;
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface SeriesValidator {
  /** ^[a-z0-9]+(-[a-z0-9]+)*$, as a SeriesTemplate's `validator.id`. */
  id: string;
  /** Exact x.y.z. */
  version: string;
  /** One sentence. */
  description: string;
  validate(input: ValidateInput): Finding[];
}

export interface CheckResult {
  /** "<id>@<version>" of the validator that ran; null when the template names none. */
  validator: string | null;
  findings: Finding[];
}
