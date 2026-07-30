// ---------------------------------------------------------------------------
// Staleness tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  buildDependencyGraph,
  findDownstream,
  findUpstream,
  detectCycles,
  StalenessEngine,
  propagate,
} from "../../../src/staleness/index.js";
import type { ResolvedPipeline } from "../../../src/pipeline/types.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * Script → Narration → Render
 * Script → Captions → Render
 * Script → Illustrations → Render
 * Script → Timing → Render
 */
function makeVideoPipeline(): ResolvedPipeline {
  return {
    name: "video-pipeline",
    version: "1.0.0",
    inheritanceChain: ["video-pipeline"],
    stages: [
      {
        definition: {
          id: "script",
          name: "Script",
          capabilities: [{ capability: "llm" }],
          dependsOn: [],
          produces: [{ kind: "text/markdown", label: "script.md" }],
          consumes: [],
        },
        source: "video-pipeline",
        topoIndex: 0,
      },
      {
        definition: {
          id: "narration",
          name: "Narration",
          capabilities: [{ capability: "tts" }],
          dependsOn: ["script"],
          produces: [{ kind: "audio/mp3", label: "narration.mp3" }],
          consumes: [{ kind: "text/markdown", label: "script.md" }],
        },
        source: "video-pipeline",
        topoIndex: 1,
      },
      {
        definition: {
          id: "captions",
          name: "Captions",
          capabilities: [{ capability: "transcription" }],
          dependsOn: ["narration"],
          produces: [{ kind: "text/srt", label: "captions.srt" }],
          consumes: [{ kind: "audio/mp3", label: "narration.mp3" }],
        },
        source: "video-pipeline",
        topoIndex: 2,
      },
      {
        definition: {
          id: "timing",
          name: "Timing",
          capabilities: [{ capability: "analysis" }],
          dependsOn: ["script"],
          produces: [{ kind: "application/json", label: "timing.json" }],
          consumes: [{ kind: "text/markdown", label: "script.md" }],
        },
        source: "video-pipeline",
        topoIndex: 1,
      },
      {
        definition: {
          id: "illustrations",
          name: "Illustrations",
          capabilities: [{ capability: "image-generation" }],
          dependsOn: ["script"],
          produces: [{ kind: "image/png", label: "illustrations/" }],
          consumes: [{ kind: "text/markdown", label: "script.md" }],
        },
        source: "video-pipeline",
        topoIndex: 1,
      },
      {
        definition: {
          id: "render",
          name: "Render",
          capabilities: [{ capability: "ffmpeg" }],
          dependsOn: ["illustrations", "narration", "captions", "timing"],
          produces: [{ kind: "video/mp4", label: "output.mp4" }],
          consumes: [
            { kind: "image/png", label: "illustrations/" },
            { kind: "audio/mp3", label: "narration.mp3" },
            { kind: "text/srt", label: "captions.srt" },
            { kind: "application/json", label: "timing.json" },
          ],
        },
        source: "video-pipeline",
        topoIndex: 3,
      },
    ],
    skills: [],
    diagnostics: [],
  };
}

/**
 * Simple chain: A → B → C
 */
