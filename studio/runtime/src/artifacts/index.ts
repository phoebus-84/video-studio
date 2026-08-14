// ---------------------------------------------------------------------------
// Artifacts module — public API
// ---------------------------------------------------------------------------

export {
  ArtifactConflictError,
} from "./types.js";
export type {
  RevisionId,
  RevisionMeta,
  ArtifactRead,
  ArtifactWriteResult,
  ConflictDiagnostic,
  MutationQueueEntry,
  MutationQueue,
} from "./types.js";

export {
  ArtifactStore,
  computeRevisionId,
  diffSummary,
  InMemoryMutationQueue,
} from "./store.js";
export type { ArtifactStoreOptions } from "./store.js";
