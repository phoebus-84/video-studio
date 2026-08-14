// ── File revisions ──────────────────────────────────────────────────────────
//
// Editing a text artifact used to be destructive. There was a
// `GET .../revisions/*` endpoint, but it read a `.revisions.json` sidecar that
// nothing ever wrote, so it always answered `[]` — and the studio never called
// it anyway. "Assets are versioned but you cannot move between versions" was
// generous: at the file level they were not versioned at all.
//
// Every write now snapshots the *previous* content first, so history accrues
// as a side effect of ordinary editing. Restoring is itself a write, so it
// snapshots too: nothing in here ever destroys a version.
//
// Snapshots live in `<level>/.revisions/<relative-path>/<id>`, beside the work
// rather than in a central store, so moving a workspace moves its history.
// ---------------------------------------------------------------------------

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";

/** Files larger than this are recorded as metadata only, never copied. */
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;

export interface RevisionMeta {
  /** Sortable identifier: ISO timestamp + short content hash. */
  id: string;
  createdAt: string;
  size: number;
  /** Content hash of the snapshot. */
  revision: string;
  /** False when the file was too large to copy; metadata was kept instead. */
  contentAvailable: boolean;
  /** Why the snapshot was taken. */
  reason: "edit" | "restore" | "delete";
}

const REVISIONS_DIR = ".revisions";

function hashOf(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/** Directory holding one file's snapshots. */
function storeFor(levelDir: string, relPath: string): string {
  return path.join(levelDir, REVISIONS_DIR, relPath);
}

/** A filename-safe, chronologically sortable revision id. */
function makeId(when: Date, revision: string): string {
  return `${when.toISOString().replace(/[:.]/g, "-")}__${revision}`;
}

/**
 * Snapshot a file's current content before it is overwritten or deleted.
 *
 * Returns null when there is nothing to snapshot, which is the normal case for
 * a file being created for the first time.
 */
export async function recordRevision(
  levelDir: string,
  relPath: string,
  absPath: string,
  reason: RevisionMeta["reason"] = "edit",
): Promise<RevisionMeta | null> {
  let stat;
  try {
    stat = await fs.stat(absPath);
  } catch {
    return null; // New file — no prior version exists.
  }
  if (!stat.isFile()) return null;

  const store = storeFor(levelDir, relPath);
  await fs.mkdir(store, { recursive: true });

  const tooLarge = stat.size > MAX_SNAPSHOT_BYTES;
  const content = tooLarge ? Buffer.alloc(0) : await fs.readFile(absPath);
  const revision = tooLarge ? `size-${stat.size}` : hashOf(content);
  const id = makeId(stat.mtime, revision);

  const meta: RevisionMeta = {
    id,
    createdAt: stat.mtime.toISOString(),
    size: stat.size,
    revision,
    contentAvailable: !tooLarge,
    reason,
  };

  // An identical snapshot already present means the file has not changed.
  try {
    await fs.access(path.join(store, `${id}.meta.json`));
    return meta;
  } catch { /* new snapshot */ }

  if (!tooLarge) await fs.writeFile(path.join(store, id), content);
  await fs.writeFile(path.join(store, `${id}.meta.json`), JSON.stringify(meta, null, 2));

  return meta;
}

/** Every snapshot of a file, newest first. */
export async function listRevisions(
  levelDir: string,
  relPath: string,
): Promise<RevisionMeta[]> {
  const store = storeFor(levelDir, relPath);
  let entries: string[];
  try {
    entries = await fs.readdir(store);
  } catch {
    return [];
  }

  const metas: RevisionMeta[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".meta.json")) continue;
    try {
      metas.push(JSON.parse(await fs.readFile(path.join(store, entry), "utf-8")));
    } catch { /* skip unreadable snapshot */ }
  }

  return metas.sort((a, b) => b.id.localeCompare(a.id));
}

/** The bytes of one snapshot, or null when it was too large to keep. */
export async function readRevision(
  levelDir: string,
  relPath: string,
  id: string,
): Promise<Buffer | null> {
  // `id` comes from a caller; keep it to a single path segment.
  if (id.includes("/") || id.includes("\\") || id.includes("..")) return null;
  try {
    return await fs.readFile(path.join(storeFor(levelDir, relPath), id));
  } catch {
    return null;
  }
}

/**
 * Restore a snapshot over the live file.
 *
 * The current content is snapshotted first, so restoring is undoable and no
 * version is ever lost.
 */
export async function restoreRevision(
  levelDir: string,
  relPath: string,
  absPath: string,
  id: string,
): Promise<{ restored: RevisionMeta | null; previous: RevisionMeta | null } | null> {
  const content = await readRevision(levelDir, relPath, id);
  if (content === null) return null;

  const previous = await recordRevision(levelDir, relPath, absPath, "restore");
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content);

  const all = await listRevisions(levelDir, relPath);
  return { restored: all.find((r) => r.id === id) ?? null, previous };
}
