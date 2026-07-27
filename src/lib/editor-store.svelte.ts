import type {
  ArtifactContent,
  ConflictState,
  EditorDiagnostic,
  Revision,
  SaveState,
} from "$lib/editor-types";

class EditorStore {
  /** Current artifact being edited. */
  artifact = $state<ArtifactContent | null>(null);
  /** Current editor buffer. */
  buffer = $state("");
  /** Save lifecycle. */
  saveState = $state<SaveState>("clean");
  /** Diagnostics for the current buffer. */
  diagnostics = $state<EditorDiagnostic[]>([]);
  /** Active conflict, when saveState === "conflict". */
  conflict = $state<ConflictState | null>(null);
  /** Last save error message. */
  errorMessage = $state("");

  /** Whether the buffer differs from the artifact's text. */
  isDirty = $derived(
    this.artifact !== null && this.buffer !== this.artifact.text,
  );

  /** Open an artifact for editing. */
  open(artifact: ArtifactContent) {
    this.artifact = artifact;
    this.buffer = artifact.text;
    this.saveState = "clean";
    this.diagnostics = [];
    this.conflict = null;
    this.errorMessage = "";
  }

  /** Update the buffer and recompute dirty state. */
  edit(newText: string) {
    this.buffer = newText;
    this.saveState = this.isDirty ? "dirty" : "clean";
  }

  /** Attempt a save. Tests inject a save function; production calls the gateway. */
  async save(
    saveFn: (
      text: string,
      revision: Revision,
    ) => Promise<
      | { ok: true; revision: Revision }
      | { ok: false; conflict: ConflictState }
      | { ok: false; error: string }
    >,
  ) {
    if (!this.artifact) return;
    this.saveState = "saving";
    this.errorMessage = "";

    const result = await saveFn(this.buffer, this.artifact.revision);

    if (result.ok) {
      this.artifact = { ...this.artifact, text: this.buffer, revision: result.revision };
      this.saveState = "saved";
    } else if ("conflict" in result) {
      this.conflict = result.conflict;
      this.saveState = "conflict";
    } else {
      this.saveState = "error";
      this.errorMessage = result.error;
    }
  }

  /** Resolve a conflict by accepting one version. */
  resolveConflict(resolved: string) {
    if (!this.artifact) return;
    this.buffer = resolved;
    this.conflict = null;
    this.saveState = "dirty";
  }

  /** Discard local changes, revert to artifact text. */
  discard() {
    if (!this.artifact) return;
    this.buffer = this.artifact.text;
    this.saveState = "clean";
    this.conflict = null;
    this.errorMessage = "";
  }

  /** Validate the buffer (caller provides a validation function). */
  validate(validateFn: (text: string) => EditorDiagnostic[]) {
    this.diagnostics = validateFn(this.buffer);
  }
}

export const editor = new EditorStore();
