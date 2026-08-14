// ---------------------------------------------------------------------------
// Append-only JSONL journal writer with corruption detection
// ---------------------------------------------------------------------------

import type { FileSystem } from "../ports/filesystem.js";
import { ok, err, type Result } from "../result.js";
import type {
  EventSequence,
  EventCursor,
  CorrelationId,
  CausationId,
  JournalEvent,
  BaseJournalEvent,
} from "./types.js";

/** Error codes for journal operations. */
export const JOURNAL_ERRORS = {
  CORRUPTED: "JOURNAL_CORRUPTED",
  WRITE_FAILED: "JOURNAL_WRITE_FAILED",
  SEQUENCE_MISMATCH: "JOURNAL_SEQUENCE_MISMATCH",
} as const;

/** Journal write options. */
export interface JournalWriteOptions {
  /** Parent correlation ID to link events. */
  correlationId?: CorrelationId;
  /** The event that caused this one. */
  causationId?: CausationId;
}

/**
 * Append-only JSONL journal.
 *
 * Each event is written as one JSON line terminated by \n.
 * The journal file is named `{episodeSlug}.journal.jsonl`.
 */
export class Journal {
  private fs: FileSystem;
  private sequence: EventSequence = 0;
  private lastHash = "";

  constructor(fs: FileSystem) {
    this.fs = fs;
  }

  /**
   * Initialize the journal from an existing file.
   * Scans the last valid line to recover the sequence counter and hash.
   */
  async init(journalPath: string): Promise<Result<EventSequence, string>> {
    const result = await this.fs.readText(journalPath);
    if (!result.ok) {
      if (result.error.code === "ENOENT" || result.error.code === "NOT_FOUND") {
        // New journal — start at 0
        this.sequence = 0;
        this.lastHash = "";
        return ok(0);
      }
      return err(`Failed to read journal: ${result.error.message}`);
    }

    const lines = result.value.trimEnd().split("\n");
    if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) {
      this.sequence = 0;
      this.lastHash = "";
      return ok(0);
    }

    // Find last valid line
    let lastSeq = 0;
    let lastLine = "";
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!.trim();
      if (!line) continue;
      try {
        const event = JSON.parse(line) as BaseJournalEvent;
        if (typeof event.sequence === "number") {
          lastSeq = event.sequence;
          lastLine = line;
          break;
        }
      } catch {
        // Skip corrupted lines (truncated write recovery)
        continue;
      }
    }

    // Compute hash of last valid line for corruption detection
    this.sequence = lastSeq;
    this.lastHash = await hashLine(lastLine);
    return ok(lastSeq);
  }

  /**
   * Append a single event to the journal.
   * Atomic: the single write of the line plus newline is the unit of atomicity.
   */
  async append(
    journalPath: string,
    event: Omit<JournalEvent, "sequence" | "timestamp"> & { episodeSlug: string },
    options: JournalWriteOptions = {},
  ): Promise<Result<{ sequence: EventSequence; hash: string }, string>> {
    this.sequence += 1;

    const fullEvent: JournalEvent = {
      ...event,
      sequence: this.sequence,
      timestamp: new Date().toISOString(),
      correlationId: options.correlationId,
      causationId: options.causationId,
    } as JournalEvent;

    const line = JSON.stringify(fullEvent) + "\n";
    const hash = await hashLine(line.trimEnd());

    // Append the line by reading current file, appending, and atomically writing
    // This is safe because we hold the mutation queue lock
    const currentResult = await this.fs.readText(journalPath);
    let current = "";
    if (currentResult.ok) {
      current = currentResult.value;
    } else if (
      currentResult.error.code !== "ENOENT" &&
      currentResult.error.code !== "NOT_FOUND"
    ) {
      return err(`Failed to read journal for append: ${currentResult.error.message}`);
    }

    const updated = current + line;
    const writeResult = await this.fs.atomicWrite(journalPath, updated);
    if (!writeResult.ok) {
      // Rollback sequence
      this.sequence -= 1;
      return err(JOURNAL_ERRORS.WRITE_FAILED + ": " + writeResult.error.message);
    }

    this.lastHash = hash;
    return ok({ sequence: this.sequence, hash });
  }

  /**
   * Get the current cursor for resuming reads.
   */
  getCursor(): EventCursor {
    return {
      sequence: this.sequence,
      hash: this.lastHash,
    };
  }

  /**
   * Verify journal integrity from cursor.
   * Returns the last valid sequence number, or an error if corruption detected.
   */
  async verify(
    journalPath: string,
    cursor?: EventCursor,
  ): Promise<Result<EventSequence, string>> {
    const result = await this.fs.readText(journalPath);
    if (!result.ok) {
      if (result.error.code === "ENOENT" || result.error.code === "NOT_FOUND") {
        return ok(0);
      }
      return err(`Failed to read journal: ${result.error.message}`);
    }

    const lines = result.value.split("\n");
    let lastSeq = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (!line) continue;

      try {
        const event = JSON.parse(line) as BaseJournalEvent;
        if (typeof event.sequence !== "number") {
          return err(`Corrupted journal: line ${i + 1} has no sequence number`);
        }
        if (cursor && event.sequence <= cursor.sequence) {
          // Already consumed
          continue;
        }
        lastSeq = event.sequence;
      } catch {
        return err(
          `Corrupted journal: line ${i + 1} is not valid JSON (truncated write detected)`,
        );
      }
    }

    return ok(lastSeq);
  }
}

/** Compute a SHA-256 hash of a line for corruption detection. */
export async function hashLine(line: string): Promise<string> {
  const data = new TextEncoder().encode(line);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
