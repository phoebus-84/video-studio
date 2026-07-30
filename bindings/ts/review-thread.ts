/**
 * TypeScript bindings generated from review-thread.schema.json
 * Schema: https://video.studio/schemas/v1alpha1/review-thread.schema.json
 * Auto-generated — do not edit directly.
 */

export type ThreadStatus = "open" | "resolved" | "wontfix";

export type TargetType = "artifact" | "scene" | "asset-attempt" | "narration-segment" | "deliverable";

export interface AnchorLocation {
  line?: number;
  timecodeSec?: number;
  sceneId?: string;
}

export interface ReviewAnchor {
  targetType: TargetType;
  targetPath: string;
  revision?: string;
  location?: AnchorLocation;
}

export type CommentAuthor = "human" | "pi" | "system";

export interface ReviewComment {
  id: string;
  at: string;
  author: CommentAuthor;
  body: string;
  sentToPi?: boolean;
}

export interface ReviewThread {
  apiVersion: "studio.video/v1alpha1";
  kind: "ReviewThread";
  id: string;
  createdAt: string;
  status: ThreadStatus;
  anchor: ReviewAnchor;
  comments: ReviewComment[];
}
