import { describe, it, expect } from "vitest";
import { FakeFileSystem } from "../../fixtures/index.js";
import { FileSystemSnapshotStore } from "../../../src/pipeline/fs-snapshot-store.js";
import type { PipelineSnapshot } from "../../../src/pipeline/snapshot.js";

/**
 * `vpr resolve` used to compute a snapshot, print "Snapshot created" and
 * return without writing anything — only an in-memory store existed. The
 * resolved contract died with the process, so every later command reported
 * "Pipeline not found" and no episode could be driven.
 */
describe("FileSystemSnapshotStore", () => {
  const dirFor = (slug: string) => `/library/${slug.split("/").join("/")}`;

  const snapshot = (overrides: Record<string, unknown> = {}): PipelineSnapshot =>
    ({
      episodeSlug: "acme/s1/ep-01",
      snapshotId: "hash-one",
      version: 1,
      createdAt: "2026-08-15T00:00:00Z",
      pipeline: { name: "narrated", stages: [] },
      settings: {},
      providerBindings: [],
      sources: [],
      skillIds: [],
      ...overrides,
    }) as unknown as PipelineSnapshot;

  function makeStore() {
    const fs = new FakeFileSystem();
    return { fs, store: new FileSystemSnapshotStore(fs, dirFor) };
  }

  it("writes the version and the current pointer", async () => {
    const { fs, store } = makeStore();
    await store.save(snapshot());

    const version = await fs.readText("/library/acme/s1/ep-01/.snapshots/v1.json");
    const current = await fs.readText("/library/acme/s1/ep-01/pipeline.snapshot.yaml");
    expect(version.ok).toBe(true);
    expect(current.ok).toBe(true);
  });

  it("loads back what it saved", async () => {
    const { store } = makeStore();
    await store.save(snapshot());

    const loaded = await store.loadLatest("acme/s1/ep-01");
    expect(loaded?.snapshotId).toBe("hash-one");
    expect((await store.loadVersion("acme/s1/ep-01", 1))?.version).toBe(1);
  });

  it("is idempotent for the same pipeline", async () => {
    const { store } = makeStore();
    await store.save(snapshot());
    // A later resolve carries a new timestamp but the same contract hash;
    // comparing serialised bytes would wrongly read that as rewriting history.
    await expect(
      store.save(snapshot({ createdAt: "2026-09-01T00:00:00Z" })),
    ).resolves.toBeUndefined();
  });

  it("refuses to rewrite a version with a different pipeline", async () => {
    const { store } = makeStore();
    await store.save(snapshot());
    await expect(
      store.save(snapshot({ snapshotId: "hash-two" })),
    ).rejects.toThrow(/immutable/i);
  });

  it("lists versions in order", async () => {
    const { store } = makeStore();
    await store.save(snapshot());
    await store.save(snapshot({ version: 2, snapshotId: "hash-two" }));
    await store.save(snapshot({ version: 10, snapshotId: "hash-ten" }));

    expect(await store.listVersions("acme/s1/ep-01")).toEqual([1, 2, 10]);
  });

  it("answers null for an episode with no snapshot", async () => {
    const { store } = makeStore();
    expect(await store.loadLatest("acme/s1/never")).toBeNull();
    expect(await store.listVersions("acme/s1/never")).toEqual([]);
  });
});
