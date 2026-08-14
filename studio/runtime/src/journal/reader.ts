// ---------------------------------------------------------------------------
// Journal reader — replay from cursor, rebuild projections
// ---------------------------------------------------------------------------

import type { FileSystem } from "../ports/filesystem.js";
import { ok, err, type Result } from "../result.js";
import type {
  EventCursor,
  JournalEvent,
} from "./types.js";

/**
 * Resumable journal reader.
 * Reads events from a cursor, emitting each event for projection.
 */
export class JournalReader {
  private fs: FileSystem;

  constructor(fs: FileSystem) {
    this.fs = fs;
  }

  /**
   * Read events newer than the given cursor.
   * If no cursor provided, reads all events from the beginning.
   */
  async readSince(
    journalPath: string,
    cursor?: EventCursor,
  ): Promise<Result<JournalEvent[], string>> {
    const result = await this.fs.readText(journalPath);
    if (!result.ok) {
      if (result.error.code === "ENOENT" || result.error.code === "NOT_FOUND") {
        return ok([]);
      }
      return err(`Failed to read journal: ${result.error.message}`);
    }

    const lines = result.value.split("\n");
    const events: JournalEvent[] = [];
    let foundCursor = !cursor; // if no cursor, read everything

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed) as JournalEvent;
        if (!event.type || typeof event.sequence !== "number") continue;

        // Skip events we've already consumed
        if (cursor && !foundCursor) {
          if (event.sequence <= cursor.sequence) continue;
          foundCursor = true; // all subsequent events are new
        }

        events.push(event);
      } catch {
        // Skip corrupted lines (truncated writes)
        continue;
      }
    }

    return ok(events);
  }

  /**
   * Read all events from the journal.
   */
  async readAll(journalPath: string): Promise<Result<JournalEvent[], string>> {
    return this.readSince(journalPath);
  }

  /**
   * Count events in the journal.
   */
  async count(journalPath: string): Promise<Result<number, string>> {
    const events = await this.readAll(journalPath);
    if (!events.ok) return events;
    return ok(events.value.length);
  }
}
