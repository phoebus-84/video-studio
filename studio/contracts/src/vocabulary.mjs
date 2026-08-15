/**
 * Canonical capability and artifact-kind vocabulary.
 *
 * Single source of truth — keep identical to the enum values in
 * schemas/v1alpha1/vocabulary.schema.json. The check-vocabulary script
 * asserts they match exactly.
 */

export const CAPABILITIES = Object.freeze([
  "image.generate",
  "image.edit",
  "speech.synthesize",
  "graphics.render",
  "terminal.record",
  // Generating new footage from a prompt and references, as opposed to
  // composing existing footage into a timeline.
  "video.generate",
  "video.compose",
  "media.probe",
]);

export const ARTIFACT_KINDS = Object.freeze([
  "markdown",
  "json",
  "yaml",
  "audio",
  "video",
  "image",
  "captions",
  "tape",
  "directory",
]);

/** Check whether `name` is a known capability. */
export function isCapability(name) {
  return CAPABILITIES.includes(name);
}

/** Check whether `kind` is a known artifact kind. */
export function isArtifactKind(kind) {
  return ARTIFACT_KINDS.includes(kind);
}
