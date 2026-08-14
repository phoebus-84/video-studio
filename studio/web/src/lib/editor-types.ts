/** Kinds of artifacts the editor can handle. */
export type ArtifactKind = "markdown" | "yaml" | "json" | "plaintext" | "html";

/** Editor save state lifecycle. */
export type SaveState =
  | "clean"
  | "dirty"
  | "saving"
  | "saved"
  | "conflict"
  | "error";

/** A revision token for CAS (compare-and-swap) writes. */
export interface Revision {
  etag: string;
  updatedAt: string;
}

/** The artifact content with its revision anchor. */
export interface ArtifactContent {
  kind: ArtifactKind;
  text: string;
  revision: Revision;
  /** Workspace location for round-trip saves. */
  filePath?: string;
  channel?: string;
  series?: string;
  episode?: string;
}

/** Validation diagnostic pointing to a specific location. */
export interface EditorDiagnostic {
  code: string;
  message: string;
  line?: number;
  column?: number;
  severity: "error" | "warning";
}

/** A save that was rejected because the server had a newer revision. */
export interface ConflictState {
  /** The version we tried to save. */
  ours: string;
  /** The current server version. */
  theirs: string;
  /** The common ancestor we started from. */
  base: string;
  serverRevision: Revision;
}

export const SAVE_LABELS: Record<SaveState, string> = {
  clean: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving…",
  saved: "Saved",
  conflict: "Conflict — resolve before saving",
  error: "Save failed",
};
