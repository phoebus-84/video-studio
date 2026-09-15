import { afterEach, describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileSystemPipelineLoader } from "../../../src/pipeline/fs-loader.js";
import { resolvePipeline } from "../../../src/pipeline/resolver.js";

// The repo idiom: studio/runtime declares node >=20.0.0, and import.meta.dirname
// needs 20.11.
const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINES = resolve(__dirname, "../../../../pipelines/pipelines");

function loader() {
  return new FileSystemPipelineLoader([PIPELINES]);
}

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// Every stage in every real manifest under studio/pipelines/pipelines declares
// an explicit `gates:` block, so a loader pointed at that directory can never
// exercise the `yaml.gates?.x ?? default` fallback branches. To prove the
// fail-open default actually fires, write a synthetic manifest with a stage
// that omits `gates` entirely, and point a fresh loader at it.
async function ungatedManifestDir(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "vpr-gates-"));
  roots.push(root);
  await mkdir(root, { recursive: true });
  await writeFile(
    path.join(root, "synthetic-ungated.yaml"),
    [
      "pipeline:",
      "  id: synthetic-ungated",
      "  version: \"1.0.0\"",
      "  stages:",
      "    - id: only-stage",
      "      name: \"Only Stage\"",
      "      type: editorial",
      "",
    ].join("\n"),
  );
  return root;
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
    //
    // This has to use a synthetic manifest, not the real pipelines directory:
    // every stage in every real manifest declares an explicit gates block, so
    // loading a real pipeline never reaches the `?? default` fallback code.
    const dir = await ungatedManifestDir();
    const def = await new FileSystemPipelineLoader([dir]).load("synthetic-ungated");
    const stage = def!.stages.find((s) => s.id === "only-stage");

    expect(stage!.gates).toEqual({ autopilot: true, review: "none", retryOnFailure: 0 });
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
