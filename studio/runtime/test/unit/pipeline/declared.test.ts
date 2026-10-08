import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { channelPath, episodePath, seriesPath } from "@studio/contracts/src/layout.mjs";
import { declaredPipeline, PipelineDeclarationError } from "../../../src/pipeline/declared.js";

/** The pipeline the library declares for an episode (avg-sxk). */

const REF = { channel: "dentro-i-versi", series: "long", episode: "il-lampo" };
let root: string;
const at = {
  episode: () => episodePath(root, REF.channel, REF.series, REF.episode),
  series: () => seriesPath(root, REF.channel, REF.series),
  channel: () => channelPath(root, REF.channel),
};
function declare(level: keyof typeof at, body: string) {
  mkdirSync(at[level](), { recursive: true });
  writeFileSync(join(at[level](), "pipeline.yaml"), body);
}
function refusal(): PipelineDeclarationError {
  try {
    declaredPipeline(root, REF);
  } catch (e) {
    if (e instanceof PipelineDeclarationError) return e;
    throw e;
  }
  throw new Error("expected a PipelineDeclarationError");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "declared-pipeline-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("declaredPipeline", () => {
  it("answers null when nothing declares one", () => {
    mkdirSync(at.episode(), { recursive: true });
    expect(declaredPipeline(root, REF)).toBeNull();
  });

  it("takes the channel's, the series' over it, and the episode's over both", () => {
    declare("channel", "pipeline: narrated-illustrated-video\n");
    expect(declaredPipeline(root, REF)).toEqual({ name: "narrated-illustrated-video", file: "dentro-i-versi/pipeline.yaml" });
    declare("series", "# the series family\npipeline: series-production\n");
    expect(declaredPipeline(root, REF)).toEqual({ name: "series-production", file: "dentro-i-versi/series/long/pipeline.yaml" });
    declare("episode", "pipeline: blender-animation\n");
    expect(declaredPipeline(root, REF)).toEqual({ name: "blender-animation", file: "dentro-i-versi/series/long/episodes/il-lampo/pipeline.yaml" });
  });

  it("skips a file without the key, an empty one and a comment-only one", () => {
    declare("channel", "pipeline: series-production\n");
    declare("series", "settings:\n  voice: serena\n");
    declare("episode", "");
    expect(declaredPipeline(root, REF)?.name).toBe("series-production");
    declare("episode", "# nothing yet\n\n");
    expect(declaredPipeline(root, REF)?.name).toBe("series-production");
  });

  it("refuses a file that does not parse, naming it", () => {
    declare("channel", "pipeline: series-production\n");
    declare("series", "pipeline: [unclosed\n");
    const e = refusal();
    expect([e.code, e.file]).toEqual(["bad-declaration", "dentro-i-versi/series/long/pipeline.yaml"]);
  });

  it("refuses a file that is not a mapping", () => {
    declare("series", "- series-production\n");
    expect(refusal().code).toBe("bad-declaration");
  });

  it("refuses a name that is not a pipeline id", () => {
    for (const name of ["../x", "Series Production", "42"]) {
      declare("series", `pipeline: ${name}\n`);
      expect(refusal().code).toBe("bad-name");
    }
    declare("series", "pipeline: 42\n");
    expect(refusal().message).toContain("42");
  });
});
