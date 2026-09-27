/* Machine-readable contracts mirroring the gateway OpenAPI 3.0.3 spec.
   These types are the reference projection; the generated HTTP client
   must not introduce hardcoded schemas that diverge from the gateway. */

/* ── health ── */

export type HealthStatus = "ready" | "degraded" | "down" | "unknown";

export interface ComponentHealth {
  status: HealthStatus;
  detail: string;
  lastChecked: string; /* ISO-8601 */
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

/* ── errors ── */

export interface ErrorResponse {
  error: string;
  message: string;
  correlationId: string; /* UUID */
  details?: Record<string, unknown>;
}

/* ── workspace discovery ── */

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

export interface EpisodeSummary {
  slug: string;
  title: string;
  status: EpisodeStatus;
  currentDeliverable: boolean;
  blocked: boolean;
  lastActivity: string;
}

export type EpisodeStatus =
  | "idle"
  | "running"
  | "awaiting_review"
  | "blocked"
  | "completed"
  | "cancelled"
  | "failed";

/* ── pipeline / stage ── */

export interface PipelineStage {
  id: string;
  name: string;
  status: StageStatus;
  attemptCount: number;
  blocked: boolean;
  blockedReason?: string;
  stale: boolean;
  dependsOn: string[];
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
 * blank chip. `blocked` arrives the same way and was missed by the same
 * reading: it is a member of the execution service's `StageState`, and
 * routes/workspace.ts publishes `status: s.state` for every stage without
 * filtering. Declaring one member of a projection and not another is how a
 * real state renders as an empty label.
 */
export type StageStatus =
  | "pending"
  | "queued"
  | "runnable"
  | "blocked"
  | "running"
  | "awaiting_review"
  | "completed"
  | "failed"
  | "cancelled"
  /**
   * A completed stage an upstream decision has outrun since it ran
   * (avg-qr4.3, task 9). Type only here — the projection that ever produces
   * it and the UI that renders it are Task 11's.
   */
  | "stale";

/* ── episode detail ── */

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
  createdAt: string;
  updatedAt: string;
}

/* ── connection / capability ── */

export interface ConnectionState {
  gateway: boolean;
  pi: boolean;
  runtime: boolean;
  adapter: boolean;
  since: string;
}

/* ── events (SSE / WS) ── */

export type WsEventType =
  | "stage.progress"
  | "stage.completed"
  | "stage.failed"
  | "episode.updated"
  | "artifact.saved"
  | "stale.changed"
  | "deliverable.changed"
  | "connection.changed"
  | "agent.action_queued"
  | "agent.response"
  | "review.created"
  | "approval.required";

export interface WsEvent {
  type: WsEventType;
  sequence: number;
  timestamp: string;
  episode: string;
  payload: Record<string, unknown>;
}
