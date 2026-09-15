import { describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FileSystemPipelineLoader } from "../../../src/pipeline/fs-loader.js";
import { resolvePipeline } from "../../../src/pipeline/resolver.js";

// The repo idiom: studio/runtime declares node >=20.0.0, and import.meta.dirname
// needs 20.11.
const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINES = resolve(__dirname, "../../../../pipelines/pipelines");

function loader() {
  return new FileSystemPipelineLoader([PIPELINES]);
}

describe("stage gates survive loading", () => {
  it("keeps the gates a stage declares", async () => {
    const def = await loader().load("fairy-tale-adaptation");
    const safety = def!.stages.find((s) => s.id === "safety-review");

    // safety-review declares autopilot: false, review: human. The executor ran
    // it in autopilot anyway and wrote a report about a wolf.
    expect(safety!.gates).toEqual({ autopilot: false, review: "human", retryOnFailure: 1 });
  });

  it("defaults to ungated when a stage declares no gates", async () => {
    // Absence of a gate is not a gate. A stage whose author asked for nothing
    // keeps today's behaviour; the fail-closed property comes from honouring
    // declared gates and validating outputs, not from gating by omission.
    const def = await loader().load("narrated-illustrated-video");
    const stage = def!.stages.find((s) => s.id === "brief");

    expect(stage!.gates.autopilot).toBe(true);
    expect(stage!.gates.review).toBe("none");
  });

  it("carries gates through pipeline inheritance", async () => {
    const resolved = await resolvePipeline(loader(), "fairy-tale-adaptation");

    // illustrations comes from the base pipeline, safety-review from the child.
    const illustrations = resolved.stages.find((s) => s.definition.id === "illustrations");
    const safety = resolved.stages.find((s) => s.definition.id === "safety-review");

    expect(illustrations!.definition.gates.review).toBe("human");
    expect(safety!.definition.gates.autopilot).toBe(false);
  });
});
