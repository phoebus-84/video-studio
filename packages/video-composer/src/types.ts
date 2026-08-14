/**
 * Core types for the ffmpeg-video-composer package.
 * All public types are versioned and stable within a major version.
 */

// ─── Discovery ───────────────────────────────────────────────────────────

/** Information about a discovered FFmpeg binary. */
export interface FfmpegInfo {
  /** Absolute path to the ffmpeg binary. */
  path: string;
  /** Absolute path to the ffprobe binary (sibling to ffmpeg). */
  ffprobePath: string;
  /** Raw version string (e.g. "ffmpeg version 6.1.1 Copyright ..."). */
  version: string;
  /** Parsed semver components. Null if unparseable. */
  parsed: FfmpegParsedVersion | null;
  /** Codecs reported by `ffmpeg -codecs`. */
  codecs: CodecEntry[];
  /** Filters reported by `ffmpeg -filters`. */
  filters: FilterEntry[];
}

/** Parsed FFmpeg version components. */
export interface FfmpegParsedVersion {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

/** A single codec entry from `ffmpeg -codecs`. */
export interface CodecEntry {
  name: string;
  description: string;
  type: "video" | "audio" | "subtitle" | "data" | "unknown";
  /** Whether this is an encoder (E), decoder (D), or both. */
  capabilities: CodecCapability[];
}

export type CodecCapability = "decode" | "encode" | "video" | "audio" | "intra" | "lossy" | "lossless";

/** A single filter entry from `ffmpeg -filters`. */
export interface FilterEntry {
  name: string;
  description: string;
  /** Whether this is a timeline (T) filter. */
  timeline: boolean;
  /** Whether this is a slice-threading (S) filter. */
  slice: boolean;
  /** Whether this processes commands (C). */
  command: boolean;
}


// ─── Process Runner ──────────────────────────────────────────────────────

/** Options for spawning a child process. */
export interface ProcessOptions {
  /** Working directory. Defaults to process.cwd(). */
  cwd?: string;
  /** Environment variables merged over process.env. */
  env?: Record<string, string>;
  /** Timeout in milliseconds. Process is killed when exceeded. */
  timeoutMs?: number;
  /** AbortSignal to cancel the process tree. */
  signal?: AbortSignal;
  /** Capture and return stderr. Defaults to true. */
  captureStderr?: boolean;
  /** Secret strings to redact from output/logs. */
  redact?: string[];
}

/** Result from a completed child process. */
export interface ProcessResult {
  /** Exit code. 0 for success, null if killed by signal. */
  exitCode: number | null;
  /** Signal name if killed (e.g. "SIGTERM", "SIGKILL"). */
  signal: string | null;
  /** Captured stdout as UTF-8. */
  stdout: string;
  /** Captured stderr as UTF-8. Empty when captureStderr=false. */
  stderr: string;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** Whether the process was cancelled via signal or timeout. */
  cancelled: boolean;
}


// ─── Workspace ───────────────────────────────────────────────────────────

/** A temporary workspace directory with lifecycle management. */
export interface Workspace {
  /** Absolute path to the workspace root directory. */
  root: string;
  /** Resolve a relative path within the workspace. */
  resolve: (...segments: string[]) => string;
  /** Clean up the workspace directory recursively. */
  cleanup: () => Promise<void>;
  /** Whether the workspace has been cleaned up. */
  cleaned: boolean;
}


// ─── Logging ─────────────────────────────────────────────────────────────

/** Log severity levels. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Structured log entry. */
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

/** Logger interface for dependency injection. */
export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}


// ─── Doctor ──────────────────────────────────────────────────────────────

/** Report from the doctor diagnostic. */
export interface DoctorReport {
  ffmpeg: FfmpegInfo | null;
  errors: string[];
  requiredCodecs: RequiredCapabilityReport;
  requiredFilters: RequiredCapabilityReport;
}

/** Report on required capabilities and whether they are satisfied. */
export interface RequiredCapabilityReport {
  required: string[];
  found: string[];
  missing: string[];
  satisfied: boolean;
}


// ─── Timeline ────────────────────────────────────────────────────────────

/** Version identifier for timeline contracts. */
export type TimelineVersion = "1.0";

/**
 * Canonical edit timeline — the single source of editorial intent.
 * All timings are in seconds; all coordinates in pixels.
 */
export interface Timeline {
  version: TimelineVersion;
  canvas: Canvas;
  scenes: Scene[];
  /** Optional output profile. */
  profile?: OutputProfile;
  /** Optional stale-dependency marker set by upstream systems. */
  stale?: StaleMarker;
}

/** Canvas dimensions and safe-area constraints. */
export interface Canvas {
  width: number;
  height: number;
  /** Safe area margins as fractions of the canvas (0–1). The sum of
   *  opposing margins must be < 1 for a usable content area. */
  safeArea?: SafeArea;
}

