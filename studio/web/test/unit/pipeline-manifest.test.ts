import { expect, test, describe } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parsePipelineManifest } from "../../src/lib/pipeline-manifest";

/* Definitions nest `stages:` inside the `pipeline:` block. Every one of them
   does, and the parser matched `stages:` anchored to column zero, so it found
   no stage list in any manifest this project writes — the studio reported a
   fifteen-stage pipeline as "not a pipeline definition". These fixtures are
   copied from the manifests on disk rather than written to suit the parser,
   which is how the shape and the reader drifted apart in the first place. */

const DEFINITION = `pipeline:
  id: narrated-illustrated-video
  version: "1.0.0"
  description: "Produces a 16:9 1080p narrated explainer."
  capabilities:
    - id: image.generate
      version: "1.0.0"
    - id: speech.synthesize
      version: "1.0.0"
  stages:
    - id: brief
      name: "Creative Brief"
      type: editorial
      description: "Research and structure the video topic"
      inputs: []
      outputs:
        - contract: brief.md
          version: "1.0.0"
      gates:
        autopilot: true
        review: none
      depends_on: []

    - id: illustrations
      name: "Illustrations"
      type: generation
      capability: image.generate
      provider: fal.ai/flux-1.1-pro
      outputs:
        - contract: images
          version: "1.0.0"
      depends_on: [brief]
`;

/** A series manifest: names a pipeline, defines none. */
const BINDING = `pipeline: wordless-keyframed-h3-short
pipelineVersion: "2.0.0"
image:
  provider: openai-codex
  workflow: continuity-referenced-keyframes
format:
  resolution: "1080x1920"
reviewGates: [visual-beats, keyframe-plan]
`;

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

describe("a definition, which nests stages inside the pipeline block", () => {
  test("draws the chain", () => {
    const result = parsePipelineManifest(DEFINITION);
    expect(result.recognised).toBe(true);
    expect(result.stages.map((s) => s.id)).toEqual(["brief", "illustrations"]);
  });

  test("does not mistake the capabilities list for stages", () => {
    /* `capabilities:` is a list of `- id:` items too, and it sits above the
       stage block. Only what follows `stages:` is a stage. */
    const { stages } = parsePipelineManifest(DEFINITION);
    expect(stages.map((s) => s.id)).not.toContain("image.generate");
    expect(stages).toHaveLength(2);
  });

  test("names the pipeline from the id inside the block", () => {
    /* A definition names itself with `pipeline:` opening a block and `id:`
       within it. Reading only the inline form left every definition anonymous
       in a header whose whole job is to name it. */
    expect(parsePipelineManifest(DEFINITION).name).toBe("narrated-illustrated-video");
  });

  test("reads the fields a definition actually carries", () => {
    const { stages } = parsePipelineManifest(DEFINITION);
    expect(stages[0]).toMatchObject({ id: "brief", type: "editorial", capability: null });
    expect(stages[1]).toMatchObject({
      id: "illustrations",
      type: "generation",
      capability: "image.generate",
      provider: "fal.ai/flux-1.1-pro",
    });
  });

  test("ignores fields belonging to a stage's own nested blocks", () => {
    /* `outputs:` holds `- contract:` items with their own fields. A rule of
       "deeper than the item" would let one of those describe the stage. */
    const nested = `pipeline:
  stages:
    - id: compose
      type: production
      outputs:
        - contract: final.mp4
          type: video/mp4
          provider: not-the-stage-provider
`;
    const { stages } = parsePipelineManifest(nested);
    expect(stages).toHaveLength(1);
    expect(stages[0]).toMatchObject({ id: "compose", type: "production", provider: null });
  });

  test("a binding still reports its name and no stages", () => {
    const result = parsePipelineManifest(BINDING);
    expect(result.name).toBe("wordless-keyframed-h3-short");
    expect(result.recognised).toBe(false);
    expect(result.stages).toEqual([]);
  });
});

describe("against the manifests on disk", () => {
  /* The fixtures above are copies, and a copy can drift — which is exactly how
     the parser and the format came apart. The directory is read rather than
     listed, so a pipeline added later is covered without anyone remembering to
     add it here. */
  const dir = join(__dirname, "..", "..", "..", "pipelines", "pipelines");
  const manifests = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".yaml"))
    : [];

  test("there are pipeline definitions to check", () => {
    expect(manifests.length).toBeGreaterThan(0);
  });

  for (const file of manifests) {
    test(`draws ${file}`, () => {
      const result = parsePipelineManifest(readFileSync(join(dir, file), "utf-8"));
      expect(result.recognised).toBe(true);
      expect(result.stages.length).toBeGreaterThan(0);
      expect(result.name).toBe(file.replace(/\.yaml$/, ""));
      // A capability reads `image.generate`; a stage never has a dot in its
      // ID, so this catches the `capabilities:` list bleeding into the chain.
      for (const stage of result.stages) expect(stage.id).not.toContain(".");
    });
  }

  test("the default pipeline draws its whole chain", () => {
    const path = join(dir, "narrated-illustrated-video.yaml");
    const { stages } = parsePipelineManifest(readFileSync(path, "utf-8"));
    expect(stages.map((s) => s.id)).toEqual([
      "brief", "script", "art-direction", "terminal-recordings", "illustrations",
      "narration", "captions", "timing", "compose", "qa",
    ]);
  });
});
