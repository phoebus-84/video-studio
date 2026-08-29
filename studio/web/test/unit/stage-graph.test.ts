import { expect, test, describe } from "vitest";
import {
  upstreamOf,
  downstreamOf,
  transitiveDownstream,
  rerunConsequence,
} from "../../src/lib/stage-graph";
import type { ResolvedStage } from "../../src/lib/episode-types";

function stage(id: string, dependsOn: string[] = []): ResolvedStage {
  return {
    id,
    name: id,
    status: "completed",
    attemptCount: 0,
    blocked: false,
    stale: false,
    dependsOn,
    progress: 1,
  };
}

/* script → storyboard → illustrations ↘
                      → narration      → render */
const PIPELINE: ResolvedStage[] = [
  stage("script"),
  stage("storyboard", ["script"]),
  stage("illustrations", ["storyboard"]),
  stage("narration", ["script"]),
  stage("render", ["illustrations", "narration"]),
];

describe("edges", () => {
  test("upstream resolves ids to stages", () => {
    expect(upstreamOf(PIPELINE, "render").map((s) => s.id)).toEqual([
      "illustrations",
      "narration",
    ]);
  });

  test("upstream of an unknown stage is empty", () => {
    expect(upstreamOf(PIPELINE, "nope")).toEqual([]);
  });

  test("downstream finds direct dependents only", () => {
    expect(downstreamOf(PIPELINE, "script").map((s) => s.id)).toEqual([
      "storyboard",
      "narration",
    ]);
  });
});

describe("transitive downstream", () => {
  test("reaches everything that eventually depends on a stage", () => {
    expect(transitiveDownstream(PIPELINE, "script").map((s) => s.id).sort()).toEqual([
      "illustrations",
      "narration",
      "render",
      "storyboard",
    ]);
  });

  test("a leaf has nothing downstream", () => {
    expect(transitiveDownstream(PIPELINE, "render")).toEqual([]);
  });

  test("a diamond reports each stage once", () => {
    /* render depends on both illustrations and narration, both of which lead
       back to script — it must not appear twice. */
    const ids = transitiveDownstream(PIPELINE, "script").map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("a cycle terminates instead of hanging", () => {
    /* A malformed manifest can express a cycle; the panel must still render. */
    const cyclic = [stage("a", ["b"]), stage("b", ["a"])];
    expect(transitiveDownstream(cyclic, "a").map((s) => s.id)).toEqual(["b"]);
  });
});

describe("rerun consequence", () => {
  test("splits the pipeline into invalidated and preserved", () => {
    const result = rerunConsequence(PIPELINE, "illustrations");
    expect(result.invalidated).toEqual(["render"]);
    expect(result.preserved.sort()).toEqual([
      "narration",
      "script",
      "storyboard",
    ]);
  });

  test("the stage being rerun is in neither list", () => {
    const result = rerunConsequence(PIPELINE, "illustrations");
    expect(result.invalidated).not.toContain("illustrations");
    expect(result.preserved).not.toContain("illustrations");
  });

  test("rerunning a leaf preserves everything else", () => {
    const result = rerunConsequence(PIPELINE, "render");
    expect(result.invalidated).toEqual([]);
    expect(result.preserved).toHaveLength(4);
  });
});
