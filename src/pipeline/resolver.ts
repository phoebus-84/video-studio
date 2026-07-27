// ---------------------------------------------------------------------------
// Pipeline resolver — inheritance, stage merging, topological sort
// ---------------------------------------------------------------------------

import type {
  PipelineLoader,
  ResolvedPipeline,
  ResolvedStage,
  ResolutionDiag,
  StageDefinition,
} from "./types.js";

/** Error class for pipeline resolution failures. */
export class PipelineResolutionError extends Error {
  public readonly diagnostics: ResolutionDiag[];

  constructor(message: string, diagnostics: ResolutionDiag[]) {
    super(message);
    this.name = "PipelineResolutionError";
    this.diagnostics = diagnostics;
  }
}

/** Options for pipeline resolution. */
export interface ResolveOptions {
  /** Maximum inheritance depth (safety limit). */
  maxExtendsDepth?: number;
}

const DEFAULT_MAX_DEPTH = 10;

interface ChainStageRef {
  id: string;
  source: string;
}

interface ChainResult {
  name: string;
  version: string;
  stages: StageDefinition[];
  stageSources: ChainStageRef[];
  skills: { name: string; path: string }[];
  inheritanceChain: string[];
}

/**
 * Resolve a pipeline through its full inheritance chain.
 *
 * 1. Load the named pipeline.
 * 2. If it extends a parent, resolve the parent first.
 * 3. Merge child stages over parent stages.
 * 4. Topological sort and validate artifact flows.
 */
