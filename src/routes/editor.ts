// ---------------------------------------------------------------------------
// Workspace editor routes
// ---------------------------------------------------------------------------
// Read/write artifact files with revision-safe semantics.
// Every write is atomic (temp + rename). Conflicts detected via
// expected-revision headers.
// ---------------------------------------------------------------------------

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { EventBus, createEvent } from "../events/bus.js";

// ── Types ───────────────────────────────────────────────────────────────────

interface EditorRouteOptions {
  root: string;
  bus?: EventBus;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute a SHA-256 revision ID for file content.
 */
function computeRevision(content: Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Resolve and validate an artifact path within the library root.
 * Returns null if the path escapes the root.
 */
async function resolveArtifactPath(
  root: string,
  channel: string,
  series: string,
  episode: string,
  artifactPath: string,
): Promise<string | null> {
  // Normalize and join
  const normalized = path.normalize(
    path.join(root, channel, series, episode, artifactPath),
  );
  const rootNormalized = path.normalize(root);

  // Security: ensure the resolved path is within root
  if (!normalized.startsWith(rootNormalized)) {
    return null;
  }

  return normalized;
}

/**
 * Parse channel/series/episode from path params.
 */
function parseEpisode(params: Record<string, string | undefined>) {
  return {
    channel: params.channel!,
    series: params.series!,
    episode: params.episode!,
  };
}

// ── Routes ───────────────────────────────────────────────────────────────────

export function registerEditorRoutes(
  app: FastifyInstance,
  options: EditorRouteOptions,
): void {
  const { root, bus } = options;

  // ── GET /api/channels/:c/series/:s/episodes/:e/file/* ───────────────

  app.get("/api/channels/:channel/series/:series/episodes/:episode/file/*", {
    schema: {
      description: "Read an artifact file. Returns file content with revision header.",
      tags: ["editor"],
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
    const { channel, series, episode } = parseEpisode(request.params);
    const filePath = (request.params as any)["*"] ?? "";

    const absPath = await resolveArtifactPath(root, channel, series, episode, filePath);
    if (!absPath) {
      return reply.status(403).send({ error: "Path traversal not allowed" });
    }

    try {
      const stat = await fs.stat(absPath);

      // ── Directory listing ────────────────────────────────────────────
      if (stat.isDirectory()) {
        const entries = await fs.readdir(absPath, { withFileTypes: true });
        const listing = await Promise.all(
          entries
            .filter((e) => !e.name.startsWith("."))
            .map(async (e) => {
              const ep = path.join(absPath, e.name);
              let size: number | undefined;
              let mtime: string | undefined;
              try {
                const st = await fs.stat(ep);
                size = st.isFile() ? st.size : undefined;
                mtime = st.mtime.toISOString();
              } catch {}
              return {
                name: e.name,
                type: e.isDirectory() ? "directory" : "file",
                size,
                mtime,
              };
            })
        );
        listing.sort((a, b) => {
          if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        return reply.send({
          path: filePath,
          entries: listing,
        });
      }

      // ── File read ───────────────────────────────────────────────────
      const content = await fs.readFile(absPath);
      const revision = computeRevision(content);
      // stat is already available from the isDirectory check above

      return reply
        .header("X-Content-Revision", revision)
        .header("Content-Type", "application/json")
        .header("X-Last-Modified", stat.mtime.toISOString())
        .send(JSON.stringify({
          path: filePath,
          revision,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          content: content.toString("utf-8"),
        }));
    } catch (e: any) {
      if (e.code === "ENOENT") {
        return reply.status(404).send({ error: "File not found", path: filePath });
      }
      return reply.status(500).send({ error: `Read error: ${e.message}` });
    }
  });

  // ── PUT /api/channels/:c/series/:s/episodes/:e/file/* ───────────────

  app.put("/api/channels/:channel/series/:series/episodes/:episode/file/*", {
    schema: {
      description: "Write an artifact file atomically. Conflicts detected via If-Match revision header.",
      tags: ["editor"],
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
          content: { type: "string" },
        },
        required: ["content"],
      },
    },
  }, async (request: FastifyRequest<{
    Params: { channel: string; series: string; episode: string };
    Body: { content: string };
  }>, reply: FastifyReply) => {
    const { channel, series, episode } = parseEpisode(request.params);
    const filePath = (request.params as any)["*"] ?? "";
    const expectedRevision = request.headers["if-match"] as string | undefined;

    const absPath = await resolveArtifactPath(root, channel, series, episode, filePath);
    if (!absPath) {
      return reply.status(403).send({ error: "Path traversal not allowed" });
    }

    // Conflict detection: if client provides If-Match, check current revision
    if (expectedRevision && expectedRevision !== "*") {
      try {
        const existing = await fs.readFile(absPath);
        const currentRevision = computeRevision(existing);
        if (currentRevision !== expectedRevision) {
          return reply.status(409).send({
            error: "Conflict: file has been modified since last read",
            expectedRevision,
            currentRevision,
            path: filePath,
          });
        }
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
        // File doesn't exist yet — proceed
      }
    }

    // Atomic write: temp → rename
    const tempPath = absPath + `.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(tempPath, request.body.content, "utf-8");
      await fs.rename(tempPath, absPath);
    } catch (e: any) {
      // Cleanup temp file
      try { await fs.unlink(tempPath); } catch { /* ignore */ }
      return reply.status(500).send({ error: `Write error: ${e.message}` });
    }

    const stat = await fs.stat(absPath);
    const revision = computeRevision(Buffer.from(request.body.content, "utf-8"));

    // Emit workspace change event
    if (bus) {
      bus.publish(createEvent(
        "workspace",
        "artifact-written",
        {
          path: filePath,
          episodeSlug: `${channel}/${series}/${episode}`,
          revision,
          size: stat.size,
        },
        `${channel}/${series}/${episode}`,
      ));
    }

    return reply
      .header("X-Content-Revision", revision)
      .send({
        path: filePath,
        revision,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      });
  });

  // ── GET /api/channels/:c/series/:s/episodes/:e/revisions/* ──────────

  app.get("/api/channels/:channel/series/:series/episodes/:episode/revisions/*", {
    schema: {
      description: "List revision history for an artifact file.",
      tags: ["editor"],
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
    const { channel, series, episode } = parseEpisode(request.params);
    const filePath = (request.params as any)["*"] ?? "";

    const absPath = await resolveArtifactPath(root, channel, series, episode, filePath);
    if (!absPath) {
      return reply.status(403).send({ error: "Path traversal not allowed" });
    }

    // Read revision history from .revisions.json sidecar
    const revisionsPath = path.join(path.dirname(absPath), ".revisions.json");
    try {
      const raw = await fs.readFile(revisionsPath, "utf-8");
      const revisions = JSON.parse(raw);
      return reply.send({ path: filePath, revisions });
    } catch (e: any) {
      if (e.code === "ENOENT") {
        return reply.send({ path: filePath, revisions: [] });
      }
      return reply.status(500).send({ error: `Revisions read error: ${e.message}` });
    }
  });
}

// ── Content type inference ──────────────────────────────────────────────────

function inferContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
    ".xml": "application/xml",
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".ts": "text/typescript",
    ".csv": "text/csv",
    ".srt": "text/plain",
    ".vtt": "text/vtt",
  };
  return map[ext] ?? "application/octet-stream";
}

// ── Shared file-serving helper for any level ────────────────────────────

async function serveFile(
  absPath: string,
  filePath: string,
  reply: FastifyReply,
): Promise<void> {
  const content = await fs.readFile(absPath);
  const revision = computeRevision(content);
  const stat = await fs.stat(absPath);

  return reply
    .header("X-Content-Revision", revision)
    .header("Content-Type", "application/json")
    .header("X-Last-Modified", stat.mtime.toISOString())
    .send(JSON.stringify({
      path: filePath,
      revision,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      content: content.toString("utf-8"),
    }));
}

// ── Channel-level file routes ──────────────────────────────────────────

export function registerChannelFileRoutes(
  app: FastifyInstance,
  root: string,
): void {
  // GET /api/channels/:channel/file/*
  app.get("/api/channels/:channel/file/*", {
    schema: {
      description: "Read a file at the channel level.",
      tags: ["editor"],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { channel } = request.params as { channel: string };
    const filePath = (request.params as any)["*"] ?? "";
    const absPath = await resolveArtifactPath(root, channel, "", "", filePath);
    if (!absPath) return reply.status(403).send({ error: "Path traversal not allowed" });
    try { await serveFile(absPath, filePath, reply); }
    catch (e: any) { reply.status(e.code === "ENOENT" ? 404 : 500).send({ error: e.message }); }
  });

  // PUT /api/channels/:channel/file/*
  app.put("/api/channels/:channel/file/*", {
    schema: { description: "Write a file at the channel level.", tags: ["editor"] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { channel } = request.params as { channel: string };
    const filePath = (request.params as any)["*"] ?? "";
    const absPath = await resolveArtifactPath(root, channel, "", "", filePath);
    if (!absPath) return reply.status(403).send({ error: "Path traversal not allowed" });
    const content = (request.body as any)?.content ?? (request.body as string);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, content);
    const revision = computeRevision(Buffer.from(content));
    return reply.send(JSON.stringify({ ok: true, revision, path: filePath }));
  });
}

// ── Series-level file routes ───────────────────────────────────────────

export function registerSeriesFileRoutes(
  app: FastifyInstance,
  root: string,
): void {
  // GET /api/channels/:channel/series/:series/file/*
  app.get("/api/channels/:channel/series/:series/file/*", {
    schema: {
      description: "Read a file at the series level.",
      tags: ["editor"],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { channel, series } = request.params as { channel: string; series: string };
    const filePath = (request.params as any)["*"] ?? "";
    const absPath = await resolveArtifactPath(root, channel, series, "", filePath);
    if (!absPath) return reply.status(403).send({ error: "Path traversal not allowed" });
    try { await serveFile(absPath, filePath, reply); }
    catch (e: any) { reply.status(e.code === "ENOENT" ? 404 : 500).send({ error: e.message }); }
  });

  // PUT /api/channels/:channel/series/:series/file/*
  app.put("/api/channels/:channel/series/:series/file/*", {
    schema: { description: "Write a file at the series level.", tags: ["editor"] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { channel, series } = request.params as { channel: string; series: string };
    const filePath = (request.params as any)["*"] ?? "";
    const absPath = await resolveArtifactPath(root, channel, series, "", filePath);
    if (!absPath) return reply.status(403).send({ error: "Path traversal not allowed" });
    const content = (request.body as any)?.content ?? (request.body as string);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, content);
    const revision = computeRevision(Buffer.from(content));
    return reply.send(JSON.stringify({ ok: true, revision, path: filePath }));
  });
}
