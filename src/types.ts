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
