// ---------------------------------------------------------------------------
// video-pipeline-runtime public API
// ---------------------------------------------------------------------------

// Result / error conventions
export {
  ok,
  err,
  isOk,
  isErr,
  map,
  mapErr,
  andThen,
  unwrapOr,
  unwrap,
} from "./result.js";
export type { Result, Ok, Err } from "./result.js";

export {
  RuntimeError,
  ErrorCode,
  internalError,
  invalidArgument,
  notFound,
  permissionDenied,
  alreadyExists,
  timeoutError,
  cancelledError,
  leaseConflict,
  leaseExpired,
} from "./errors.js";
export type { ErrorCodeValue } from "./errors.js";

// Ports (re-exported for convenience; consumers may also import from ./ports)
export type {
  Clock,
  FileSystem,
  FsError,
  Lock,
  Lease,
  LockError,
  IdGenerator,
  EventSink,
  EventSinkError,
  Event,
  BaseEvent,
} from "./ports/index.js";
export { SystemClock } from "./ports/index.js";

// Logging
export { ConsoleLogger, NoopLogger } from "./logging.js";
export type { Logger, LogLevel, ConsoleLoggerOptions } from "./logging.js";

// Workspace (channel / series / episode lifecycle)
export {
  // Types
  WORKSPACE_DIR,
  CONTRACT_FILE,
  METADATA_FILE,
  // Slugs
  validateSlug,
  SLUG_MAX_LENGTH,
  // Path guard
  guardPath,
  guardWritePath,
  validateRootPath,
  resolveGuardedPath,
  // Contracts
  DEFAULT_CONTRACT_SCHEMA,
  DEFAULT_CONTRACT_VERSION,
  createContract,
  validateContractStructure,
  parseContractJson,
  serialiseContract,
  // Init
  initChannel,
  initSeries,
  initEpisode,
  ensureDefaultChannel,
  DEFAULT_CHANNEL_SLUG,
  // Discovery
  discoverChannels,
  discoverSeries,
  discoverEpisodes,
} from "./workspace/index.js";
export type {
  WorkspaceKind,
  WorkspaceDescriptor,
  WorkspaceMeta,
  WorkspaceContract,
  ContractValidationResult,
  ContractValidator,
  InitOptions,
  InitResult,
  DiscoveryResult,
  DiscoveryDiagnostic,
  DiscoveryDiagnosticCode,
} from "./workspace/index.js";

// Settings (inheritance-based resolution)
export {
  resolveSettings,
  SYSTEM_DEFAULTS,
} from "./settings/index.js";
export type {
  ApprovalMode,
  GateBehaviour,
  ApprovalPolicy,
  BudgetEnvelope,
  OutputProfileRef,
  SettingsLayer,
  LayerName,
  ResolvedValue,
  ResolvedSettings,
  ResolutionReport,
  ResolutionEntry,
  ResolutionWarning,
} from "./settings/index.js";

// Pipeline (inheritance and DAG resolution)
export {
  resolvePipeline,
  PipelineResolutionError,
  InMemoryPipelineLoader,
  FileSystemPipelineLoader,
  createDefaultLoader,
  declaredPipeline,
  PipelineDeclarationError,
  createSnapshot,
  computeSnapshotHash,
  validateSnapshot,
  isSnapshotMutable,
  SnapshotError,
  InMemorySnapshotStore,
} from "./pipeline/index.js";
export type {
  DeclaredPipeline,
  ResolveOptions,
  CapabilityRequest,
  ArtifactRef,
  StageDefinition,
  StageGates,
  SkillRef,
  PipelineExtends,
  PipelineDefinition,
  ResolvedStage,
  ResolutionDiagSeverity,
  ResolutionDiag,
  ResolvedPipeline,
  PipelineLoader,
  SourceSnapshotRef,
  ProviderBinding,
  PipelineSnapshot,
  SnapshotInput,
  SnapshotStore,
} from "./pipeline/index.js";

