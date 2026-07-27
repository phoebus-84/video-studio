/**
 * Public API surface of ffmpeg-video-composer.
 *
 * All exports here are versioned and stable within a major version.
 * Internal modules (process-runner internals, parsing details) are
 * not re-exported unless they are part of the public contract.
 */

// Types
export type {
  FfmpegInfo,
  FfmpegParsedVersion,
  CodecEntry,
  CodecCapability,
  FilterEntry,
  ProcessOptions,
  ProcessResult,
  Workspace,
  LogEntry,
  LogLevel,
  Logger,
  DoctorReport,
  RequiredCapabilityReport,
} from "./types.js";

export {
  ComposerError,
  FfmpegNotFoundError,
  ProcessCancelledError,
  ProcessTimeoutError,
  WorkspaceError,
} from "./types.js";

// Discovery
export {
  discoverFfmpeg,
  discoverFfmpegOrThrow,
  buildFfmpegInfo,
  parseVersion,
  parseCodecs,
  parseFilters,
} from "./discovery.js";

// Process runner
export { runProcess } from "./process-runner.js";

// Workspace
export { createWorkspace, workspaceSubdir } from "./workspace.js";

// Doctor
export { runDoctor } from "./doctor.js";

// Logging
export { createLogger } from "./logging.js";
