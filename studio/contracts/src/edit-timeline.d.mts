// Type declarations for the v1alpha2 edit timeline checks and migration (ADR-0034).
// The document types themselves are generated from the schema into
// bindings/ts/v1alpha2/edit-timeline.ts.

import type { EditTimeline } from "../bindings/ts/v1alpha2/edit-timeline.ts";

export declare const EDIT_TIMELINE_API_VERSION: "studio.video/v1alpha2";

export type EditTimelineProblemCode =
  | "schema"
  | "duplicate-id"
  | "out-of-range"
  | "missing-z"
  | "z-on-audio"
  | "bad-duck"
  | "item-type"
  | "unknown-asset"
  | "asset-kind"
  | "overlap"
  | "bad-crossfade"
  | "section-overlap"
  | "fade-too-long";

/** One problem, located by a JSON path such as `$.tracks[2].items[5].from`. */
export interface EditTimelineProblem {
  code: EditTimelineProblemCode;
  message: string;
  path: string;
}

/** Every problem in `doc`; an empty array means the timeline is structurally valid. */
export declare function validateEditTimeline(doc: unknown): EditTimelineProblem[];

/** `/tracks/2/items/0/from` → `$.tracks[2].items[0].from`. */
export declare function jsonPath(pointer: string): string;

/**
 * Convert a `studio.video/v1alpha1` timeline. Throws when a source asset has no
 * hash in `assetHashes`, when fps is not an integer, when `doc` is not v1alpha1,
 * or when the result would not pass `validateEditTimeline`.
 */
export declare function migrateEditTimelineV1alpha1(
  doc: unknown,
  options?: { assetHashes?: Record<string, string> },
): EditTimeline;
