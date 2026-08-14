// ---------------------------------------------------------------------------
// In-memory snapshot store for testing
// ---------------------------------------------------------------------------

import type { PipelineSnapshot, SnapshotStore } from "./snapshot.js";

/**
 * Map-based snapshot store.
 * Thread-safe for tests; no filesystem needed.
 */
export class InMemorySnapshotStore implements SnapshotStore {
  private snapshots = new Map<string, PipelineSnapshot[]>();

  async save(snapshot: PipelineSnapshot): Promise<void> {
    const key = snapshot.episodeSlug;
    const existing = this.snapshots.get(key) ?? [];
    // Replace existing version if it exists
    const idx = existing.findIndex((s) => s.version === snapshot.version);
    if (idx >= 0) {
      existing[idx] = snapshot;
    } else {
      existing.push(snapshot);
    }
    this.snapshots.set(key, existing);
  }

  async loadLatest(episodeSlug: string): Promise<PipelineSnapshot | null> {
    const versions = this.snapshots.get(episodeSlug);
    if (!versions || versions.length === 0) return null;
    return versions.reduce((a, b) => (a.version > b.version ? a : b));
  }

  async loadVersion(
    episodeSlug: string,
    version: number,
  ): Promise<PipelineSnapshot | null> {
    const versions = this.snapshots.get(episodeSlug);
    if (!versions) return null;
    return versions.find((s) => s.version === version) ?? null;
  }

  async listVersions(episodeSlug: string): Promise<number[]> {
    const versions = this.snapshots.get(episodeSlug);
    if (!versions) return [];
    return versions.map((s) => s.version).sort((a, b) => a - b);
  }
}
