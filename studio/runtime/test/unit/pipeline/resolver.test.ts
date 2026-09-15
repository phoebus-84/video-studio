// ---------------------------------------------------------------------------
// Pipeline resolver tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  resolvePipeline,
  PipelineResolutionError,
  InMemoryPipelineLoader,
} from "../../../src/pipeline/index.js";
import type {
  PipelineDefinition,
  ResolvedStage,
  ResolutionDiag,
} from "../../../src/pipeline/types.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SIMPLE_PIPELINE: PipelineDefinition = {
  name: "simple-video",
  version: "1.0.0",
  stages: [
    {
      id: "brief",
      name: "Brief",
      type: "capability",
      capabilities: [],
      dependsOn: [],
      produces: [{ kind: "text/markdown", label: "brief.md" }],
      consumes: [],
      gates: { autopilot: true, review: "none", retryOnFailure: 0 },
    },
    {
      id: "script",
      name: "Script",
      type: "capability",
      capabilities: [{ capability: "image.generate" }],
      dependsOn: ["brief"],
      produces: [{ kind: "text/markdown", label: "script.md" }],
      consumes: [{ kind: "text/markdown", label: "brief.md" }],
      gates: { autopilot: true, review: "none", retryOnFailure: 0 },
    },
    {
      id: "render",
      name: "Render",
      type: "capability",
      capabilities: [{ capability: "video.compose" }],
      dependsOn: ["script"],
      produces: [{ kind: "video/mp4", label: "output.mp4" }],
      consumes: [{ kind: "text/markdown", label: "script.md" }],
      gates: { autopilot: true, review: "none", retryOnFailure: 0 },
    },
  ],
  skills: [{ name: "write-brief", path: "skills/write-brief.md" }],
};

const CHILD_PIPELINE: PipelineDefinition = {
  name: "my-video",
  version: "1.0.0",
  extends: { pipeline: "simple-video", version: "1.0.0" },
  stages: [
    {
      id: "script",
      name: "Custom Script",
      type: "capability",
      capabilities: [{ capability: "image.generate", prefer: "claude" }],
      dependsOn: ["brief"],
      produces: [{ kind: "text/markdown", label: "script.md" }],
      consumes: [{ kind: "text/markdown", label: "brief.md" }],
      gates: { autopilot: true, review: "none", retryOnFailure: 0 },
    },
    {
      id: "illustrations",
      name: "Illustrations",
      type: "capability",
      capabilities: [{ capability: "image.generate" }],
      dependsOn: ["script"],
      produces: [{ kind: "image/png", label: "illustrations/" }],
      consumes: [{ kind: "text/markdown", label: "script.md" }],
      gates: { autopilot: true, review: "none", retryOnFailure: 0 },
    },
  ],
  skills: [{ name: "custom-script", path: "skills/custom-script.md" }],
};

const REMOVAL_PIPELINE: PipelineDefinition = {
  name: "minimal-video",
  version: "1.0.0",
  extends: { pipeline: "simple-video" },
  stages: [
    {
      id: "render",
      name: "Direct Render",
      type: "capability",
      capabilities: [{ capability: "video.compose" }],
      dependsOn: ["brief", "!script"],
      produces: [{ kind: "video/mp4", label: "output.mp4" }],
      consumes: [{ kind: "text/markdown", label: "brief.md" }],
      gates: { autopilot: true, review: "none", retryOnFailure: 0 },
    },
  ],
  skills: [],
};

const CYCLIC_PARENT: PipelineDefinition = {
  name: "cyclic-parent",
  version: "1.0.0",
  stages: [
    {
      id: "a",
      name: "A",
      type: "capability",
      capabilities: [],
      dependsOn: ["b"],
      produces: [],
      consumes: [],
      gates: { autopilot: true, review: "none", retryOnFailure: 0 },
    },
    {
      id: "b",
      name: "B",
      type: "capability",
      capabilities: [],
      dependsOn: ["a"],
      produces: [],
      consumes: [],
      gates: { autopilot: true, review: "none", retryOnFailure: 0 },
    },
  ],
  skills: [],
};

