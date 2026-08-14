// ---------------------------------------------------------------------------
// Filesystem pipeline loader
// ---------------------------------------------------------------------------
// Reads YAML pipeline definitions from the filesystem.
// Searches built-in pipelines first, then channel/series-level overrides.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { load as loadYaml } from "js-yaml";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => Ajv2020;
import type {
  PipelineDefinition,
  PipelineLoader,
  StageDefinition,
  CapabilityRequest,
  ArtifactRef,
  SkillRef,
  PipelineExtends,
} from "./types.js";
import { contractToKind } from "../artifacts/kinds.js";

// ── YAML schema types ───────────────────────────────────────────────────────

interface YamlPipeline {
  pipeline: {
    id: string;
    version: string;
    description?: string;
    extends?: { pipeline: string; version?: string };
    capabilities?: { id: string; version: string }[];
    stages?: YamlStage[];
  };
}

interface YamlStage {
  id: string;
  name: string;
  description?: string;
  capability?: string;
  inputs?: { contract: string; version: string }[];
  outputs?: { contract: string; version: string }[];
  gates?: {
    autopilot?: boolean;
    review?: string;
    retry_on_failure?: number;
  };
  skills?: { skill: string; version: string }[];
  depends_on?: string[];
  type?: string;
}

// ── Conversion helpers ──────────────────────────────────────────────────────

function toArtifactRefs(
  items: { contract: string; version: string }[] | undefined,
): ArtifactRef[] {
  if (!items) return [];
  return items.map((item) => ({
    kind: contractToKind(item.contract),
    label: item.contract,
  }));
}

function toCapabilityRequest(capability: string | undefined, capabilities: YamlPipeline["pipeline"]["capabilities"] | undefined): CapabilityRequest[] {
  const requests: CapabilityRequest[] = [];
  if (capability) {
    // Find the capability details from pipeline-level capabilities list
    const details = capabilities?.find((c) => c.id === capability);
    requests.push({
      capability,
      params: details ? { version: details.version } : undefined,
    });
  }
  return requests;
}

function toStageDef(yaml: YamlStage, pipelineCaps: YamlPipeline["pipeline"]["capabilities"]): StageDefinition {
  return {
    id: yaml.id,
    name: yaml.name,
    type: (yaml.type === "editorial" || yaml.type === "capability") ? yaml.type as "editorial" | "capability" : "editorial",
    capabilities: toCapabilityRequest(yaml.capability, pipelineCaps),
    dependsOn: yaml.depends_on ?? [],
    produces: toArtifactRefs(yaml.outputs),
    consumes: toArtifactRefs(yaml.inputs),
  };
}

function toSkillRefs(stages: YamlStage[] | undefined): SkillRef[] {
  const seen = new Set<string>();
  const refs: SkillRef[] = [];
  for (const stage of stages ?? []) {
    for (const skill of stage.skills ?? []) {
      if (!seen.has(skill.skill)) {
        seen.add(skill.skill);
        refs.push({ name: skill.skill, path: `skills/${skill.skill}.md` });
      }
    }
  }
  return refs;
}

function toPipelineDef(_fullPath: string, yaml: YamlPipeline): PipelineDefinition {
  const p = yaml.pipeline;
  let extendsRef: PipelineExtends | undefined;
  if (p.extends) {
    extendsRef = {
      pipeline: p.extends.pipeline,
      version: p.extends.version,
    };
  }

  return {
    name: p.id,
    version: p.version,
    extends: extendsRef,
    stages: (p.stages ?? []).map((s) => toStageDef(s, p.capabilities)),
    skills: toSkillRefs(p.stages),
  };
}

// ── Schema validation ───────────────────────────────────────────────────────

const schemaPath = require.resolve(
  "@studio/contracts/schemas/v1alpha1/pipeline-manifest.schema.json",
);
const pipelineManifestSchema = JSON.parse(readFileSync(schemaPath, "utf-8"));

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
ajv.addSchema(pipelineManifestSchema);
const validateManifest = ajv.getSchema(`${pipelineManifestSchema.$id}#/$defs/PipelineManifest`)!;

function validateYamlPipeline(raw: unknown): string[] | null {
  if (!validateManifest(raw)) {
    return (validateManifest.errors ?? []).map(
      (err: ErrorObject) => `${err.instancePath || "/"} ${err.message}`,
    );
  }
  return null;
}

// ── Loader implementation ───────────────────────────────────────────────────

export class FileSystemPipelineLoader implements PipelineLoader {
  private definitions = new Map<string, PipelineDefinition>();
  private loaded = false;

  constructor(
    private readonly searchPaths: string[],
    private readonly log?: (msg: string) => void,
  ) {}

  async load(
    name: string,
    _version?: string,
  ): Promise<PipelineDefinition | null> {
    if (!this.loaded) {
      await this.scan();
    }
    return this.definitions.get(name) ?? null;
  }

  async list(): Promise<string[]> {
    if (!this.loaded) {
      await this.scan();
    }
    return [...this.definitions.keys()];
  }

  private async scan(): Promise<void> {
    this.loaded = true;
    const seen = new Set<string>();

    for (const searchPath of this.searchPaths) {
      await this.scanDirectory(searchPath, seen);
    }

    this.log?.(`FileSystemPipelineLoader: loaded ${this.definitions.size} pipeline(s)`);
  }

  private async scanDirectory(
    dirPath: string,
    seen: Set<string>,
  ): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))) {
          const fullPath = path.join(dirPath, entry.name);
          if (seen.has(fullPath)) continue;
          seen.add(fullPath);
          await this.loadFile(fullPath);
        } else if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
          await this.scanDirectory(path.join(dirPath, entry.name), seen);
        }
      }
    } catch {
      // Directory doesn't exist — skip
    }
  }

  private async loadFile(fullPath: string): Promise<void> {
    try {
      const content = await fs.readFile(fullPath, "utf-8");
      const raw = loadYaml(content) as YamlPipeline;

      if (!raw?.pipeline?.id) {
        // Not a pipeline file — skip (could be format.yaml, config, etc.)
        return;
      }

      // Validate against canonical schema
      const schemaErrors = validateYamlPipeline(raw);
      if (schemaErrors) {
        this.log?.(
          `  WARNING: ${path.basename(fullPath)} failed schema validation:` +
            `\n    ${schemaErrors.join("\n    ")}`,
        );
        // Do not load invalid pipelines
        return;
      }

      const def = toPipelineDef(fullPath, raw);
      this.definitions.set(def.name, def);
      this.log?.(`  ${def.name} @ ${def.version} from ${path.basename(fullPath)}`);
    } catch (err) {
      this.log?.(`  WARNING: Failed to load ${fullPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Create a loader that searches both built-in and library paths. */
export function createDefaultLoader(libraryRoot: string, builtinPath?: string): FileSystemPipelineLoader {
  const paths = [
    builtinPath ?? path.resolve(libraryRoot, "../video-built-in-pipelines/pipelines"),
    path.resolve(libraryRoot),
  ];
  return new FileSystemPipelineLoader(paths);
}
