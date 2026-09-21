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
  currentDeliverable?: boolean;
  blocked?: boolean;
  staleCount?: number;
  lastActivity?: string;
  /** Resolved pipeline name, from the episode or its series. */
  pipeline?: string;
  updatedAt?: string;
}

/**
 * A stage's status as the gateway publishes it.
 *
 * `awaiting_review` is the execution service's spelling, and the spelling the
 * episode-detail projection passes through verbatim (routes/workspace.ts maps
 * `status: s.state`). It replaced `awaiting_approval`, which nothing has ever
 * produced; `skipped` went with it, unreachable since `runAutopilot` was
 * deleted in avg-2n7. `runnable` arrives by the same route and for the same
 * reason — it is the state an actionable stage is most often in, and while it
 * was undeclared it reached `STAGE_LABELS` as a missing key and rendered as a
 * blank chip.
 */
export type StageStatus =
  | "pending"
  | "queued"
  | "runnable"
  | "running"
  | "awaiting_review"
  | "completed"
  | "failed"
  | "cancelled";

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
  status: EpisodeStatus;

  // Everything below is optional because a filesystem workspace can only
  // report what the episode directory actually contains. A service backed by
  // the runtime fills in more. Callers must not assume presence.
  channel?: string;
  series?: string;
  approvalMode?: "autopilot" | "guided" | "manual";
  budgetLimit?: number | null;
  budgetSpent?: number | null;
  stages?: PipelineStage[];
  currentDeliverable?: string | null;
  currentDeliverableValidated?: boolean;
  staleCount?: number;
  blocked?: boolean;
  blockedReason?: string;
  createdAt?: string;
  updatedAt?: string;
  error?: string;

  /** Resolved pipeline name, from the episode or its series. */
  pipeline?: string;
  /** Scene records read from the episode's artifacts, when present. */
  scenes?: Array<Record<string, unknown>>;
  /** The current render pointer, when one exists. */
  render?: Record<string, unknown> | null;
  /** Parsed QA report for the current render, when one exists. */
  qaReport?: Record<string, unknown> | null;
}

export interface ConnectionState {
  gateway: boolean;
  pi: boolean;
  runtime: boolean;
  adapter: boolean;
  since: string;
}
