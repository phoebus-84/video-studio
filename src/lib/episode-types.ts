import type { PipelineStage, StageStatus, EpisodeStatus } from "$contracts/gateway";

export type { PipelineStage, StageStatus, EpisodeStatus };

/** Resolved episode ready for the workspace. */
export interface EpisodeWorkspace {
  slug: string;
  title: string;
  channel: string;
  series: string;
  status: EpisodeStatus;
  approvalMode: "autopilot" | "guided" | "manual";
  budgetLimit: number | null;
  budgetSpent: number | null;
  stages: ResolvedStage[];
  currentDeliverable: string | null;
  currentDeliverableValidated: boolean;
  blocked: boolean;
  blockedReason?: string;
  staleCount: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface ResolvedStage extends PipelineStage {
  /** 0–1 progress, meaningful for "running" stages. */
  progress: number;
  /** Machine-readable code when blocked. */
  blockedCode?: string;
}

/** Derived stage display state. */
export type StageDisplayState =
  | "pending"
  | "queued"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped"
  | "blocked"
  | "stale";

export const STAGE_LABELS: Record<StageDisplayState, string> = {
  pending: "Pending",
  queued: "Queued",
  running: "Running",
  awaiting_approval: "Approval",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
  skipped: "Skipped",
  blocked: "Blocked",
  stale: "Stale",
};

export function stageDisplayState(stage: ResolvedStage): StageDisplayState {
  if (stage.blocked) return "blocked";
  if (stage.stale) return "stale";
  return stage.status;
}

export const APPROVAL_LABELS: Record<string, string> = {
  autopilot: "Autopilot",
  guided: "Guided",
  manual: "Manual",
};
