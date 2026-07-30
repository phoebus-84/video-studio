// ---------------------------------------------------------------------------
// Runtime E2E and fault-injection suite
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { resolveSettings, SYSTEM_DEFAULTS } from "../../src/settings/index.js";
import { resolvePipeline, InMemoryPipelineLoader, createSnapshot, InMemorySnapshotStore } from "../../src/pipeline/index.js";
import type { PipelineLoader } from "../../src/pipeline/types.js";
import type { PipelineDefinition } from "../../src/pipeline/types.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TEST_PIPELINE: PipelineDefinition = {
  name: "narrated-illustrated-video",
  version: "1.0.0",
  stages: [
    {
      id: "write-brief",
      name: "Write Brief",
      capabilities: [],
      dependsOn: [],
      produces: [{ kind: "text/markdown", label: "brief.md" }],
      consumes: [],
    },
    {
      id: "write-script",
      name: "Write Script",
      capabilities: [{ capability: "llm" }],
      dependsOn: ["write-brief"],
      produces: [{ kind: "text/markdown", label: "script.md" }],
      consumes: [{ kind: "text/markdown", label: "brief.md" }],
    },
    {
      id: "narration",
      name: "Narration",
      capabilities: [{ capability: "text-to-speech" }],
      dependsOn: ["write-script"],
      produces: [{ kind: "audio/wav", label: "narration.wav" }],
      consumes: [{ kind: "text/markdown", label: "script.md" }],
    },
    {
      id: "render",
      name: "Render",
      capabilities: [{ capability: "ffmpeg" }],
      dependsOn: ["narration"],
      produces: [{ kind: "video/mp4", label: "output.mp4" }],
      consumes: [
        { kind: "audio/wav", label: "narration.wav" },
        { kind: "text/markdown", label: "script.md" },
      ],
    },
  ],
  skills: [
    { name: "write-brief", path: "skills/write-brief.md" },
    { name: "write-script", path: "skills/write-script.md" },
  ],
};

function makeLoader(): PipelineLoader {
  const loader = new InMemoryPipelineLoader();
  loader.register(TEST_PIPELINE);
  return loader as unknown as PipelineLoader;
}

