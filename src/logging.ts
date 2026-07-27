// ---------------------------------------------------------------------------
// Logger port
//
// Callers depend on the `Logger` interface; implementations swap at
// integration boundaries.  The default `ConsoleLogger` writes to stderr so
// stdout is reserved for machine-readable output.
// ---------------------------------------------------------------------------

/** Severity levels ordered by verbosity. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Structured-logger port.
 *
 * Every log call accepts an optional `meta` bag for machine-parseable
 * context (e.g. `{ stageId, episodeId }`).  Timestamps and level are the
 * implementation's responsibility.
 */
export interface Logger {
  /** Emit a message at the given level. */
  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void;

  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

// ---- Default implementation ------------------------------------------------

export interface ConsoleLoggerOptions {
  /** Minimum level to emit.  Default: "info". */
  minLevel?: LogLevel;
  /** When true, include a JSON payload on each line.  Default: false. */
  json?: boolean;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class ConsoleLogger implements Logger {
  private readonly minLevel: LogLevel;

  constructor(private readonly options: ConsoleLoggerOptions = {}) {
    this.minLevel = options.minLevel ?? "info";
  }

  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

    const ts = new Date().toISOString();
    if (this.options.json) {
      const payload = JSON.stringify({ ts, level, message, meta });
      if (level === "error") {
        process.stderr.write(`${payload}\n`);
      } else {
        process.stderr.write(`${payload}\n`);
      }
    } else {
      const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
      const line = `[${ts}] ${level.toUpperCase().padEnd(5)} ${message}${metaStr}\n`;
      process.stderr.write(line);
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log("debug", message, meta);
  }
  info(message: string, meta?: Record<string, unknown>): void {
    this.log("info", message, meta);
  }
  warn(message: string, meta?: Record<string, unknown>): void {
    this.log("warn", message, meta);
  }
  error(message: string, meta?: Record<string, unknown>): void {
    this.log("error", message, meta);
  }
}

// ---- No-op logger for tests ------------------------------------------------

export class NoopLogger implements Logger {
  log(_level: LogLevel, _message: string, _meta?: Record<string, unknown>): void {
    /* no-op */
  }
  debug(_message: string, _meta?: Record<string, unknown>): void {
    /* no-op */
  }
  info(_message: string, _meta?: Record<string, unknown>): void {
    /* no-op */
  }
  warn(_message: string, _meta?: Record<string, unknown>): void {
    /* no-op */
  }
  error(_message: string, _meta?: Record<string, unknown>): void {
    /* no-op */
  }
}