export async function resolvePipeline(
  loader: PipelineLoader,
  name: string,
  version?: string,
  options: ResolveOptions = {},
): Promise<ResolvedPipeline> {
  const maxDepth = options.maxExtendsDepth ?? DEFAULT_MAX_DEPTH;
  const diagnostics: ResolutionDiag[] = [];

  const resolved = await resolveChain(loader, name, version, maxDepth, diagnostics, []);

  // Topological sort
  const sorted = topoSort(resolved.stages, diagnostics);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const stages = sorted.map((def, idx) => {
    const source =
      resolved.stageSources.find((s: any) => s.id === def.id)?.source ??
      resolved.inheritanceChain[0]!;
    return { definition: def, source, topoIndex: idx };
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Validate artifact flows
  validateArtifactFlow(stages, diagnostics);

  // Error if any error-level diagnostics
  if (diagnostics.some((d) => d.severity === "error")) {
    throw new PipelineResolutionError(
      `Pipeline "${name}" resolution failed with ${diagnostics.filter((d) => d.severity === "error").length} error(s)`,
      diagnostics,
    );
  }

  return {
    name: resolved.name,
    version: resolved.version,
    inheritanceChain: resolved.inheritanceChain,
    stages,
    skills: resolved.skills,
    diagnostics,
  };
}

async function resolveChain(
  loader: PipelineLoader,
  name: string,
  version: string | undefined,
  maxDepth: number,
  diagnostics: ResolutionDiag[],
  visited: string[],
): Promise<ChainResult> {
  // Cycle detection in inheritance
  if (visited.includes(name)) {
    diagnostics.push({
      severity: "error",
      code: "PIPELINE_CYCLE",
      message: `Inheritance cycle detected: ${visited.join(" → ")} → ${name}`,
      context: name,
    });
    throw new PipelineResolutionError("Inheritance cycle", diagnostics);
  }

  if (visited.length >= maxDepth) {
    diagnostics.push({
      severity: "error",
      code: "PIPELINE_DEPTH",
      message: `Inheritance depth exceeds maximum of ${maxDepth}`,
      context: name,
    });
    throw new PipelineResolutionError("Max depth exceeded", diagnostics);
  }

  const def = await loader.load(name, version);
  if (!def) {
    diagnostics.push({
      severity: "error",
      code: "PIPELINE_NOT_FOUND",
      message: `Pipeline "${name}"${version ? ` @ ${version}` : ""} not found`,
      context: name,
    });
    throw new PipelineResolutionError("Pipeline not found", diagnostics);
  }

  // Resolve parent if present
  let baseStages: StageDefinition[] = [];
  let baseSources: ChainStageRef[] = [];
  let baseSkills: { name: string; path: string }[] = [];
  let chain: string[] = [name];

  if (def.extends) {
    const parent = await resolveChain(
      loader,
      def.extends.pipeline,
      def.extends.version,
      maxDepth,
      diagnostics,
      [...visited, name],
    );
    baseStages = parent.stages;
    baseSources = parent.stageSources;
    baseSkills = parent.skills;
    chain = [...parent.inheritanceChain, name];
  }

  // Merge: child stages override parent stages by id
  const { stages: mergedStages, sources: mergedSources } = mergeStages(
    baseStages, baseSources, def.stages, diagnostics, name,
  );
  const mergedSkills = mergeSkills(baseSkills, def.skills);

  return {
    name: def.name,
    version: def.version,
    stages: mergedStages,
    stageSources: mergedSources,
    skills: mergedSkills,
    inheritanceChain: chain,
  };
}

/**
 * Merge child stages over parent stages.
 *
 * Rules:
 * - Stage with same id in child replaces parent entirely.
 * - Stage with dependsOn containing "!id" removes that id from the parent set.
 * - Stages present only in child are added.
 * - Stages present only in parent are preserved.
 */
function mergeStages(
  parent: StageDefinition[],
  parentSources: ChainStageRef[],
  child: StageDefinition[],
  diagnostics: ResolutionDiag[],
  source: string,
): { stages: StageDefinition[]; sources: ChainStageRef[] } {
  const merged = new Map<string, StageDefinition>();
  const sources = new Map<string, string>();

  // Start with parent stages
  for (const stage of parent) {
    merged.set(stage.id, { ...stage });
  }
  for (const ref of parentSources) {
    sources.set(ref.id, ref.source);
  }

  // Track removals
  const removed = new Set<string>();

  for (const stage of child) {
    // Check for removal markers in dependsOn
    for (const dep of stage.dependsOn) {
      if (dep.startsWith("!")) {
        const removeId = dep.slice(1);
        removed.add(removeId);
        diagnostics.push({
          severity: "warning",
          code: "STAGE_REMOVED",
          message: `Stage "${removeId}" removed by override in "${source}"`,
          context: stage.id,
        });
      }
    }

    if (merged.has(stage.id)) {
      diagnostics.push({
        severity: "warning",
        code: "STAGE_OVERRIDE",
        message: `Stage "${stage.id}" overridden in "${source}"`,
        context: stage.id,
      });
    }

    // Child always wins
    merged.set(stage.id, {
      ...stage,
      dependsOn: stage.dependsOn.filter((d) => !d.startsWith("!")),
    });
    sources.set(stage.id, source);
  }

  // Apply removals
  for (const id of removed) {
    merged.delete(id);
    sources.delete(id);
  }

  // Re-resolve dependsOn to filter out removed stages
  const result: StageDefinition[] = [];
  const resultSources: ChainStageRef[] = [];
  for (const [id, stage] of merged) {
    const resolvedDeps = stage.dependsOn.filter((d) => {
      if (!merged.has(d)) {
        diagnostics.push({
          severity: "warning",
          code: "MISSING_DEPENDENCY",
          message: `Stage "${id}" depends on "${d}" which is not present`,
          context: id,
        });
        return false;
      }
      return true;
    });
    result.push({ ...stage, dependsOn: resolvedDeps });
    resultSources.push({ id, source: sources.get(id) ?? source });
  }

  return { stages: result, sources: resultSources };
}

/** Merge child skills over parent skills by name. */
function mergeSkills(
  parent: { name: string; path: string }[],
  child: { name: string; path: string }[],
): { name: string; path: string }[] {
  const map = new Map<string, { name: string; path: string }>();
  for (const s of parent) map.set(s.name, s);
  for (const s of child) map.set(s.name, s);
  return [...map.values()];
}

// ── Topological sort (Kahn's algorithm) ─────────────────────────────────────

function topoSort(
  stages: StageDefinition[],
  diagnostics: ResolutionDiag[],
): StageDefinition[] {
  const byId = new Map(stages.map((s) => [s.id, s]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const stage of stages) {
    inDegree.set(stage.id, 0);
    adjacency.set(stage.id, []);
  }

  for (const stage of stages) {
    for (const dep of stage.dependsOn) {
      if (!byId.has(dep)) {
        diagnostics.push({
          severity: "error",
          code: "MISSING_STAGE",
          message: `Stage "${stage.id}" depends on "${dep}" which does not exist`,
          context: stage.id,
        });
        continue;
      }
      adjacency.get(dep)!.push(stage.id);
      inDegree.set(stage.id, inDegree.get(stage.id)! + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: StageDefinition[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(byId.get(id)!);
    for (const neighbor of adjacency.get(id)!) {
      const newDegree = inDegree.get(neighbor)! - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (sorted.length < stages.length) {
    const remaining = stages
      .filter((s) => !sorted.includes(s))
      .map((s) => s.id);
    diagnostics.push({
      severity: "error",
      code: "CYCLE_DETECTED",
      message: `Dependency cycle detected involving stages: ${remaining.join(", ")}`,
      context: remaining[0],
    });
  }

  return sorted;
}

// ── Artifact flow validation ─────────────────────────────────────────────────

function validateArtifactFlow(
  stages: ResolvedStage[],
  diagnostics: ResolutionDiag[],
): void {
  const produced = new Map<string, Set<string>>();

  for (const stage of stages) {
    for (const artifact of stage.definition.produces) {
      if (!produced.has(artifact.label)) {
        produced.set(artifact.label, new Set());
      }
      produced.get(artifact.label)!.add(stage.definition.id);
    }
  }

  for (const stage of stages) {
    for (const artifact of stage.definition.consumes) {
      const producers = produced.get(artifact.label);
      if (!producers || producers.size === 0) {
        diagnostics.push({
          severity: "error",
          code: "UNMET_ARTIFACT",
          message: `Stage "${stage.definition.id}" consumes "${artifact.label}" (${artifact.kind}) but no prior stage produces it`,
          context: stage.definition.id,
        });
        continue;
      }

      // Check that at least one producer comes before this stage in topo order
      const hasPriorProducer = [...producers].some((pid) => {
        const producerStage = stages.find((s) => s.definition.id === pid);
        return producerStage && producerStage.topoIndex < stage.topoIndex;
      });

      if (!hasPriorProducer) {
        diagnostics.push({
          severity: "error",
          code: "ARTIFACT_ORDERING",
          message: `Stage "${stage.definition.id}" consumes "${artifact.label}" but no producer is topologically prior`,
          context: stage.definition.id,
        });
      }
    }
  }
}
