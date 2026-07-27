// ---------------------------------------------------------------------------
// Atomic revisioned artifact storage types
// ---------------------------------------------------------------------------

/** An opaque revision identifier (content hash or monotonic counter). */
export type RevisionId = string;

/** Metadata for one revision of an artifact. */
export interface RevisionMeta {
  /** Uniquely identifies this revision. */
  revisionId: RevisionId;
  /** When this revision was created (ISO-8601). */
  createdAt: string;
  /** Who or what created this revision (e.g. "pi", "operator", "stage:script"). */
  author: string;
  /** Byte length of the artifact content. */
  size: number;
  /** Human-readable change description (optional). */
  message?: string;
}

/** An artifact read result with revision tracking. */
export interface ArtifactRead {
  /** The file content as UTF-8 text. */
  content: string;
  /** Current revision identifier. */
  revisionId: RevisionId;
  /** Full revision history (most recent first). */
  history: RevisionMeta[];
}

/** CAS write result. */
export interface ArtifactWriteResult {
  /** New revision ID on success. */
  revisionId: RevisionId;
  /** Whether the write succeeded. */
  written: boolean;
}

/** Conflict diagnostic when a CAS write fails. */
export interface ConflictDiagnostic {
  /** The revision the caller expected. */
  expected: RevisionId;
  /** The revision currently on disk. */
  actual: RevisionId;
  /** A line-by-line diff summary (3 lines back). */
  diffSummary: string;
  /** Caller's content preserved for merging. */
  callerContent: string;
  /** Current content on disk. */
  currentContent: string;
}

/** Error class for conflict failures. */
export class ArtifactConflictError extends Error {
  public readonly diagnostic: ConflictDiagnostic;

  constructor(diagnostic: ConflictDiagnostic) {
    super(
      `Artifact conflict: expected ${diagnostic.expected}, got ${diagnostic.actual}`,
    );
    this.name = "ArtifactConflictError";
    this.diagnostic = diagnostic;
  }
}

/** Lock entry for a canonical path mutation queue. */
export interface MutationQueueEntry {
  /** Unique queue entry ID. */
  id: string;
  /** The canonical path being mutated. */
  path: string;
  /** When this entry was enqueued. */
  enqueuedAt: string;
  /** Whether the mutation is in progress. */
  inProgress: boolean;
}

/** Interface for the mutation queue. */
export interface MutationQueue {
  /** Enqueue a mutation for a path. Returns entry ID. */
  enqueue(path: string): MutationQueueEntry;
  /** Mark a mutation as completed. */
  dequeue(entryId: string): void;
  /** Check if any mutations are pending for a path. */
  pending(path: string): boolean;
  /** List all queued entries for a path (for diagnostics). */
  list(path: string): MutationQueueEntry[];
}
