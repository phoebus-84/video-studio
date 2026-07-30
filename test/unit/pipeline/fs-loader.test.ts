// ---------------------------------------------------------------------------
// FileSystemPipelineLoader — schema validation tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { FileSystemPipelineLoader } from "../../../src/pipeline/fs-loader.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function writeTempYaml(content: string, fileName = "test-pipeline.yaml"): string {
  const dir = resolve(tmpdir(), `vpr-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const filePath = resolve(dir, fileName);
  writeFileSync(filePath, content, "utf-8");
  return dir;
}

// ── Valid YAML ───────────────────────────────────────────────────────────────

const VALID_CAPABILITY = `pipeline:
  id: test-pipeline
  version: "1.0.0"
  description: "A test pipeline"
  capabilities:
    - id: llm
      version: "1.0.0"
  stages:
    - id: script
      name: "Write Script"
      type: capability
      capability: llm
      inputs:
        - contract: brief.md
          version: "1.0.0"
      outputs:
        - contract: script.md
          version: "1.0.0"
      depends_on: []
`;

const VALID_EDITORIAL = `pipeline:
  id: editorial-pipeline
  version: "1.0.0"
  description: "An editorial pipeline"
  stages:
    - id: review
      name: "Review"
      type: editorial
      inputs: []
      outputs: []
      depends_on: []
`;

// ── Invalid YAML ─────────────────────────────────────────────────────────────

const NO_TYPE = `pipeline:
  id: no-type
  version: "1.0.0"
  stages:
    - id: script
      name: "Script"
      capability: llm
      inputs: []
      outputs: []
      depends_on: []
`;

const MISSING_CAPABILITY = `pipeline:
  id: missing-cap
  version: "1.0.0"
  stages:
    - id: stage1
      name: "No Capability"
      type: capability
      inputs: []
      outputs: []
      depends_on: []
`;

const EDITORIAL_WITH_CAPABILITY = `pipeline:
  id: editorial-with-cap
  version: "1.0.0"
  stages:
    - id: stage1
      name: "Editorial with cap"
      type: editorial
      capability: llm
      inputs: []
      outputs: []
      depends_on: []
`;

// ── Tests ────────────────────────────────────────────────────────────────────

describe("FileSystemPipelineLoader schema validation", () => {
  it("loads a valid capability pipeline", async () => {
    const dir = writeTempYaml(VALID_CAPABILITY);
    const logs: string[] = [];
    const loader = new FileSystemPipelineLoader([dir], (msg) => logs.push(msg));

    const def = await loader.load("test-pipeline");
    expect(def).not.toBeNull();
    expect(def!.name).toBe("test-pipeline");
    expect(def!.stages.length).toBe(1);
    expect(def!.stages[0]!.id).toBe("script");

    // No schema validation warnings
    const schemaFailures = logs.filter((l) => l.includes("schema validation"));
    expect(schemaFailures).toHaveLength(0);

    rmSync(dir, { recursive: true, force: true });
  });

  it("loads a valid editorial pipeline", async () => {
    const dir = writeTempYaml(VALID_EDITORIAL);
    const logs: string[] = [];
    const loader = new FileSystemPipelineLoader([dir], (msg) => logs.push(msg));

    const def = await loader.load("editorial-pipeline");
    expect(def).not.toBeNull();
    expect(def!.stages[0]!.id).toBe("review");

    const schemaFailures = logs.filter((l) => l.includes("schema validation"));
    expect(schemaFailures).toHaveLength(0);

    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a pipeline with no type field on stages", async () => {
    const dir = writeTempYaml(NO_TYPE);
    const logs: string[] = [];
    const loader = new FileSystemPipelineLoader([dir], (msg) => logs.push(msg));

    const def = await loader.load("no-type");
    // Schema validation should prevent loading
    expect(def).toBeNull();

    const schemaFailures = logs.filter((l) => l.includes("schema validation"));
    expect(schemaFailures.length).toBeGreaterThan(0);
    expect(schemaFailures[0]).toContain("must have required property 'type'");

    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a capability stage without capability field", async () => {
    const dir = writeTempYaml(MISSING_CAPABILITY);
    const logs: string[] = [];
    const loader = new FileSystemPipelineLoader([dir], (msg) => logs.push(msg));

    const def = await loader.load("missing-cap");
    expect(def).toBeNull();

    const schemaFailures = logs.filter((l) => l.includes("schema validation"));
    expect(schemaFailures.length).toBeGreaterThan(0);
    expect(schemaFailures[0]).toContain("must have required property 'capability'");

    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects an editorial stage that has a capability field", async () => {
    const dir = writeTempYaml(EDITORIAL_WITH_CAPABILITY);
    const logs: string[] = [];
    const loader = new FileSystemPipelineLoader([dir], (msg) => logs.push(msg));

    const def = await loader.load("editorial-with-cap");
    expect(def).toBeNull();

    const schemaFailures = logs.filter((l) => l.includes("schema validation"));
    expect(schemaFailures.length).toBeGreaterThan(0);

    rmSync(dir, { recursive: true, force: true });
  });
});