const INHERITANCE_CYCLE_A: PipelineDefinition = {
  name: "cycle-a",
  version: "1.0.0",
  extends: { pipeline: "cycle-b" },
  stages: [],
  skills: [],
};

const INHERITANCE_CYCLE_B: PipelineDefinition = {
  name: "cycle-b",
  version: "1.0.0",
  extends: { pipeline: "cycle-a" },
  stages: [],
  skills: [],
};

const MISSING_CONSUMER: PipelineDefinition = {
  name: "bad-consumer",
  version: "1.0.0",
  stages: [
    {
      id: "first",
      name: "First",
      type: "capability",
      capabilities: [],
      dependsOn: [],
      produces: [{ kind: "text/markdown", label: "output.md" }],
      consumes: [{ kind: "text/markdown", label: "nonexistent.md" }],
      gates: { autopilot: true, review: "none", retryOnFailure: 0 },
    },
  ],
  skills: [],
};

const SELF_DEPENDENCY: PipelineDefinition = {
  name: "self-dep",
  version: "1.0.0",
  stages: [
    {
      id: "loop",
      name: "Self Loop",
      type: "capability",
      capabilities: [],
      dependsOn: ["loop"],
      produces: [],
      consumes: [],
      gates: { autopilot: true, review: "none", retryOnFailure: 0 },
    },
  ],
  skills: [],
};

const MISSING_STAGE_DEP: PipelineDefinition = {
  name: "missing-dep",
  version: "1.0.0",
  stages: [
    {
      id: "only",
      name: "Only Stage",
      type: "capability",
      capabilities: [],
      dependsOn: ["ghost"],
      produces: [],
      consumes: [],
      gates: { autopilot: true, review: "none", retryOnFailure: 0 },
    },
  ],
  skills: [],
};

// ── Helper ───────────────────────────────────────────────────────────────────

function makeLoader(...defs: PipelineDefinition[]): InMemoryPipelineLoader {
  const loader = new InMemoryPipelineLoader();
  for (const d of defs) loader.register(d);
  return loader;
}

