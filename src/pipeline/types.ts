// ---------------------------------------------------------------------------
// Pipeline definition types
// ---------------------------------------------------------------------------

/** A capability a stage requests (provider-neutral). */
export interface CapabilityRequest {
  /** Logical capability name, e.g. "tts", "image-generation". */
  capability: string;
  /** Optional provider preference hint (not a hard binding). */
  prefer?: string;
  /** Key-value parameters for this capability. */
  params?: Record<string, unknown>;
}

/** An artifact a stage produces or consumes. */
export interface ArtifactRef {
  /** Kind discriminator, e.g. "script", "audio/mp3", "video/mp4". */
  kind: string;
  /** Logical label used for matching consumers to producers. */
  label: string;
}

/** A single stage in a pipeline definition. */
export interface StageDefinition {
  /** Unique within the pipeline, e.g. "brief", "script", "illustrations". */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Capabilities this stage requests. */
  capabilities: CapabilityRequest[];
  /** Stage IDs this stage depends on (DAG edges). */
  dependsOn: string[];
  /** Artifacts this stage produces. */
  produces: ArtifactRef[];
  /** Artifacts this stage consumes (must be produced by prior stages). */
  consumes: ArtifactRef[];
}

/** A skill reference resolved within trusted roots. */
export interface SkillRef {
  /** Logical name within the pipeline. */
  name: string;
  /** Path relative to a trusted root. */
  path: string;
}

/** Reference to a parent pipeline for inheritance. */
export interface PipelineExtends {
  /** Pipeline name to inherit from. */
  pipeline: string;
  /** Optional version pin. */
  version?: string;
}

/** Raw pipeline definition (YAML-level shape). */
export interface PipelineDefinition {
  /** Unique pipeline name. */
  name: string;
  /** Semantic version. */
  version: string;
  /** Optional parent for inheritance. */
  extends?: PipelineExtends;
  /** Stages in declaration order (DAG resolved at resolution time). */
  stages: StageDefinition[];
  /** Skills referenced by this pipeline. */
  skills: SkillRef[];
}

// ── Resolution output types ──────────────────────────────────────────────────

/** A single resolved stage with computed metadata. */
export interface ResolvedStage {
  /** Stage definition as resolved after inheritance. */
  definition: StageDefinition;
  /** Pipeline source (for provenance). */
  source: string;
  /** Zero-based topological index. */
  topoIndex: number;
}

/** A pipeline resolution diagnostic. */
export type ResolutionDiagSeverity = "error" | "warning";

export interface ResolutionDiag {
  severity: ResolutionDiagSeverity;
  code: string;
  message: string;
  /** Pipeline name, stage id, or operation that triggered this. */
  context?: string;
}

/** Fully resolved pipeline ready for execution. */
export interface ResolvedPipeline {
  /** Resolved pipeline name. */
  name: string;
  /** Resolved version. */
  version: string;
  /** Flattened inheritance chain (innermost first). */
  inheritanceChain: string[];
  /** Stages in topological order. */
  stages: ResolvedStage[];
  /** Skills available to this pipeline. */
  skills: SkillRef[];
  /** Resolution diagnostics (empty = clean). */
  diagnostics: ResolutionDiag[];
}

/** A pipeline loader: given a name and optional version, returns the raw definition. */
export interface PipelineLoader {
  load(name: string, version?: string): Promise<PipelineDefinition | null>;
  /** List available pipeline names. */
  list(): Promise<string[]>;
}
