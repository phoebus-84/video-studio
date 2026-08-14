// ---------------------------------------------------------------------------
// Artifact kind mapping — file extension → canonical vocabulary kind
// ---------------------------------------------------------------------------
// Canonical artifact kinds are owned by @video-studio/workspace-contracts
// (see schemas/v1alpha1/vocabulary.schema.json, src/vocabulary.mjs).
//
// The contract name in a pipeline manifest is a filename like "script.md"
// or "captions.srt".  We derive the artifact kind from the extension.
// ---------------------------------------------------------------------------

import { ARTIFACT_KINDS } from "@video-studio/workspace-contracts/src/vocabulary.mjs";

const VALID_KINDS = new Set(ARTIFACT_KINDS as readonly string[]);

/** Map file extension (including the dot) to canonical artifact kind. */
export const CONTRACT_KIND_MAP: Record<string, string> = {
  ".md": "markdown",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".mp3": "audio",
  ".wav": "audio",
  ".ogg": "audio",
  ".flac": "audio",
  ".mp4": "video",
  ".webm": "video",
  ".mkv": "video",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
  ".gif": "image",
  ".srt": "captions",
  ".vtt": "captions",
  ".tape": "tape",
};

/**
 * Derive the canonical artifact kind from a contract filename.
 *
 * Trailing slash (e.g. "illustrations/") maps to "directory".
 * Unknown extensions return "unknown".
 */
export function contractToKind(contractName: string): string {
  if (contractName.endsWith("/")) return "directory";

  for (const [ext, kind] of Object.entries(CONTRACT_KIND_MAP)) {
    if (contractName.endsWith(ext)) return kind;
  }

  return "unknown";
}

/** Check if a kind string is in the canonical vocabulary. */
export function isKnownKind(kind: string): boolean {
  return VALID_KINDS.has(kind);
}
