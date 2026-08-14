// ---------------------------------------------------------------------------
// Review thread routes
// ---------------------------------------------------------------------------
// Anchored review threads: operators and Pi exchange structured feedback
// on artifacts, scene plans, renders, etc. Each thread is keyed by an
// anchor (e.g., "script/scene-3") and stored as a JSONL file.
// ---------------------------------------------------------------------------

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { EventBus, createEvent } from "../events/bus.js";

// ── Types ───────────────────────────────────────────────────────────────────

interface ReviewRouteOptions {
  root: string;
  bus?: EventBus;
}

export interface ReviewMessage {
  /** Unique ID within the thread. */
  id: string;
  /** "operator" or "pi" */
  author: "operator" | "pi";
  /** Message text (markdown). */
  body: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Optional status badge. */
  status?: "open" | "resolved" | "wont-fix" | "acknowledged";
  /** Agent epoch/attempt indicator. */
  agentStatus?: "thinking" | "executing" | "waiting" | "done";
}

export interface ReviewThread {
  /** Unique thread ID. */
  id: string;
  /** Anchor: e.g. "script/scene-3", "render/outro", "narration/all" */
  anchor: string;
  /** Episode slug. */
  episodeSlug: string;
  /** Messages ordered by time. */
  messages: ReviewMessage[];
  /** ISO-8601 timestamps. */
  createdAt: string;
  updatedAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function threadFilePath(root: string, channel: string, series: string, episode: string, threadId: string): string {
  return path.join(root, channel, series, episode, "reviews", `${threadId}.json`);
}

function threadsDir(root: string, channel: string, series: string, episode: string): string {
  return path.join(root, channel, series, episode, "reviews");
}

function makeId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Routes ───────────────────────────────────────────────────────────────────

export function registerReviewRoutes(
  app: FastifyInstance,
  options: ReviewRouteOptions,
): void {
  const { root, bus } = options;

  // ── GET /api/channels/:c/series/:s/episodes/:e/reviews ──────────────

  app.get("/api/channels/:channel/series/:series/episodes/:episode/reviews", {
    schema: {
      description: "List all review threads for an episode.",
      tags: ["reviews"],
      params: {
        type: "object",
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
        },
        required: ["channel", "series", "episode"],
      },
    },
  }, async (request: FastifyRequest<{
    Params: { channel: string; series: string; episode: string };
  }>, reply: FastifyReply) => {
    const { channel, series, episode } = request.params;
    const dir = threadsDir(root, channel!, series!, episode!);

    try {
      const files = await fs.readdir(dir);
      const threads: ReviewThread[] = [];

      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const raw = await fs.readFile(path.join(dir, file), "utf-8");
          threads.push(JSON.parse(raw));
        } catch {
          // Skip corrupt files
        }
      }

      return reply.send({ threads });
    } catch (e: any) {
      if (e.code === "ENOENT") {
        return reply.send({ threads: [] });
      }
      return reply.status(500).send({ error: `Failed to list reviews: ${e.message}` });
    }
  });

  // ── GET /api/channels/:c/series/:s/episodes/:e/reviews/:id ──────────

  app.get("/api/channels/:channel/series/:series/episodes/:episode/reviews/:threadId", {
    schema: {
      description: "Get a single review thread.",
      tags: ["reviews"],
      params: {
        type: "object",
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
          threadId: { type: "string" },
        },
        required: ["channel", "series", "episode", "threadId"],
      },
    },
  }, async (request: FastifyRequest<{
    Params: { channel: string; series: string; episode: string; threadId: string };
  }>, reply: FastifyReply) => {
    const { channel, series, episode, threadId } = request.params;
    const filePath = threadFilePath(root, channel!, series!, episode!, threadId!);

    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return reply.send(JSON.parse(raw));
    } catch (e: any) {
      if (e.code === "ENOENT") {
        return reply.status(404).send({ error: "Thread not found", threadId });
      }
      return reply.status(500).send({ error: `Failed to read thread: ${e.message}` });
    }
  });

  // ── POST /api/channels/:c/series/:s/episodes/:e/reviews ─────────────

  app.post("/api/channels/:channel/series/:series/episodes/:episode/reviews", {
    schema: {
      description: "Create a new review thread.",
      tags: ["reviews"],
      params: {
        type: "object",
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
        },
        required: ["channel", "series", "episode"],
      },
      body: {
        type: "object",
        properties: {
          anchor: { type: "string" },
          body: { type: "string" },
        },
        required: ["anchor"],
      },
    },
  }, async (request: FastifyRequest<{
    Params: { channel: string; series: string; episode: string };
    Body: { anchor: string; body?: string };
  }>, reply: FastifyReply) => {
    const { channel, series, episode } = request.params;
    const { anchor, body } = request.body;
    const threadId = `review-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const messages: ReviewMessage[] = [];
    if (body && body.trim()) {
      messages.push({
        id: makeId(),
        author: "operator",
        body,
        timestamp: now,
        status: "open",
      });
    }

    const thread: ReviewThread = {
      id: threadId,
      anchor,
      episodeSlug: `${channel}/${series}/${episode}`,
      messages,
      createdAt: now,
      updatedAt: now,
    };

    const filePath = threadFilePath(root, channel!, series!, episode!, threadId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(thread, null, 2), "utf-8");

    if (bus) {
      bus.publish(createEvent(
        "review",
        "thread-created",
        { threadId, anchor },
        `${channel}/${series}/${episode}`,
      ));
    }

    return reply.status(201).send(thread);
  });

  // ── POST /api/channels/:c/series/:s/episodes/:e/reviews/:id/messages ─

  app.post("/api/channels/:channel/series/:series/episodes/:episode/reviews/:threadId/messages", {
    schema: {
      description: "Add a message to a review thread.",
      tags: ["reviews"],
      params: {
        type: "object",
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
          threadId: { type: "string" },
        },
        required: ["channel", "series", "episode", "threadId"],
      },
      body: {
        type: "object",
        properties: {
          author: { type: "string", enum: ["operator", "pi"] },
          body: { type: "string" },
          status: { type: "string", enum: ["open", "resolved", "wont-fix", "acknowledged"] },
          agentStatus: { type: "string", enum: ["thinking", "executing", "waiting", "done"] },
        },
        required: ["author", "body"],
      },
    },
  }, async (request: FastifyRequest<{
    Params: { channel: string; series: string; episode: string; threadId: string };
    Body: { author: "operator" | "pi"; body: string; status?: string; agentStatus?: string };
  }>, reply: FastifyReply) => {
    const { channel, series, episode, threadId } = request.params;
    const { author, body, status, agentStatus } = request.body;

    const filePath = threadFilePath(root, channel!, series!, episode!, threadId!);

    let thread: ReviewThread;
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      thread = JSON.parse(raw);
    } catch (e: any) {
      if (e.code === "ENOENT") {
        return reply.status(404).send({ error: "Thread not found", threadId });
      }
      return reply.status(500).send({ error: `Failed to read thread: ${e.message}` });
    }

    const message: ReviewMessage = {
      id: makeId(),
      author,
      body,
      timestamp: new Date().toISOString(),
      status: status as ReviewMessage["status"],
      agentStatus: agentStatus as ReviewMessage["agentStatus"],
    };

    thread.messages.push(message);
    thread.updatedAt = new Date().toISOString();
    await fs.writeFile(filePath, JSON.stringify(thread, null, 2), "utf-8");

    if (bus) {
      bus.publish(createEvent(
        "review",
        "message-added",
        { threadId, messageId: message.id, author },
        `${channel}/${series}/${episode}`,
      ));
    }

    return reply.status(201).send({ thread, message });
  });

  // ── PATCH /api/channels/:c/series/:s/episodes/:e/reviews/:id/messages/:mid ─

  app.patch("/api/channels/:channel/series/:series/episodes/:episode/reviews/:threadId/messages/:messageId", {
    schema: {
      description: "Update a message status or body.",
      tags: ["reviews"],
      params: {
        type: "object",
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
          threadId: { type: "string" },
          messageId: { type: "string" },
        },
        required: ["channel", "series", "episode", "threadId", "messageId"],
      },
      body: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["open", "resolved", "wont-fix", "acknowledged"] },
          agentStatus: { type: "string", enum: ["thinking", "executing", "waiting", "done"] },
          body: { type: "string" },
        },
      },
    },
  }, async (request: FastifyRequest<{
    Params: { channel: string; series: string; episode: string; threadId: string; messageId: string };
    Body: { status?: string; agentStatus?: string; body?: string };
  }>, reply: FastifyReply) => {
    const { channel, series, episode, threadId, messageId } = request.params;

    const filePath = threadFilePath(root, channel!, series!, episode!, threadId!);

    let thread: ReviewThread;
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      thread = JSON.parse(raw);
    } catch (e: any) {
      if (e.code === "ENOENT") {
        return reply.status(404).send({ error: "Thread not found", threadId });
      }
      return reply.status(500).send({ error: `Failed to read thread: ${e.message}` });
    }

    const msgIdx = thread.messages.findIndex((m) => m.id === messageId);
    if (msgIdx === -1) {
      return reply.status(404).send({ error: "Message not found", messageId });
    }

    if (request.body.status) thread.messages[msgIdx]!.status = request.body.status as ReviewMessage["status"];
    if (request.body.agentStatus) thread.messages[msgIdx]!.agentStatus = request.body.agentStatus as ReviewMessage["agentStatus"];
    if (request.body.body) thread.messages[msgIdx]!.body = request.body.body;
    thread.updatedAt = new Date().toISOString();

    await fs.writeFile(filePath, JSON.stringify(thread, null, 2), "utf-8");

    if (bus) {
      bus.publish(createEvent(
        "review",
        "message-updated",
        { threadId, messageId },
        `${channel}/${series}/${episode}`,
      ));
    }

    return reply.send(thread);
  });

  // ── PATCH thread-level resolve ─────────────────────────────────────

  app.patch("/api/channels/:channel/series/:series/episodes/:episode/reviews/:threadId/resolve", {
    schema: {
      description: "Resolve an entire review thread.",
      tags: ["reviews"],
      params: {
        type: "object",
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
          threadId: { type: "string" },
        },
        required: ["channel", "series", "episode", "threadId"],
      },
    },
  }, async (request: FastifyRequest<{
    Params: { channel: string; series: string; episode: string; threadId: string };
  }>, reply: FastifyReply) => {
    const { channel, series, episode, threadId } = request.params;
    const filePath = threadFilePath(root, channel!, series!, episode!, threadId!);

    let thread: ReviewThread;
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      thread = JSON.parse(raw);
    } catch (e: any) {
      if (e.code === "ENOENT") return reply.status(404).send({ error: "Thread not found", threadId });
      return reply.status(500).send({ error: `Failed to read: ${e.message}` });
    }

    // Mark all messages as resolved
    for (const msg of thread.messages) {
      msg.status = "resolved";
    }
    thread.updatedAt = new Date().toISOString();
    await fs.writeFile(filePath, JSON.stringify(thread, null, 2), "utf-8");

    if (bus) {
      bus.publish(createEvent("review", "thread-resolved", { threadId }, `${channel}/${series}/${episode}`));
    }

    return reply.send(thread);
  });
}
