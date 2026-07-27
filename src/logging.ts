/**
 * Structured logger with redaction support.
 *
 * Produces JSON-line log entries. Secret strings in `redact` are replaced
 * with `[REDACTED]` before writing. The logger respects a minimum level.
 */

import type { LogEntry, Logger, LogLevel } from "./types.js";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function createLogger(
  minLevel: LogLevel = "info",
  redact: string[] = [],
  write: (line: string) => void = (s) => process.stderr.write(s + "\n"),
): Logger & { setRedact(secrets: string[]): void } {
  const secrets = [...redact];

  function redactText(text: string): string {
    let out = text;
    for (const s of secrets) {
      if (s.length === 0) continue;
      // Replace all occurrences (global, case-sensitive)
      const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(escaped, "g"), "[REDACTED]");
    }
    return out;
  }

  function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LEVELS[level] < LEVELS[minLevel]) return;

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context: context ? JSON.parse(JSON.stringify(context)) : undefined,
    };

    write(redactText(JSON.stringify(entry)));
  }

  return {
    debug: (m, c) => log("debug", m, c),
    info: (m, c) => log("info", m, c),
    warn: (m, c) => log("warn", m, c),
    error: (m, c) => log("error", m, c),
    setRedact(newSecrets: string[]) {
      secrets.length = 0;
      secrets.push(...newSecrets);
    },
  };
}
