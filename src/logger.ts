// ─── Structured logger with auth-header redaction ─────────────────────
// Every log line is a single JSON object.  Authorization headers and
// fal-key values are automatically redacted so logs are safe to share.

/** Severity levels for structured logs. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Shape of a single log entry. */
export interface LogEntry {
  readonly ts: string;
  readonly level: LogLevel;
  readonly msg: string;
  readonly [key: string]: unknown;
}

/** Logger interface – injectable so tests can capture output. */
export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

// ─── Header / key patterns that must be redacted ──────────────────────

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "cookie",
  "set-cookie",
]);

const KEY_LIKE_KEYS = new Set([
  "falkey",
  "apikey",
  "secret",
  "token",
  "password",
  "credential",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "privatekey",
]);

const KEY_REDACTED = "***REDACTED***";

// ─── Implementation ───────────────────────────────────────────────────

export function createLogger(
  write: (entry: LogEntry) => void = defaultWrite,
): Logger {
  function log(
    level: LogLevel,
    msg: string,
    extra?: Record<string, unknown>,
  ) {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...(extra ? redactRecord(extra) : {}),
    };
    write(entry);
  }

  return {
    debug: (msg, extra) => log("debug", msg, extra),
    info: (msg, extra) => log("info", msg, extra),
    warn: (msg, extra) => log("warn", msg, extra),
    error: (msg, extra) => log("error", msg, extra),
  };
}

// ─── Redaction ────────────────────────────────────────────────────────

/**
 * Deep-clone and redact a record so no authorization header or key-like
 * value survives into log output.
 */
export function redactRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    const lower = key.toLowerCase();
    const normalized = lower.replace(/[-_]/g, "");

    if (SENSITIVE_HEADERS.has(lower)) {
      // Entire header value is redacted
      out[key] = KEY_REDACTED;
      continue;
    }

    if (KEY_LIKE_KEYS.has(normalized)) {
      // Never preserve a credential prefix or suffix in shareable logs.
      out[key] = KEY_REDACTED;
      continue;
    }

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      out[key] = redactRecord(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      out[key] = value.map((v) =>
        typeof v === "object" && v !== null && !Array.isArray(v)
          ? redactRecord(v as Record<string, unknown>)
          : v,
      );
    } else {
      out[key] = value;
    }
  }

  return out;
}

/**
 * Convenience: redact a single headers object where keys may be
 * `authorization` etc.
 */
export function redactHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  return redactRecord(headers) as Record<string, string>;
}

// ─── Default writer ───────────────────────────────────────────────────

function defaultWrite(entry: LogEntry): void {
  const line = JSON.stringify(entry);
  if (entry.level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}