function stageIds(stages: ResolvedStage[]): string[] {
  return stages.map((s) => s.definition.id);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("resolvePipeline", () => {
  describe("simple pipeline (no inheritance)", () => {
    it("resolves a single pipeline with correct topo order", async () => {
      const loader = makeLoader(SIMPLE_PIPELINE);
      const result = await resolvePipeline(loader, "simple-video");

      expect(result.name).toBe("simple-video");
      expect(result.version).toBe("1.0.0");
      expect(result.inheritanceChain).toEqual(["simple-video"]);
      expect(result.diagnostics).toEqual([]);

      expect(stageIds(result.stages)).toEqual(["brief", "script", "render"]);
    });

    it("assigns topo indices in order", async () => {
      const loader = makeLoader(SIMPLE_PIPELINE);
      const result = await resolvePipeline(loader, "simple-video");

      result.stages.forEach((stage: ResolvedStage, idx: number) => {
        expect(stage.topoIndex).toBe(idx);
      });
    });

    it("preserves skills", async () => {
      const loader = makeLoader(SIMPLE_PIPELINE);
      const result = await resolvePipeline(loader, "simple-video");

      expect(result.skills).toEqual([
        { name: "write-brief", path: "skills/write-brief.md" },
      ]);
    });
  });

  describe("inheritance", () => {
    it("resolves child pipeline with parent inheritance", async () => {
      const loader = makeLoader(SIMPLE_PIPELINE, CHILD_PIPELINE);
      const result = await resolvePipeline(loader, "my-video");

      expect(result.inheritanceChain).toEqual(["simple-video", "my-video"]);

      const ids = stageIds(result.stages);
      expect(ids).toContain("brief");
      expect(ids).toContain("script");
      expect(ids).toContain("illustrations");
      expect(ids).toContain("render");
    });

    it("orders stages topologically after merge", async () => {
      const loader = makeLoader(SIMPLE_PIPELINE, CHILD_PIPELINE);
      const result = await resolvePipeline(loader, "my-video");

      const idx = (id: string) =>
        result.stages.findIndex((s: ResolvedStage) => s.definition.id === id);

      expect(idx("brief")).toBeLessThan(idx("script"));
      expect(idx("script")).toBeLessThan(idx("illustrations"));
      expect(idx("script")).toBeLessThan(idx("render"));
    });

    it("overrides stage properties from child", async () => {
      const loader = makeLoader(SIMPLE_PIPELINE, CHILD_PIPELINE);
      const result = await resolvePipeline(loader, "my-video");

      const script = result.stages.find(
        (s: ResolvedStage) => s.definition.id === "script",
      )!;
      expect(script.definition.name).toBe("Custom Script");
      expect(script.definition.capabilities[0]!.prefer).toBe("claude");
      expect(script.source).toBe("my-video");
    });

    it("emits override diagnostic for overridden stages", async () => {
      const loader = makeLoader(SIMPLE_PIPELINE, CHILD_PIPELINE);
      const result = await resolvePipeline(loader, "my-video");

      const overrideDiags = result.diagnostics.filter(
        (d: ResolutionDiag) => d.code === "STAGE_OVERRIDE",
      );
      expect(overrideDiags.length).toBeGreaterThanOrEqual(1);
      expect(overrideDiags[0]!.context).toBe("script");
    });

    it("merges skills from parent and child", async () => {
      const loader = makeLoader(SIMPLE_PIPELINE, CHILD_PIPELINE);
      const result = await resolvePipeline(loader, "my-video");

      expect(result.skills).toEqual(
        expect.arrayContaining([
          { name: "write-brief", path: "skills/write-brief.md" },
          { name: "custom-script", path: "skills/custom-script.md" },
        ]),
      );
    });
  });

  describe("stage removal", () => {
    it("removes a parent stage via !id marker", async () => {
      const loader = makeLoader(SIMPLE_PIPELINE, REMOVAL_PIPELINE);
      const result = await resolvePipeline(loader, "minimal-video");

      const ids = stageIds(result.stages);
      expect(ids).toContain("brief");
      expect(ids).not.toContain("script");
      expect(ids).toContain("render");
    });

    it("emits removal diagnostic", async () => {
      const loader = makeLoader(SIMPLE_PIPELINE, REMOVAL_PIPELINE);
      const result = await resolvePipeline(loader, "minimal-video");

      const removalDiags = result.diagnostics.filter(
        (d: ResolutionDiag) => d.code === "STAGE_REMOVED",
      );
      expect(removalDiags.length).toBe(1);
      expect(removalDiags[0]!.context).toBe("render");
    });
  });

  describe("error cases", () => {
    it("throws for missing pipeline", async () => {
      const loader = makeLoader();
      await expect(resolvePipeline(loader, "nonexistent")).rejects.toThrow(
        PipelineResolutionError,
      );
    });

    it("detects cycles in stage DAG", async () => {
      const loader = makeLoader(CYCLIC_PARENT);
      await expect(
        resolvePipeline(loader, "cyclic-parent"),
      ).rejects.toThrow(PipelineResolutionError);
    });

    it("detects inheritance cycles", async () => {
      const loader = makeLoader(INHERITANCE_CYCLE_A, INHERITANCE_CYCLE_B);
      await expect(resolvePipeline(loader, "cycle-a")).rejects.toThrow(
        PipelineResolutionError,
      );
    });

    it("rejects max depth exceeded", async () => {
      const deepDefs: PipelineDefinition[] = [];
      for (let i = 0; i < 12; i++) {
        deepDefs.push({
          name: `depth-${i}`,
          version: "1.0.0",
          extends:
            i > 0 ? { pipeline: `depth-${i - 1}` } : undefined,
          stages: [
            {
              id: "base",
              name: "Base",
              type: "capability",
              capabilities: [],
              dependsOn: [],
              produces: [],
              consumes: [],
              gates: { autopilot: true, review: "none", retryOnFailure: 0 },
            },
          ],
          skills: [],
        });
      }
      const loader = makeLoader(...deepDefs);
      await expect(resolvePipeline(loader, "depth-11")).rejects.toThrow(
        PipelineResolutionError,
      );
    });

    it("detects unmet artifact dependency", async () => {
      const loader = makeLoader(MISSING_CONSUMER);
      await expect(
        resolvePipeline(loader, "bad-consumer"),
      ).rejects.toThrow(PipelineResolutionError);
    });

    it("detects self-dependency as cycle", async () => {
      const loader = makeLoader(SELF_DEPENDENCY);
      await expect(resolvePipeline(loader, "self-dep")).rejects.toThrow(
        PipelineResolutionError,
      );
    });

    it("warns about missing stage in dependsOn", async () => {
      const loader = makeLoader(MISSING_STAGE_DEP);
      const result = await resolvePipeline(loader, "missing-dep");

      const diags = result.diagnostics.filter(
        (d: ResolutionDiag) => d.code === "MISSING_DEPENDENCY",
      );
      expect(diags.length).toBe(1);
      expect(diags[0]!.severity).toBe("warning");
      expect(diags[0]!.context).toBe("only");
    });
  });

  describe("determinism", () => {
    it("produces identical order regardless of declaration order", async () => {
      const shuffled: PipelineDefinition = {
        name: "shuffled",
        version: "1.0.0",
        stages: [
          {
            id: "render",
            name: "Render",
            type: "capability",
            capabilities: [{ capability: "video.compose" }],
            dependsOn: ["script"],
            produces: [{ kind: "video/mp4", label: "output.mp4" }],
            consumes: [{ kind: "text/markdown", label: "script.md" }],
            gates: { autopilot: true, review: "none", retryOnFailure: 0 },
          },
          {
            id: "script",
            name: "Script",
            type: "capability",
            capabilities: [{ capability: "image.generate" }],
            dependsOn: ["brief"],
            produces: [{ kind: "text/markdown", label: "script.md" }],
            consumes: [{ kind: "text/markdown", label: "brief.md" }],
            gates: { autopilot: true, review: "none", retryOnFailure: 0 },
          },
          {
            id: "brief",
            name: "Brief",
            type: "capability",
            capabilities: [],
            dependsOn: [],
            produces: [{ kind: "text/markdown", label: "brief.md" }],
            consumes: [],
            gates: { autopilot: true, review: "none", retryOnFailure: 0 },
          },
        ],
        skills: [],
      };

      const loader = makeLoader(shuffled);
      const result = await resolvePipeline(loader, "shuffled");

      expect(stageIds(result.stages)).toEqual(["brief", "script", "render"]);
    });
  });

  describe("load errors", () => {
    it("includes pipeline name and version in not-found error", async () => {
      const loader = makeLoader();
      try {
        await resolvePipeline(loader, "nope", "2.0.0");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PipelineResolutionError);
        const diags = (err as PipelineResolutionError).diagnostics;
        expect(diags[0]!.code).toBe("PIPELINE_NOT_FOUND");
        expect(diags[0]!.message).toContain("nope");
        expect(diags[0]!.message).toContain("2.0.0");
      }
    });
  });

  describe("capability validation", () => {
    it("accepts an all-editorial pipeline (no capabilities)", async () => {
      const loader = makeLoader({
        name: "editorial-only",
        version: "1.0.0",
        stages: [
          {
            id: "review",
            name: "Review",
            type: "editorial",
            capabilities: [],
            dependsOn: [],
            produces: [],
            consumes: [],
            gates: { autopilot: true, review: "none", retryOnFailure: 0 },
          },
          {
            id: "publish",
            name: "Publish",
            type: "editorial",
            capabilities: [],
            dependsOn: ["review"],
            produces: [],
            consumes: [],
            gates: { autopilot: true, review: "none", retryOnFailure: 0 },
          },
        ],
        skills: [],
      });
      const result = await resolvePipeline(loader, "editorial-only");
      expect(result.stages.length).toBe(2);
      expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    });

    it("accepts a pipeline with canonical capability image.generate", async () => {
      const loader = makeLoader({
        name: "image-pipeline",
        version: "1.0.0",
        stages: [
          {
            id: "generate",
            name: "Generate",
            type: "capability",
            capabilities: [{ capability: "image.generate" }],
            dependsOn: [],
            produces: [{ kind: "image", label: "output.png" }],
            consumes: [],
            gates: { autopilot: true, review: "none", retryOnFailure: 0 },
          },
        ],
        skills: [],
      });
      const result = await resolvePipeline(loader, "image-pipeline");
      expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    });

    it("rejects llm as unknown capability", async () => {
      const loader = makeLoader({
        name: "llm-pipeline",
        version: "1.0.0",
        stages: [
          {
            id: "script",
            name: "Script",
            type: "capability",
            capabilities: [{ capability: "llm" }],
            dependsOn: [],
            produces: [],
            consumes: [],
            gates: { autopilot: true, review: "none", retryOnFailure: 0 },
          },
        ],
        skills: [],
      });
      try {
        await resolvePipeline(loader, "llm-pipeline");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PipelineResolutionError);
        const diags = (err as PipelineResolutionError).diagnostics;
        expect(diags.some((d) => d.code === "stage.unknown-capability")).toBe(true);
        expect(diags.some((d) => d.message.includes("llm"))).toBe(true);
      }
    });

    it("rejects an unknown capability name", async () => {
      const loader = makeLoader({
        name: "unknown-cap",
        version: "1.0.0",
        stages: [
          {
            id: "magic",
            name: "Magic",
            type: "capability",
            capabilities: [{ capability: "magic.wand" }],
            dependsOn: [],
            produces: [],
            consumes: [],
            gates: { autopilot: true, review: "none", retryOnFailure: 0 },
          },
        ],
        skills: [],
      });
      try {
        await resolvePipeline(loader, "unknown-cap");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PipelineResolutionError);
        const diags = (err as PipelineResolutionError).diagnostics;
        expect(diags.some((d) => d.code === "stage.unknown-capability")).toBe(true);
      }
    });

    it("rejects editorial stage with capability requests", async () => {
      const loader = makeLoader({
        name: "bad-editorial",
        version: "1.0.0",
        stages: [
          {
            id: "draft",
            name: "Draft",
            type: "editorial",
            capabilities: [{ capability: "image.generate" }],
            dependsOn: [],
            produces: [],
            consumes: [],
            gates: { autopilot: true, review: "none", retryOnFailure: 0 },
          },
        ],
        skills: [],
      });
      try {
        await resolvePipeline(loader, "bad-editorial");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PipelineResolutionError);
        const diags = (err as PipelineResolutionError).diagnostics;
        expect(diags.some((d) => d.code === "stage.editorial-with-capability")).toBe(true);
      }
    });
  });

  describe("artifact kind validation", () => {
    it("maps .md to markdown, .json to json, .wav to audio", async () => {
      const loader = makeLoader({
        name: "kind-test",
        version: "1.0.0",
        stages: [
          {
            id: "producer",
            name: "Producer",
            type: "capability",
            capabilities: [{ capability: "image.generate" }],
            dependsOn: [],
            produces: [
              { kind: "markdown", label: "script.md" },
              { kind: "json", label: "data.json" },
              { kind: "audio", label: "voice.wav" },
            ],
            consumes: [],
            gates: { autopilot: true, review: "none", retryOnFailure: 0 },
          },
        ],
        skills: [],
      });
      const result = await resolvePipeline(loader, "kind-test");
      expect(result.diagnostics.filter((d) => d.code === "artifact.unknown-kind"))
        .toHaveLength(0);
    });

    it("emits warning for unknown artifact kind", async () => {
      const loader = makeLoader({
        name: "unknown-kind-test",
        version: "1.0.0",
        stages: [
          {
            id: "weird",
            name: "Weird",
            type: "capability",
            capabilities: [{ capability: "image.generate" }],
            dependsOn: [],
            produces: [{ kind: "unknown", label: "output.xyz" }],
            consumes: [],
            gates: { autopilot: true, review: "none", retryOnFailure: 0 },
          },
        ],
        skills: [],
      });
      const result = await resolvePipeline(loader, "unknown-kind-test");
      const warnings = result.diagnostics.filter(
        (d) => d.code === "artifact.unknown-kind" && d.severity === "warning",
      );
      expect(warnings.length).toBe(1);
    });
  });
});
