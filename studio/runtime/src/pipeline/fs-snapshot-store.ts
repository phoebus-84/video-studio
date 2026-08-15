// ---------------------------------------------------------------------------
// Filesystem snapshot store
// ---------------------------------------------------------------------------
// `vpr resolve` computed a snapshot, printed "Snapshot created", and returned —
// nothing was written. Only an in-memory store existed, so the resolved
// pipeline died with the process and every later command reported "Pipeline
// not found". An episode could never be driven, because the contract that
// governs it was never on disk.
//
// A snapshot is immutable (ADR-0021): each version is written once under
// `.snapshots/`, and `pipeline.snapshot.yaml` points at the current one. Saving
// the same version with different content is refused rather than silently
// rewriting the contract an episode was produced under.
// ---------------------------------------------------------------------------

import * as path from "node:path";
import type { PipelineSnapshot, SnapshotStore } from "./snapshot.js";
import type { FileSystem } from "../ports/filesystem.js";

/** Directory inside an episode holding every version. */
const VERSIONS_DIR = ".snapshots";

/** File naming the current snapshot, per the workspace contract. */
const CURRENT_FILE = "pipeline.snapshot.yaml";

export class FileSystemSnapshotStore implements SnapshotStore {
  constructor(
    private readonly fs: FileSystem,
    /** Library root; episode slugs resolve beneath it. */
    private readonly episodeDirFor: (episodeSlug: string) => string,
  ) {}

  async save(snapshot: PipelineSnapshot): Promise<void> {
    const dir = this.episodeDirFor(snapshot.episodeSlug);
    const versionsDir = path.join(dir, VERSIONS_DIR);
    const versionFile = path.join(versionsDir, `v${snapshot.version}.json`);

    const serialised = JSON.stringify(snapshot, null, 2) + "\n";

    // Immutability: a version already on disk may not change.
    //
    // Sameness is the snapshotId — the hash of the pipeline and settings that
    // define the contract — not the serialised bytes, which carry a creation
    // timestamp. Comparing bytes would make re-resolving an unchanged pipeline
    // look like an attempt to rewrite history.
    const existing = await this.fs.readText(versionFile);
    if (existing.ok) {
      const previous = this.#parse(existing.value);
      if (previous && previous.snapshotId === snapshot.snapshotId) return;
      throw new Error(
        `Snapshot v${snapshot.version} already exists for ${snapshot.episodeSlug} ` +
          `with a different pipeline (${previous?.snapshotId ?? "unreadable"} != ` +
          `${snapshot.snapshotId}). Snapshots are immutable; resolve a new version instead.`,
      );
    }

    await this.fs.mkdir(versionsDir, true);
    await this.fs.writeText(versionFile, serialised);

    // The pointer is written after the version, so a crash between the two
    // leaves an unreferenced version rather than a dangling pointer.
    await this.fs.writeText(path.join(dir, CURRENT_FILE), serialised);
  }

  async loadLatest(episodeSlug: string): Promise<PipelineSnapshot | null> {
    const current = path.join(this.episodeDirFor(episodeSlug), CURRENT_FILE);
    const read = await this.fs.readText(current);
    if (!read.ok) return null;
    return this.#parse(read.value);
  }

  async loadVersion(episodeSlug: string, version: number): Promise<PipelineSnapshot | null> {
    const file = path.join(this.episodeDirFor(episodeSlug), VERSIONS_DIR, `v${version}.json`);
    const read = await this.fs.readText(file);
    if (!read.ok) return null;
    return this.#parse(read.value);
  }

  async listVersions(episodeSlug: string): Promise<number[]> {
    const dir = path.join(this.episodeDirFor(episodeSlug), VERSIONS_DIR);
    const listed = await this.fs.readDir(dir);
    if (!listed.ok) return [];

    return listed.value
      .map((entry) => /^v(\d+)\.json$/.exec(entry))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);
  }

  #parse(raw: string): PipelineSnapshot | null {
    try {
      return JSON.parse(raw) as PipelineSnapshot;
    } catch {
      return null;
    }
  }
}