// Artifacts (atomic revisioned storage)
export {
  ArtifactStore,
  ArtifactConflictError,
  computeRevisionId,
  diffSummary,
  InMemoryMutationQueue,
} from "./artifacts/index.js";
export type {
  RevisionId,
  RevisionMeta,
  ArtifactRead,
  ArtifactWriteResult,
  ConflictDiagnostic,
  MutationQueueEntry,
  MutationQueue,
  ArtifactStoreOptions,
} from "./artifacts/index.js";

// Journal (append-only event journal and projections)
export {
  Journal,
  JournalReader,
  hashLine,
  JOURNAL_ERRORS,
  buildProjection,
  applyEvent,
  mergeProjections,
  isJournalEvent,
} from "./journal/index.js";
export type {
  JournalWriteOptions,
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
  // Aliased: the execution service's `StageState` (exported below) is the one
  // callers want, and src/journal/ is the separate, unwired implementation
  // this package's execution path must not use.
  StageState as JournalStageState,
  ArtifactState,
  BudgetState,
  ReviewState,
  EpisodeProjection,
} from "./journal/index.js";

// Engine (stage state machine and executor)
export {
  StageStateMachine,
  StageTransitionError,
  LeaseError,
  StageExecutor,
  VALID_TRANSITIONS,
  DEFAULT_ENGINE_CONFIG,
} from "./engine/index.js";
export type {
  StageStatus,
  StageAttempt,
  StageInstance,
  ExecutionContext,
  EngineConfig,
  StageTransition,
  ExecutionStatus,
} from "./engine/index.js";

// Staleness (artifact dependency graph and staleness propagation)
export {
  StalenessEngine,
  propagate,
  buildDependencyGraph,
  findDownstream,
  findUpstream,
  detectCycles,
} from "./staleness/index.js";
export type {
  DependencyNode,
  DependencyEdge,
  DependencyGraph,
  StalenessReason,
  AffectedStage,
  StalenessReport,
  StalenessAcceptance,
} from "./staleness/index.js";

// Policy (approval gates). The budget is the journal's spend ledger in
// @studio/contracts/src/budget.mjs (avg-91o), guarded by JournalBudgetGuard.
export {
  checkGate,
  checkGates,
  detectDowngrade,
  PolicyError,
  POLICY_CODES,
} from "./policy/index.js";
export type {
  PolicyGate,
  GateDecision,
  GateCheckResult,
} from "./policy/index.js";

// Rerun (targeted reruns and crash recovery)
export {
  planRerun,
  analyzeRecovery,
  canResumeWithoutDuplicate,
} from "./rerun/index.js";
export type {
  RerunMode,
  RerunStageEntry,
  RerunPlan,
  RecoveryState,
} from "./rerun/index.js";

// Execution (one meaning for run/status/rerun)
export {
  ExecutionService, dependenciesMet, JournalReviewGate, REVIEW_SATISFIED_BY,
  JournalBudgetGuard, readEpisodeBudget, declaresPaidCapability,
} from "./execution/index.js";
export type {
  BudgetReport,
  DispatchContext, StageDispatcher, BudgetGuard, Reservation, ReviewGate, ReviewGateState, ReviewVerdict, ReviewContext,
  OutcomeStatus, StageOutcome, StageStatusReport, StageState, EpisodeStatus,
  ExecutionError, ExecutionServiceOptions, Principal, ReviewInput,
  TakeSummary, SelectInput, CandidateReport, StageTakesReport, EpisodeTakes,
} from "./execution/index.js";

// Package version (kept in sync with package.json by convention)
export const VERSION = "0.1.0";

// The operator's review of a layout sheet (avg-3th.2): the CLI's and the web
// studio's (avg-goz) one way to sign it.
export { reviewSheet, sheetReviewStatus } from "./sheet-review.js";
export type { SheetOutcome, SheetReviewStatus } from "./sheet-review.js";
