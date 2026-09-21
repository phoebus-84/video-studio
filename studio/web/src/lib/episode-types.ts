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
  /** Pipeline name (gateway-provided). */
  pipeline?: string;
  /** Scene summaries (gateway-provided). */
  scenes?: any[];
  /** Budget envelope (gateway-provided). */
  budget?: { currency: string; limitMicros?: number; consumedMicros?: number; remainingMicros?: number };
  /** Review threads (gateway-provided). */
  reviews?: any[];
  /** Staleness report (gateway-provided). */
  staleness?: { stale: string[]; affected: string[] };
  /** Production blockers (gateway-provided). */
  blockers?: any[];
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
  | "runnable"
  | "running"
  | "awaiting_review"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked"
  | "stale";

export const STAGE_LABELS: Record<StageDisplayState, string> = {
  pending: "Pending",
  queued: "Queued",
  runnable: "Ready",
  running: "Running",
  awaiting_review: "Awaiting review",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
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
