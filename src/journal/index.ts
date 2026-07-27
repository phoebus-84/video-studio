// ---------------------------------------------------------------------------
// Journal module — public API
// ---------------------------------------------------------------------------

export { Journal, hashLine, JOURNAL_ERRORS } from "./writer.js";
export type { JournalWriteOptions } from "./writer.js";

export { JournalReader } from "./reader.js";

export {
  buildProjection,
  applyEvent,
  mergeProjections,
} from "./projections.js";
export type {
  StageState,
  ArtifactState,
  BudgetState,
  ReviewState,
  EpisodeProjection,
} from "./projections.js";

export type {
  EventSequence,
  EventCursor,
  CorrelationId,
  CausationId,
  BaseJournalEvent,
  JournalEvent,
  EpisodeCreatedEvent,
  EpisodeStatusChangedEvent,
  StageStartedEvent,
  StageCompletedEvent,
  StageFailedEvent,
  ArtifactCreatedEvent,
  ArtifactUpdatedEvent,
  BudgetUpdatedEvent,
  ReviewCreatedEvent,
  ReviewResolvedEvent,
  SettingsChangedEvent,
  SnapshotCreatedEvent,
} from "./types.js";
export { isJournalEvent } from "./types.js";
