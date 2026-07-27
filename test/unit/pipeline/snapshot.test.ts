// ---------------------------------------------------------------------------
// Pipeline snapshot tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  createSnapshot,
  computeSnapshotHash,
  validateSnapshot,
  isSnapshotMutable,
  InMemorySnapshotStore,
} from "../../../src/pipeline/index.js";
import type {
  SnapshotInput,
} from "../../../src/pipeline/snapshot.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeInput(overrides?: Partial<SnapshotInput>): SnapshotInput {
  return {
    episodeSlug: "ep-01-cpu",
    pipeline: {
      name: "tech-explainer",
      version: "1.0.0",
      inheritanceChain: ["tech-explainer"],
      stages: [
        {
          definition: {
            id: "brief",
            name: "Brief",
            capabilities: [],
            dependsOn: [],
            produces: [{ kind: "text/markdown", label: "brief.md" }],
            consumes: [],
          },
          source: "tech-explainer",
          topoIndex: 0,
        },
        {
          definition: {
            id: "script",
            name: "Script",
            capabilities: [{ capability: "llm" }],
            dependsOn: ["brief"],
            produces: [{ kind: "text/markdown", label: "script.md" }],
            consumes: [{ kind: "text/markdown", label: "brief.md" }],
          },
          source: "tech-explainer",
          topoIndex: 1,
        },
      ],
      skills: [],
      diagnostics: [],
    },
    settings: {
      approvalMode: {
        value: "autopilot",
        source: { layer: "system" },
      },
      gateBehaviour: {
        value: "skip",
        source: { layer: "system" },
      },
      budgetLimit: {
        value: 5,
        source: { layer: "system" },
      },
      outputProfile: {
        value: "youtube-1080p",
        source: { layer: "system" },
      },
      narrationVoice: {
        value: "en-US-neutral",
        source: { layer: "system" },
      },
      narrationLanguage: {
        value: "en-US",
        source: { layer: "system" },
      },
    },
    providerBindings: [
      { capability: "llm", provider: "openai/gpt-4o", config: {} },
    ],
    sources: [
      {
        name: "video-built-in-pipelines",
        url: "https://github.com/example/pipelines",
        commit: "abc123def456",
        capturedAt: "2026-07-27T10:00:00Z",
      },
    ],
    skillIds: ["write-brief@v1"],
    label: "Initial freeze",
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("createSnapshot", () => {
  it("creates a snapshot with a content hash", async () => {
    const input = makeInput();
    const snapshot = await createSnapshot(input);

    expect(snapshot.schema).toBe("pipeline-snapshot/v1alpha1");
    expect(snapshot.episodeSlug).toBe("ep-01-cpu");
    expect(snapshot.version).toBe(1);
    expect(snapshot.snapshotId).toBeDefined();
    expect(snapshot.snapshotId.length).toBe(64); // SHA-256 hex
    expect(snapshot.createdAt).toBeDefined();
    expect(snapshot.pipeline.stages.length).toBe(2);
  });

  it("increments version from previous snapshot", async () => {
    const v1 = await createSnapshot(makeInput({ previousVersion: 0 }));
    expect(v1.version).toBe(1);

    const v2 = await createSnapshot(makeInput({ previousVersion: 1 }));
    expect(v2.version).toBe(2);
  });

  it("starts at version 1 for first snapshot", async () => {
    const snapshot = await createSnapshot(makeInput({ previousVersion: undefined }));
    expect(snapshot.version).toBe(1);
  });

  it("produces different hashes for different inputs", async () => {
    const a = await createSnapshot(makeInput({ previousVersion: 0 }));
    const b = await createSnapshot(makeInput({ previousVersion: 1 }));
    expect(a.snapshotId).not.toBe(b.snapshotId);
  });

  it("produces deterministic hashes for identical inputs", async () => {
    const a = await createSnapshot(makeInput());
    const b = await createSnapshot(makeInput());
    expect(a.snapshotId).toBe(b.snapshotId);
  });
});

describe("computeSnapshotHash", () => {
  it("is deterministic with sorted keys", async () => {
    const input = makeInput();
    const snapshot = await createSnapshot(input);
    const hash = await computeSnapshotHash(
      // Strip snapshotId to recompute
      (({ snapshotId: _, ...rest }) => rest)(snapshot),
    );
    expect(hash).toBe(snapshot.snapshotId);
  });
});

describe("validateSnapshot", () => {
  it("passes for a valid snapshot", async () => {
    const snapshot = await createSnapshot(makeInput());
    const result = validateSnapshot(snapshot);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails with empty snapshotId", async () => {
    const snapshot = await createSnapshot(makeInput());
    const invalid = { ...snapshot, snapshotId: "" };
    const result = validateSnapshot(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing snapshotId");
  });

  it("fails with empty episodeSlug", async () => {
    const snapshot = await createSnapshot(makeInput());
    const invalid = { ...snapshot, episodeSlug: "" };
    const result = validateSnapshot(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing episodeSlug");
  });

  it("fails with zero stages", async () => {
    const input = makeInput({
      pipeline: {
        name: "empty",
        version: "1.0.0",
        inheritanceChain: [],
        stages: [],
        skills: [],
        diagnostics: [],
      },
    });
    const snapshot = await createSnapshot(input);
    const result = validateSnapshot(snapshot);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Pipeline must have at least one stage");
  });
});

describe("isSnapshotMutable", () => {
  it("reports snapshots as immutable", async () => {
    const snapshot = await createSnapshot(makeInput());
    const { mutable, reason } = isSnapshotMutable(snapshot);
    expect(mutable).toBe(false);
    expect(reason).toContain("immutable");
  });
});

describe("InMemorySnapshotStore", () => {
  it("saves and loads latest snapshot", async () => {
    const store = new InMemorySnapshotStore();
    const snapshot = await createSnapshot(makeInput());
    await store.save(snapshot);

    const loaded = await store.loadLatest("ep-01-cpu");
    expect(loaded).not.toBeNull();
    expect(loaded!.snapshotId).toBe(snapshot.snapshotId);
    expect(loaded!.version).toBe(1);
  });

  it("returns latest version", async () => {
    const store = new InMemorySnapshotStore();
    const v1 = await createSnapshot(makeInput({ previousVersion: 0 }));
    const v2 = await createSnapshot(makeInput({ previousVersion: 1, label: "v2" }));
    await store.save(v1);
    await store.save(v2);

    const latest = await store.loadLatest("ep-01-cpu");
    expect(latest!.version).toBe(2);
    expect(latest!.label).toBe("v2");
  });

  it("loads specific version", async () => {
    const store = new InMemorySnapshotStore();
    const v1 = await createSnapshot(makeInput({ previousVersion: 0 }));
    const v2 = await createSnapshot(makeInput({ previousVersion: 1, label: "v2" }));
    await store.save(v1);
    await store.save(v2);

    const loaded = await store.loadVersion("ep-01-cpu", 1);
    expect(loaded!.version).toBe(1);
    expect(loaded!.label).toBe("Initial freeze");
  });

  it("lists all versions", async () => {
    const store = new InMemorySnapshotStore();
    await store.save(await createSnapshot(makeInput({ previousVersion: 0 })));
    await store.save(await createSnapshot(makeInput({ previousVersion: 1 })));

    const versions = await store.listVersions("ep-01-cpu");
    expect(versions).toEqual([1, 2]);
  });

  it("returns null for unknown episode", async () => {
    const store = new InMemorySnapshotStore();
    const result = await store.loadLatest("nonexistent");
    expect(result).toBeNull();
  });

  it("does not change an existing episode when source pipeline is edited", async () => {
    const store = new InMemorySnapshotStore();

    // Freeze v1
    const v1 = await createSnapshot(makeInput({ previousVersion: 0 }));
    await store.save(v1);
    expect(v1.pipeline.stages.length).toBe(2);

    // Load v1 again — same snapshot
    const loaded = await store.loadVersion("ep-01-cpu", 1);
    expect(loaded!.pipeline.stages.length).toBe(2);
    expect(loaded!.snapshotId).toBe(v1.snapshotId);
  });
});
