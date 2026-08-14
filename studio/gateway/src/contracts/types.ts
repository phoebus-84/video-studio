/** Types shared between gateway routes and browser contracts. */

export type HealthStatus = "ready" | "degraded" | "down" | "unknown";

export interface ComponentHealth {
  status: HealthStatus;
  detail: string;
  lastChecked: string;
}

export type OverallHealth = "healthy" | "unhealthy";

export interface HealthReport {
  overall: OverallHealth;
  timestamp: string;
  gateway: ComponentHealth;
  runtime: ComponentHealth;
  pi: ComponentHealth;
  adapter: ComponentHealth;
}

export interface ChannelSummary {
  slug: string;
  title: string;
  seriesCount: number;
}

export interface SeriesSummary {
  slug: string;
  title: string;
  episodeCount: number;
}

export type EpisodeStatus =
  | "idle"
  | "running"
  | "awaiting_review"
  | "blocked"
  | "completed"
  | "cancelled"
  | "failed";

export interface EpisodeSummary {
  slug: string;
  title: string;
  status: EpisodeStatus;
  currentDeliverable: boolean;
  blocked: boolean;
  staleCount: number;
  lastActivity: string;
}

export type StageStatus =
  | "pending"
  | "queued"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";

export interface PipelineStage {
  id: string;
  name: string;
  status: StageStatus;
  attemptCount: number;
  blocked: boolean;
  blockedReason?: string;
  blockedCode?: string;
  stale: boolean;
  dependsOn: string[];
  progress: number;
}

export interface EpisodeDetail {
  slug: string;
  title: string;
  channel: string;
  series: string;
  status: EpisodeStatus;
  approvalMode: "autopilot" | "guided" | "manual";
  budgetLimit: number | null;
  budgetSpent: number | null;
  stages: PipelineStage[];
  currentDeliverable: string | null;
  currentDeliverableValidated: boolean;
  staleCount: number;
  blocked: boolean;
  blockedReason?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface ConnectionState {
  gateway: boolean;
  pi: boolean;
  runtime: boolean;
  adapter: boolean;
  since: string;
}
