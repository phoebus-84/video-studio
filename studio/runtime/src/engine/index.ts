// ---------------------------------------------------------------------------
// Engine module — public API
// ---------------------------------------------------------------------------

export {
  StageStateMachine,
  StageTransitionError,
  LeaseError,
  attemptsSinceLastSuccess,
} from "./state-machine.js";

export {
  StageExecutor,
} from "./executor.js";
export type { StageHandler, ExecutionStatus } from "./executor.js";

export {
  VALID_TRANSITIONS,
  DEFAULT_ENGINE_CONFIG,
} from "./types.js";
export type {
  StageStatus,
  StageAttempt,
  StageInstance,
  ExecutionContext,
  EngineConfig,
  StageTransition,
} from "./types.js";
