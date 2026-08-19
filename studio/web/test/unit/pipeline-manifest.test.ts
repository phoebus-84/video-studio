import { expect, test, describe } from "vitest";
import { parsePipelineManifest } from "../../src/lib/pipeline-manifest";

const MANIFEST = `version: 1
pipeline: explainer-1080p

budget:
  cap_usd: 5.00

stages:
  - id: script
    approval: manual
  - id: storyboard
    needs: [script]
  - id: illustrations
    capability: image.generate
    provider: fal.ai/flux-1.1-pro
  - id: render
    capability: video.compose

approval: guided
`;

describe("parsing the stage list", () => {
  test("reads every stage in order", () => {
    const result = parsePipelineManifest(MANIFEST);
    expect(result.recognised).toBe(true);
    expect(result.stages.map((s) => s.id)).toEqual([
      "script",
      "storyboard",
      "illustrations",
      "render",
    ]);
  });

  test("picks up capability and provider", () => {
    const { stages } = parsePipelineManifest(MANIFEST);
    const illustrations = stages.find((s) => s.id === "illustrations");
    expect(illustrations?.capability).toBe("image.generate");
    expect(illustrations?.provider).toBe("fal.ai/flux-1.1-pro");
  });

  test("stages without a capability report null rather than a guess", () => {
    const { stages } = parsePipelineManifest(MANIFEST);
    expect(stages.find((s) => s.id === "script")?.capability).toBeNull();
    expect(stages.find((s) => s.id === "script")?.provider).toBeNull();
  });

  test("stops at the next top-level key", () => {
    /* `approval: guided` follows the stage block and must not be absorbed. */
    const { stages } = parsePipelineManifest(MANIFEST);
    expect(stages).toHaveLength(4);
  });
});

describe("degrading honestly", () => {
  test("a manifest with no stages block is reported as unrecognised", () => {
    const result = parsePipelineManifest("version: 1\npipeline: explainer\n");
    expect(result.recognised).toBe(false);
    expect(result.stages).toEqual([]);
  });

  test("a manifest that names a pipeline reports the name", () => {
    /* Series manifests commonly name a pipeline rather than listing stages;
       the name is the useful thing to show when there is no chain to draw. */
    const result = parsePipelineManifest(
      `# comment\npipeline: fairy-tale-adaptation\n\nseries:\n  title: "Fairy Tales"\n`,
    );
    expect(result.name).toBe("fairy-tale-adaptation");
    expect(result.recognised).toBe(false);
  });

  test("a manifest with neither a name nor stages reports both as absent", () => {
    const result = parsePipelineManifest("series:\n  title: Whatever\n");
    expect(result.name).toBeNull();
    expect(result.recognised).toBe(false);
  });

  test("the pipeline name survives alongside a stage list", () => {
    expect(parsePipelineManifest(MANIFEST).name).toBe("explainer-1080p");
  });

  test("an empty stages block is recognised but empty", () => {
    const result = parsePipelineManifest("stages:\n\nother: 1\n");
    expect(result.recognised).toBe(true);
    expect(result.stages).toEqual([]);
  });

  test("quoted values are unquoted", () => {
    const result = parsePipelineManifest(
      `stages:\n  - id: "render"\n    provider: 'local/ffmpeg'\n`,
    );
    expect(result.stages[0]?.id).toBe("render");
    expect(result.stages[0]?.provider).toBe("local/ffmpeg");
  });

  test("comments and blank lines are skipped", () => {
    const result = parsePipelineManifest(
      `stages:\n  # the first stage\n  - id: script\n\n  - id: render\n`,
    );
    expect(result.stages.map((s) => s.id)).toEqual(["script", "render"]);
  });
});
