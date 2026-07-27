// ---------------------------------------------------------------------------
// Pipeline module — public API
// ---------------------------------------------------------------------------

export {
  resolvePipeline,
  PipelineResolutionError,
} from "./resolver.js";
export type { ResolveOptions } from "./resolver.js";

export { InMemoryPipelineLoader } from "./fixture-loader.js";

export type {
  CapabilityRequest,
  ArtifactRef,
  StageDefinition,
  SkillRef,
  PipelineExtends,
  PipelineDefinition,
  ResolvedStage,
  ResolutionDiagSeverity,
  ResolutionDiag,
  ResolvedPipeline,
  PipelineLoader,
} from "./types.js";