/** Safe-area inset fractions (0–1). */
export interface SafeArea {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Output encoding profile. */
export interface OutputProfile {
  fps: number;
  codec?: string;
  pixelFormat?: string;
}

/**
 * A single scene in the timeline.
 *
 * - `inPoint` / `outPoint` are source-media timestamps (seconds).
 * - `timelineStart` is the scene's placement on the output timeline.
 * - `duration` MUST equal `outPoint – inPoint` when provided; the validator
 *   never clamps or adjusts it silently.
 */
export interface Scene {
  id: string;
  asset: AssetRef;
  /** Source in-point (seconds). */
  inPoint: number;
  /** Source out-point (seconds). */
  outPoint: number;
  /** Start time on the output timeline (seconds). */
  timelineStart: number;
  /** Scene duration = outPoint – inPoint. Optional but validated if given. */
  duration?: number;
  transition?: Transition;
  caption?: Caption;
  audio?: AudioConfig;
  transform?: VisualTransform;
  filters?: VideoFilter[];
}

/** Reference to a media asset. */
export interface AssetRef {
  /** Filesystem path or workspace-relative path. */
  path: string;
  /** Expected content hash for integrity verification. */
  hash?: string;
  /** Opaque revision stamp provided by upstream systems. */
  revision?: string;
}

/** Cross-fade or wipe between adjacent scenes. */
export interface Transition {
  type: "dissolve" | "fade" | "wipe" | "none";
  /** Duration in seconds. */
  duration: number;
  easing?: string;
}

/** Text caption overlay within a scene. */
export interface Caption {
  text: string;
  /** Start time relative to scene start (seconds). */
  start: number;
  /** Duration in seconds. */
  duration: number;
  font?: string;
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
  position?: "top" | "bottom" | "center";
  offsetY?: number;
}

/** Per-scene audio configuration. */
export interface AudioConfig {
  /** Linear volume multiplier (≥ 0). */
  volume?: number;
  /** Fade-in duration (seconds). */
  fadeIn?: number;
  /** Fade-out duration (seconds). */
  fadeOut?: number;
  /** Mute this scene's audio stream. */
  mute?: boolean;
}

/** Visual transform applied to a scene. */
export interface VisualTransform {
  crop?: Crop;
  fit?: "contain" | "cover" | "fill" | "none";
  scale?: number;
  position?: { x: number; y: number };
}

/** Crop rectangle in source-pixel coordinates. */
export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A named video filter with optional parameters. */
export interface VideoFilter {
  name: string;
  params?: Record<string, string | number>;
}

/**
 * Stale-dependency marker.
 *
 * When an upstream system detects that an input has changed, it attaches
 * this marker so the validator can flag the stale reference before rendering.
 */
export interface StaleMarker {
  /** Which dependency is stale. */
  source: string;
  /** Human-readable reason. */
  reason: string;
  /** ISO-8601 timestamp of the detection. */
  detectedAt: string;
}

// ─── Validation ───────────────────────────────────────────────────────────

/** Result of timeline validation. */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
}

/** A single diagnostic message (error or warning). */
export interface ValidationMessage {
  code: string;
  message: string;
  /** JSON-Path-style location in the timeline (e.g. "$.scenes[0].asset.path"). */
  path: string;
  context?: Record<string, unknown>;
}

/**
 * Asset probe — injectable function that checks asset properties
 * without invoking real FFmpeg or shell calls.
 *
 * Returns `null` when the asset cannot be probed (missing, unreadable)
 * or a minimal metadata record otherwise.
 */
export type AssetProbe = (path: string) => Promise<AssetProbeResult | null>;

/** Minimal asset metadata returned by an {@link AssetProbe}. */
export interface AssetProbeResult {
  /** Actual file hash (algorithm-agnostic). */
  hash?: string;
  /** Revision stamp from the probe's metadata store. */
  revision?: string;
  /** File size in bytes. */
  size?: number;
}

/** Options for the timeline validator. */
export interface ValidationOptions {
  /** Injectable asset probing function. Omit to skip asset-level checks. */
  assetProbe?: AssetProbe;
  /** Treat warnings as errors (for strict validation). */
  strict?: boolean;
}

// ─── Errors ──────────────────────────────────────────────────────────────

/** Base error class for all composer errors. */
export class ComposerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ComposerError";
  }
}

export class FfmpegNotFoundError extends ComposerError {
  constructor(message = "FFmpeg binary not found on PATH") {
    super(message, "FFMPEG_NOT_FOUND");
    this.name = "FfmpegNotFoundError";
  }
}

export class ProcessCancelledError extends ComposerError {
  constructor(signal: string) {
    super(`Process cancelled via ${signal}`, "PROCESS_CANCELLED", { signal });
    this.name = "ProcessCancelledError";
  }
}

export class ProcessTimeoutError extends ComposerError {
  constructor(timeoutMs: number) {
    super(`Process timed out after ${timeoutMs}ms`, "PROCESS_TIMEOUT", { timeoutMs });
    this.name = "ProcessTimeoutError";
  }
}

export class WorkspaceError extends ComposerError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "WORKSPACE_ERROR", context);
    this.name = "WorkspaceError";
  }
}

export class TimelineValidationError extends ComposerError {
  constructor(
    message: string,
    public readonly diagnostics: ValidationResult,
  ) {
    super(message, "TIMELINE_VALIDATION_FAILED", { errors: diagnostics.errors.length });
    this.name = "TimelineValidationError";
  }
}
