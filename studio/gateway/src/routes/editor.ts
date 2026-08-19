// ---------------------------------------------------------------------------
// Workspace editor routes
// ---------------------------------------------------------------------------
// Read/write artifact files with revision-safe semantics.
// Every write is atomic (temp + rename). Conflicts detected via
// expected-revision headers.
// ---------------------------------------------------------------------------

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import * as fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import * as path from "node:path";
import {
  levelRoot,
  resolveInside,
  computeRevision,
  contentTypeFor,
  isTextFile,
} from "./workspace-files.js";
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
// Revisions are computed in one place. There were two definitions — a full
// sha256 here and a 16-character prefix in the workspace API — so a file read
// through one route could never be written through the other: the
// If-Match check compared a 64-character hash against a 16-character one and
// always reported a conflict.

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
  // Levels are resolved through the layout module rather than joined by hand,
  // so this stays correct wherever episodes live. Joining
  // root/channel/series/episode directly was layout 1, and started returning
  // 404 for every episode file the moment the library moved to layout 2.
  const levelDir = episode
    ? levelRoot(root, "episode", { channel, series, episode })
    : series
      ? levelRoot(root, "series", { channel, series })
      : levelRoot(root, "channel", { channel });

  return resolveInside(levelDir, artifactPath);
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
      // Shared with the channel and series routes so binary files are served
      // as bytes in exactly one place rather than three.
      return await serveFile(absPath, filePath, reply, request.headers.range);
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

// ── Shared file-serving helper for any level ────────────────────────────

/**
 * Serve one file.
 *
 * Text is returned in a JSON envelope carrying the revision, which is what the
 * editor needs for its If-Match write check.
 *
 * Binary is returned as bytes with its real media type. It used to go through
 * the same envelope via `content.toString("utf-8")`, which silently destroyed
 * it: every byte sequence that is not valid UTF-8 became U+FFFD, so a 1.3 MB
 * WAV arrived as 5 MB of replacement characters. Nothing downstream could
 * recover from that — no image rendered, no audio decoded, no video played —
 * and because the request still returned 200 it looked like a client bug.
 *
 * The revision header is still set either way, so callers that care about
 * versioning do not have to special-case media.
 */
/**
 * Parse a single-range `Range` header against a known size.
 *
 * Only the one-range form is honoured, which is what media elements send.
 * Returns "unsatisfiable" for a range that starts past the end so the caller
 * can answer 416 rather than streaming nothing and looking like a stall.
 */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  let start: number;
  let end: number;

  if (rawStart === "") {
    /* `bytes=-500` means the last 500 bytes. */
    const wanted = Number(rawEnd);
    if (wanted === 0) return "unsatisfiable";
    start = Math.max(size - wanted, 0);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }

  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

/**
 * Stream a binary file, honouring `Range`.
 *
 * Streamed rather than read into a Buffer: a 40 MB render was being loaded
 * whole into gateway memory for every request, and the browser then had to wait
 * for all of it before showing a first frame. With ranges the player fetches
 * what it needs and seeking works.
 */
function sendBinary(
  absPath: string,
  filePath: string,
  size: number,
  range: string | undefined,
  reply: FastifyReply,
): FastifyReply {
  const type = contentTypeFor(filePath) ?? "application/octet-stream";
  reply.header("Accept-Ranges", "bytes").header("Content-Type", type);

  const parsed = parseRange(range, size);

  if (parsed === "unsatisfiable") {
    return reply
      .status(416)
      .header("Content-Range", `bytes */${size}`)
      .send();
  }

  if (parsed) {
    const length = parsed.end - parsed.start + 1;
    return reply
      .status(206)
      .header("Content-Range", `bytes ${parsed.start}-${parsed.end}/${size}`)
      .header("Content-Length", String(length))
      .send(createReadStream(absPath, { start: parsed.start, end: parsed.end }));
  }

  return reply
    .header("Content-Length", String(size))
    .send(createReadStream(absPath));
}

/**
 * Every branch returns the reply, and every caller returns what this returns.
 *
 * That is load-bearing, not style. An async Fastify handler that resolves with
 * `undefined` is treated as not having answered, and the framework finalises
 * the response itself — headers intact, body dropped. The symptom is a 200 with
 * `Content-Length: 0`, which looks like an empty file rather than a wiring
 * mistake.
 */
async function serveFile(
  absPath: string,
  filePath: string,
  reply: FastifyReply,
  range?: string,
): Promise<FastifyReply> {
  const stat = await fs.stat(absPath);

  reply.header("X-Last-Modified", stat.mtime.toISOString());

  /* Text keeps its revision envelope, so it is still read whole — these are
     manifests and scripts, not media. Binary is streamed and never buffered. */
  if (!isTextFile(filePath)) {
    /* No revision header on media. The revision is a hash of the bytes, and
       hashing a 40 MB render on every range request would undo the point of
       streaming it. Nothing consumes it for media either — the If-Match write
       path is text-only — so media carries size and mtime instead. */
    return sendBinary(absPath, filePath, stat.size, range, reply);
  }

  const content = await fs.readFile(absPath);
  const revision = computeRevision(content);

  return reply
    .header("X-Content-Revision", revision)
    .header("Content-Type", "application/json")
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
    try { return await serveFile(absPath, filePath, reply, request.headers.range); }
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
    try { return await serveFile(absPath, filePath, reply, request.headers.range); }
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
