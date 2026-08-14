/**
 * TypeScript bindings generated from pipeline-manifest.schema.json
 * Schema: https://video.studio/schemas/v1alpha1/pipeline-manifest.schema.json
 * Auto-generated — do not edit directly.
 */

export type SemVer = string;

export interface ContractRef {
  contract: string;
  version: string;
}

export interface SkillRef {
  skill: string;
  version: string;
}

export interface StageGates {
  autopilot?: boolean;
  review?: "none" | "human" | "auto";
  retry_on_failure?: number;
}

export interface PipelineStage {
  id: string;
  name: string;
  description?: string;
  "type": "editorial" | "capability";
  capability?: string;
  inputs?: ContractRef[];
  outputs?: ContractRef[];
  gates?: StageGates;
  skills?: SkillRef[];
  depends_on?: string[];
}

export interface CapabilityDecl {
  id: string;
  version: string;
}

export interface PipelineExtends {
  pipeline: string;
  version?: string;
}

export interface PipelineManifest {
  pipeline: {
    id: string;
    version: SemVer;
    description?: string;
    "extends"?: PipelineExtends;
    capabilities?: CapabilityDecl[];
    stages: PipelineStage[];
  };
}