function emptyLayer() {
  return { approvalPolicy: void 0, budget: void 0, outputProfile: void 0, locale: void 0, extensions: void 0 };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Runtime E2E", () => {
  describe("settings resolution", () => {
    it("resolves system defaults", () => {
      const { settings } = resolveSettings({});
      expect(settings.approvalPolicy).toBeDefined();
      expect(settings.budget).toBeDefined();
      expect(settings.outputProfile).toBeDefined();
      expect(settings.locale).toBeDefined();
    });

    it("overrides via layers", () => {
      const { settings } = resolveSettings({
        channel: { ...emptyLayer(), locale: "fr-FR" },
      });
      expect(settings.locale.value).toBe("fr-FR");
    });

    it("respects null reset to default", () => {
      const { settings } = resolveSettings({
        channel: { ...emptyLayer(), locale: "de-DE" },
        series: { ...emptyLayer(), locale: null },
      });
      // null in series layer resets to system default
      expect(settings.locale.value).toBe(SYSTEM_DEFAULTS.locale);
    });

    it("undefined keeps parent value", () => {
      const { settings } = resolveSettings({
        channel: { ...emptyLayer(), locale: "fr-FR" },
        series: emptyLayer(), // locale is undefined → keep channel
      });
      expect(settings.locale.value).toBe("fr-FR");
    });
  });

  describe("pipeline resolution", () => {
    it("resolves pipeline name", async () => {
      const pipeline = await resolvePipeline(makeLoader(), "narrated-illustrated-video");
      expect(pipeline.name).toBeTruthy();
      expect(pipeline.stages.length).toBeGreaterThan(0);
    });

    it("pipeline stages are topologically sorted", async () => {
      const pipeline = await resolvePipeline(makeLoader(), "narrated-illustrated-video");
      for (let i = 0; i < pipeline.stages.length; i++) {
        expect(pipeline.stages[i]!.topoIndex).toBe(i);
      }
    });
  });

  describe("snapshot creation", () => {
    it("creates immutable snapshot with version", async () => {
      const { settings } = resolveSettings({});
      const pipeline = await resolvePipeline(makeLoader(), "narrated-illustrated-video");
      const snap = await createSnapshot({
        episodeSlug: "test/ch/series/ep1",
        pipeline,
        settings,
        providerBindings: [],
        sources: [],
        skillIds: [],
      });
      expect(snap.snapshotId).toBeTruthy();
      expect(snap.version).toBe(1);
      expect(snap.episodeSlug).toBe("test/ch/series/ep1");
      expect(snap.schema).toBe("pipeline-snapshot/v1alpha1");
    });

    it("increments version", async () => {
      const { settings } = resolveSettings({});
      const pipeline = await resolvePipeline(makeLoader(), "narrated-illustrated-video");
      const snap = await createSnapshot({
        episodeSlug: "test/ch/series/ep1",
        pipeline,
        settings,
        providerBindings: [],
        sources: [],
        skillIds: [],
        previousVersion: 3,
      });
      expect(snap.version).toBe(4);
    });
  });

  describe("snapshot store", () => {
    it("saves and loads by episode", async () => {
      const store = new InMemorySnapshotStore();
      const { settings } = resolveSettings({});
      const pipeline = await resolvePipeline(makeLoader(), "narrated-illustrated-video");
      const snap = await createSnapshot({
        episodeSlug: "test/ch/series/ep1", pipeline, settings,
        providerBindings: [], sources: [], skillIds: [],
      });
      await store.save(snap);
      const loaded = await store.loadLatest("test/ch/series/ep1");
      expect(loaded).toBeDefined();
      expect(loaded!.snapshotId).toBe(snap.snapshotId);
    });

    it("lists all versions", async () => {
      const store = new InMemorySnapshotStore();
      const { settings } = resolveSettings({});
      const pipeline = await resolvePipeline(makeLoader(), "narrated-illustrated-video");

      await store.save(await createSnapshot({
        episodeSlug: "test/ch/series/ep1", pipeline, settings,
        providerBindings: [], sources: [], skillIds: [], previousVersion: 0,
      }));
      await store.save(await createSnapshot({
        episodeSlug: "test/ch/series/ep1", pipeline, settings,
        providerBindings: [], sources: [], skillIds: [], previousVersion: 1,
      }));

      const versions = await store.listVersions("test/ch/series/ep1");
      expect(versions).toContain(1);
      expect(versions).toContain(2);
    });
  });

  describe("fault injection", () => {
    it("handles missing pipeline", async () => {
      await expect(resolvePipeline(makeLoader(), "nonexistent")).rejects.toThrow();
    });

    it("handles null layers", () => {
      const { settings } = resolveSettings({
        channel: null,
        series: null,
        episode: null,
      });
      expect(settings).toBeDefined();
      expect(settings.locale.value).toBe(SYSTEM_DEFAULTS.locale);
    });

    it("handles missing snapshot", async () => {
      const store = new InMemorySnapshotStore();
      expect(await store.loadLatest("no/such/ep")).toBeNull();
    });

    it("handles missing snapshot v2", async () => {
      const store = new InMemorySnapshotStore();
      const loaded = await store.loadVersion("test/ch/series/ep1", 99);
      expect(loaded).toBeNull();
    });

    it("pipeline resolution is deterministic", async () => {
      const p1 = await resolvePipeline(makeLoader(), "narrated-illustrated-video");
      const p2 = await resolvePipeline(makeLoader(), "narrated-illustrated-video");
      expect(p1.stages.length).toBe(p2.stages.length);
      expect(p1.name).toBe(p2.name);
    });
  });
});
