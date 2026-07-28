// ---------------------------------------------------------------------------
// Filesystem pipeline loader
// ---------------------------------------------------------------------------
// Reads YAML pipeline definitions from the filesystem.
// Searches built-in pipelines first, then channel/series-level overrides.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { load as loadYaml } from "js-yaml";
import type {
  PipelineDefinition,
  PipelineLoader,
  StageDefinition,
  CapabilityRequest,
  ArtifactRef,
  SkillRef,
  PipelineExtends,
} from "./types.js";

// ── YAML schema types ───────────────────────────────────────────────────────

interface YamlPipeline {
  pipeline: {
    id: string;
    version: string;
    description?: string;
    extends?: { pipeline: string; version?: string };
    capabilities?: Array<{ id: string; version: string }>;
    stages?: YamlStage[];
  };
}

interface YamlStage {
  id: string;
  name: string;
  description?: string;
  capability?: string;
  inputs?: Array<{ contract: string; version: string }>;
  outputs?: Array<{ contract: string; version: string }>;
  gates?: {
    autopilot?: boolean;
    review?: string;
    retry_on_failure?: number;
  };
  skills?: Array<{ skill: string; version: string }>;
  depends_on?: string[];
}

// ── Conversion helpers ──────────────────────────────────────────────────────

function toArtifactRefs(
  items: Array<{ contract: string; version: string }> | undefined,
): ArtifactRef[] {
  if (!items) return [];
  return items.map((item) => ({
    kind: item.contract.endsWith(".md") ? "markdown"
      : item.contract.endsWith(".json") ? "json"
      : item.contract.endsWith(".mp3") || item.contract.endsWith(".wav") ? "audio"
      : item.contract.endsWith(".mp4") ? "video"
      : item.contract.endsWith(".srt") ? "captions"
      : item.contract.endsWith(".png") || item.contract.endsWith(".jpg") ? "image"
      : item.contract.endsWith("/") ? "directory"
      : "unknown",
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
