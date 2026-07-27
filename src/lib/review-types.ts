/** A review thread anchored to a production artifact. */
export interface ReviewThread {
  id: string;
  anchor: ReviewAnchor;
  status: "open" | "resolved" | "reopened";
  messages: ReviewMessage[];
  createdAt: string;
}

export interface ReviewAnchor {
  kind: "artifact" | "scene" | "asset" | "narration" | "frame";
  targetId: string;
  /** If kind is "frame", the timecode in seconds. */
  timecode?: number;
  /** The artifact revision this thread was created against. */
  artifactRevision?: string;
}

export interface ReviewMessage {
  id: string;
  author: "operator" | "pi";
  text: string;
  /** When sent to Pi, the action type. */
  action?: "prompt" | "steer" | "follow_up";
  /** Pi agent action status when applicable. */
  agentStatus?: "queued" | "running" | "settled" | "error";
  /** The stage attempt resulting from this action, if any. */
  resultingAttemptId?: string;
  createdAt: string;
}

export const THREAD_STATUS_LABELS: Record<ReviewThread["status"], string> = {
  open: "Open",
  resolved: "Resolved",
  reopened: "Reopened",
};

export const AGENT_STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  settled: "Done",
  error: "Failed",
};
