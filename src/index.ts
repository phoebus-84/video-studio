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

// Package version (kept in sync with package.json by convention)
export const VERSION = "0.1.0";