function makeChainPipeline(): ResolvedPipeline {
  return {
    name: "chain",
    version: "1.0.0",
    inheritanceChain: ["chain"],
    stages: [
      {
        definition: {
          id: "a",
          name: "A",
          capabilities: [],
          dependsOn: [],
          produces: [{ kind: "text", label: "a.txt" }],
          consumes: [],
        },
        source: "chain",
        topoIndex: 0,
      },
      {
        definition: {
          id: "b",
          name: "B",
          capabilities: [],
          dependsOn: ["a"],
          produces: [{ kind: "text", label: "b.txt" }],
          consumes: [{ kind: "text", label: "a.txt" }],
        },
        source: "chain",
        topoIndex: 1,
      },
      {
        definition: {
          id: "c",
          name: "C",
          capabilities: [],
          dependsOn: ["b"],
          produces: [{ kind: "text", label: "c.txt" }],
          consumes: [{ kind: "text", label: "b.txt" }],
        },
        source: "chain",
        topoIndex: 2,
      },
    ],
    skills: [],
    diagnostics: [],
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("buildDependencyGraph", () => {
  it("builds correct graph from pipeline", () => {
    const pipeline = makeChainPipeline();
    const graph = buildDependencyGraph(pipeline);

    expect(graph.nodes.size).toBe(3);
    expect(graph.edges.length).toBe(2);

    // A → B (via a.txt), B → C (via b.txt)
    expect(graph.dependents.get("a")).toEqual(["b"]);
    expect(graph.dependents.get("b")).toEqual(["c"]);
    expect(graph.dependents.get("c")).toEqual([]);
  });
});

describe("findDownstream", () => {
  it("finds all downstream stages from a source", () => {
    const graph = buildDependencyGraph(makeChainPipeline());
    const result = findDownstream(graph, ["a"]);
    expect(result.sort()).toEqual(["b", "c"]);
  });

  it("returns empty for leaf node", () => {
    const graph = buildDependencyGraph(makeChainPipeline());
    const result = findDownstream(graph, ["c"]);
    expect(result).toEqual([]);
  });
});

describe("findUpstream", () => {
  it("finds all upstream stages", () => {
    const graph = buildDependencyGraph(makeChainPipeline());
    const result = findUpstream(graph, ["c"]);
    expect(result.sort()).toEqual(["a", "b"]);
  });

  it("returns empty for root node", () => {
    const graph = buildDependencyGraph(makeChainPipeline());
    const result = findUpstream(graph, ["a"]);
    expect(result).toEqual([]);
  });
});

describe("detectCycles", () => {
  it("returns empty for acyclic graph", () => {
    const graph = buildDependencyGraph(makeChainPipeline());
    const cycles = detectCycles(graph);
    expect(cycles).toEqual([]);
  });

  it("detects simple cycle", () => {
    const pipeline: ResolvedPipeline = {
      name: "cycle",
      version: "1.0.0",
      inheritanceChain: ["cycle"],
      stages: [
        {
          definition: {
            id: "x",
            name: "X",
            capabilities: [],
            dependsOn: [],
            produces: [{ kind: "text", label: "x.txt" }],
            consumes: [{ kind: "text", label: "y.txt" }],
          },
          source: "cycle",
          topoIndex: 0,
        },
        {
          definition: {
            id: "y",
            name: "Y",
            capabilities: [],
            dependsOn: [],
            produces: [{ kind: "text", label: "y.txt" }],
            consumes: [{ kind: "text", label: "x.txt" }],
          },
          source: "cycle",
          topoIndex: 1,
        },
      ],
      skills: [],
      diagnostics: [],
    };

    const graph = buildDependencyGraph(pipeline);
    const cycles = detectCycles(graph);
    expect(cycles.length).toBeGreaterThan(0);
  });
});

describe("StalenessEngine", () => {
  const pipeline = makeVideoPipeline();

  describe("script edit fixture", () => {
    it("marks narration, captions, timing, and render stale when script changes", () => {
      const engine = new StalenessEngine(pipeline);
      const report = engine.computeReport(["script"]);

      const stale = new Set(report.stale);
      expect(stale.has("narration")).toBe(true);
      expect(stale.has("captions")).toBe(true);
      expect(stale.has("timing")).toBe(true);
      expect(stale.has("render")).toBe(true);
    });

    it("preserves unrelated stages", () => {
      const engine = new StalenessEngine(pipeline);
      const report = engine.computeReport(["script"]);

      // All stages except "script" itself are preserved if they're not affected
      // Script itself is the trigger, not in stale or preserved
      expect(report.preserved).not.toContain("narration");
      expect(report.preserved).not.toContain("captions");
    });

    it("provides reason paths", () => {
      const engine = new StalenessEngine(pipeline);
      const report = engine.computeReport(["script"]);

      const narration = report.stages.find((s) => s.stageId === "narration")!;
      expect(narration.stale).toBe(true);
      expect(narration.reasons.length).toBeGreaterThan(0);
      expect(narration.reasons[0]!.triggerStageId).toBe("script");
      expect(narration.reasons[0]!.change).toBe("re-executed");
    });
  });

  describe("asset selection fixture", () => {
    it("marks render stale but not narration when illustrations change", () => {
      const engine = new StalenessEngine(pipeline);
      const report = engine.computeReport(["illustrations"]);

      const stale = new Set(report.stale);
      expect(stale.has("render")).toBe(true);
      expect(stale.has("narration")).toBe(false);
      expect(stale.has("captions")).toBe(false);
    });
  });

  describe("acceptance", () => {
    it("moves accepted stages from stale to accepted list", () => {
      const engine = new StalenessEngine(pipeline);
      let report = engine.computeReport(["script"]);

      expect(report.stale).toContain("render");

      // Accept render staleness
      engine.accept({ stageIds: ["render"], actor: "operator", scope: "known issue" });
      report = engine.computeReport(["script"]);

      expect(report.stale).not.toContain("render");
      expect(report.accepted).toContain("render");

      const render = report.stages.find((s) => s.stageId === "render")!;
      expect(render.accepted).toBe(true);
      expect(render.acceptedBy).toBe("operator");
    });

    it("clears acceptance after re-execution", () => {
      const engine = new StalenessEngine(pipeline);
      engine.accept({ stageIds: ["render"], actor: "operator" });
      engine.clearAcceptance(["render"]);

      const report = engine.computeReport(["script"]);
      expect(report.accepted).not.toContain("render");
      expect(report.stale).toContain("render");
    });
  });
});

describe("propagate helper", () => {
  it("returns a full staleness report with episode slug", () => {
    const report = propagate(makeVideoPipeline(), ["script"], "ep-01");
    expect(report.episodeSlug).toBe("ep-01");
    expect(report.stale.length).toBeGreaterThan(0);
    expect(report.computedAt).toBeDefined();
    expect(report.stages.length).toBe(6);
  });
});
