// ---------------------------------------------------------------------------
// ID generation port
//
// Every entity (episode, stage attempt, asset, render) gets a unique,
// sortable identifier.  The generator abstraction lets tests produce
// deterministic sequences.
// ---------------------------------------------------------------------------

export interface IdGenerator {
  /**
   * Generate a full unique identifier.
   *
   * Implementations SHOULD produce k-sortable, URL-safe strings of
   * sufficient entropy for the expected write volume.
   */
  generate(): string;

  /**
   * Generate a shorter, human-friendly identifier suitable for display.
   * Uniqueness is best-effort, not guaranteed.
   */
  generateShort(): string;
}
