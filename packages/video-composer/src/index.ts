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
  // Timeline
  Timeline,
  TimelineVersion,
  Canvas,
  SafeArea,
  OutputProfile,
  Scene,
  AssetRef,
  Transition,
  Caption,
  AudioConfig,
  VisualTransform,
  Crop,
  VideoFilter,
  StaleMarker,
  // Validation
  ValidationResult,
  ValidationMessage,
  ValidationOptions,
  AssetProbe,
  AssetProbeResult,
} from "./types.js";

export {
  ComposerError,
  FfmpegNotFoundError,
  ProcessCancelledError,
  ProcessTimeoutError,
  WorkspaceError,
  TimelineValidationError,
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

// Validator
export { validateTimeline } from "./validator.js";

// Canonical narration manifest projection
export { narrationCompositionInput } from "./narration.js";
export type { CanonicalNarrationManifest, NarrationCompositionInput } from "./narration.js";

// Delivery QA. Part of this package's charter ("plus ffprobe and audio/video
// delivery QA") but previously reachable only by importing src/qa.ts directly,
// which forced consumers to bypass the public API.
export { runQa } from "./qa.js";
export type { QaCheck, QaReport, QaOptions } from "./qa.js";
