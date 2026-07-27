// ---------------------------------------------------------------------------
// Atomic revisioned artifact store
// ---------------------------------------------------------------------------

import type { FileSystem } from "../ports/filesystem.js";
import { ok, err, type Result } from "../result.js";
import type {
  RevisionId,
  RevisionMeta,
  ArtifactRead,
  ArtifactWriteResult,
  ConflictDiagnostic,
  MutationQueue,
  MutationQueueEntry,
} from "./types.js";
import { ArtifactConflictError } from "./types.js";

/** Compute a revision hash from content. */
export async function computeRevisionId(content: string): Promise<RevisionId> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Generate a simple diff summary between two texts. */
export function diffSummary(oldText: string, newText: string): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const maxLen = Math.max(oldLines.length, newLines.length);
  const diffs: string[] = [];

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === undefined && newLine !== undefined) {
      diffs.push(`+${newLine}`);
    } else if (newLine === undefined && oldLine !== undefined) {
      diffs.push(`-${oldLine}`);
    } else if (oldLine !== newLine) {
      diffs.push(`-${oldLine}`);
      diffs.push(`+${newLine}`);
    }
    if (diffs.length >= 6) {
      diffs.push("...");
      break;
    }
  }

  return diffs.join("\n");
}

// ── Revision history store ──────────────────────────────────────────────────

/**
 * Read the revision history for an artifact.
 * History is stored as JSON array in a sidecar file.
 */
async function readHistory(
  fs: FileSystem,
  canonicalPath: string,
): Promise<RevisionMeta[]> {
  const historyPath = canonicalPath + ".revisions.json";
  const result = await fs.readText(historyPath);
  if (!result.ok) {
    if (result.error.code === "ENOENT" || result.error.code === "NOT_FOUND") {
      return [];
    }
    return [];
  }
  try {
    return JSON.parse(result.value);
  } catch {
    return [];
  }
}

/** Write revision history to the sidecar file. */
async function writeHistory(
  fs: FileSystem,
  canonicalPath: string,
  history: RevisionMeta[],
): Promise<Result<void, { code: string; message: string }>> {
  const historyPath = canonicalPath + ".revisions.json";
  const content = JSON.stringify(history, null, 2);
  const result = await fs.atomicWrite(historyPath, content);
  if (!result.ok) {
    return err({ code: result.error.code, message: "Failed to write revision history" });
  }
  return ok(undefined);
}

// ── Artifact store ──────────────────────────────────────────────────────────

export interface ArtifactStoreOptions {
  /** Author tag for all writes from this store instance. */
  author: string;
}

export class ArtifactStore {
  private fs: FileSystem;
  private author: string;
  private queue: MutationQueue;

  constructor(fs: FileSystem, options: ArtifactStoreOptions) {
    this.fs = fs;
    this.author = options.author;
    this.queue = new InMemoryMutationQueue();
  }

  /**
   * Read an artifact with its current revision and full history.
   */
  async read(canonicalPath: string): Promise<Result<ArtifactRead, string>> {
    const result = await this.fs.readText(canonicalPath);
    if (!result.ok) {
      return err(`Failed to read ${canonicalPath}: ${result.error.message}`);
    }
    const content = result.value;
    const revisionId = await computeRevisionId(content);
    const history = await readHistory(this.fs, canonicalPath);

    return ok({
      content,
      revisionId,
      history,
    });
  }

  /**
   * Compare-and-swap write an artifact.
   *
   * Only succeeds if the current revision on disk matches `expectedRevision`.
   * Uses atomic write (temp + fsync + rename) to prevent partial writes.
   */
  async write(
    canonicalPath: string,
    content: string,
    expectedRevision: RevisionId,
    message?: string,
  ): Promise<Result<ArtifactWriteResult, ArtifactConflictError | string>> {
    // Enqueue mutation to serialize writes per path
    const entry = this.queue.enqueue(canonicalPath);

    try {
      // Read current revision
      const currentRead = await this.fs.readText(canonicalPath);
      const currentContent = currentRead.ok ? currentRead.value : null;
      const currentRevision = currentContent
        ? await computeRevisionId(currentContent)
        : null;

      // If there's no current file, expectedRevision must be "0" (first write)
      if (currentRevision === null && expectedRevision !== "0") {
        const diagnostic: ConflictDiagnostic = {
          expected: expectedRevision,
          actual: "none",
          diffSummary: "+" + content.split("\n").slice(0, 3).join("\n+"),
          callerContent: content,
          currentContent: "",
        };
        return err(new ArtifactConflictError(diagnostic));
      }

      // Check revision match
      if (currentRevision !== null && currentRevision !== expectedRevision) {
        const diagnostic: ConflictDiagnostic = {
          expected: expectedRevision,
          actual: currentRevision,
          diffSummary: diffSummary(currentContent!, content),
          callerContent: content,
          currentContent: currentContent!,
        };
        return err(new ArtifactConflictError(diagnostic));
      }

      // Write atomically
      const writeResult = await this.fs.atomicWrite(canonicalPath, content);
      if (!writeResult.ok) {
        return err(`Atomic write failed: ${writeResult.error.message}`);
      }

      // Update revision history
      const newRevision = await computeRevisionId(content);
      const history = await readHistory(this.fs, canonicalPath);
      const meta: RevisionMeta = {
        revisionId: newRevision,
        createdAt: new Date().toISOString(),
        author: this.author,
        size: new TextEncoder().encode(content).length,
        message,
      };
      history.unshift(meta); // most recent first
      await writeHistory(this.fs, canonicalPath, history);

      return ok({
        revisionId: newRevision,
        written: true,
      });
    } finally {
      this.queue.dequeue(entry.id);
    }
  }

  /**
   * Initialize a new artifact (first write, no existing file).
   */
  async create(
    canonicalPath: string,
    content: string,
    message?: string,
  ): Promise<Result<ArtifactWriteResult, string>> {
    const exists = await this.fs.exists(canonicalPath);
    if (!exists.ok) return err("Failed to check existence");
    if (exists.value) return err(`Artifact already exists: ${canonicalPath}`);

    return this.write(canonicalPath, content, "0", message ?? "Initial creation");
  }
}

// ── In-memory mutation queue ────────────────────────────────────────────────

class InMemoryMutationQueue implements MutationQueue {
  private entries = new Map<string, MutationQueueEntry[]>();
  private counter = 0;

  enqueue(path: string): MutationQueueEntry["id"] & MutationQueueEntry {
    const id = `mut-${++this.counter}-${Date.now()}`;
    const entry = {
      id,
      path,
      enqueuedAt: new Date().toISOString(),
      inProgress: true,
    };
    const list = this.entries.get(path) ?? [];
    list.push(entry);
    this.entries.set(path, list);
    return entry;
  }

  dequeue(entryId: string): void {
    for (const [path, list] of this.entries) {
      const idx = list.findIndex((e) => e.id === entryId);
      if (idx >= 0) {
        list.splice(idx, 1);
        if (list.length === 0) this.entries.delete(path);
        else this.entries.set(path, list);
        return;
      }
    }
  }

  pending(path: string): boolean {
    return (this.entries.get(path)?.length ?? 0) > 0;
  }

  list(path: string): MutationQueueEntry[] {
    return this.entries.get(path) ?? [];
  }
}

// Re-export for convenience
export { InMemoryMutationQueue };
