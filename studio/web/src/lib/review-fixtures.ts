import type { ReviewThread } from "$lib/review-types";

export const INBOX_FIXTURE: ReviewThread[] = [
  {
    id: "thread-1",
    anchor: {
      kind: "scene",
      targetId: "scene-3",
      artifactRevision: "rev-c3d4",
    },
    status: "open",
    messages: [
      {
        id: "msg-1a",
        author: "operator",
        text: "The locality visualization is too abstract. Can we show a concrete array traversal example instead?",
        createdAt: "2026-07-27T11:30:00Z",
      },
      {
        id: "msg-1b",
        author: "pi",
        text: "Regenerated scene 3 with a concrete C array example showing row-major traversal vs. column-major. New attempt available.",
        action: "steer",
        agentStatus: "settled",
        resultingAttemptId: "attempt-3b",
        createdAt: "2026-07-27T11:35:00Z",
      },
    ],
    createdAt: "2026-07-27T11:30:00Z",
  },
  {
    id: "thread-2",
    anchor: {
      kind: "narration",
      targetId: "seg-5",
      artifactRevision: "rev-e5f6",
    },
    status: "open",
    messages: [
      {
        id: "msg-2a",
        author: "operator",
        text: "The pacing is too fast in segment 5 — can we slow down the latency vs bandwidth explanation?",
        action: "steer",
        agentStatus: "queued",
        createdAt: "2026-07-27T11:40:00Z",
      },
    ],
    createdAt: "2026-07-27T11:40:00Z",
  },
  {
    id: "thread-3",
    anchor: {
      kind: "artifact",
      targetId: "script",
      artifactRevision: "rev-b2c3",
    },
    status: "resolved",
    messages: [
      {
        id: "msg-3a",
        author: "operator",
        text: "Scene 4 needs a better analogy for cache lines — maybe use the conveyor belt metaphor?",
        createdAt: "2026-07-27T10:20:00Z",
      },
      {
        id: "msg-3b",
        author: "pi",
        text: "Updated script with conveyor belt analogy in scene 4. Ready for review.",
        action: "prompt",
        agentStatus: "settled",
        resultingAttemptId: "attempt-script-v2",
        createdAt: "2026-07-27T10:25:00Z",
      },
      {
        id: "msg-3c",
        author: "operator",
        text: "Looks good, resolving.",
        createdAt: "2026-07-27T10:30:00Z",
      },
    ],
    createdAt: "2026-07-27T10:20:00Z",
  },
];
