// ── Workspace file API ──────────────────────────────────────────────────────
//
// One implementation, registered once per level (channel, series, episode).
//
// The editor previously carried three near-duplicate route families and no way
// to enumerate anything, so the studio guessed five filenames — README.md,
// pipeline.yaml, format.yaml, style-guide.md, art-direction.md — and probed
// each with a request. A channel's characters/ or references/ folder could
// never appear, because nothing could list a directory.
//
// Paths are resolved through @studio/contracts/src/layout.mjs so this file has
// no opinion about where a level lives.
// ---------------------------------------------------------------------------

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  channelPath,
  seriesPath,
  episodePath,
} from "@studio/contracts/src/layout.mjs";
import {
  recordRevision,
  listRevisions,
  readRevision,
  restoreRevision,
} from "./revisions.js";

export type Level = "channel" | "series" | "episode";

/** Entry in a directory listing. */
export interface FileEntry {
  name: string;
  /** Path relative to the level root, always forward-slashed. */
  path: string;
  kind: "file" | "directory";
  size: number | null;
  updatedAt: string;
  /** Best-effort media classification, for the studio to pick a viewer. */
  contentType: string | null;
}

const TEXT_EXT = new Set([
  ".md", ".txt", ".yaml", ".yml", ".json", ".jsonl", ".srt", ".vtt",
  ".ts", ".js", ".mjs", ".py", ".sh", ".css", ".html", ".xml", ".csv",
]);

const CONTENT_TYPES: Record<string, string> = {
  ".md": "text/markdown", ".txt": "text/plain", ".yaml": "text/yaml",
  ".yml": "text/yaml", ".json": "application/json", ".jsonl": "application/jsonl",
  ".srt": "text/plain", ".vtt": "text/vtt", ".csv": "text/csv",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
  ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
  ".pdf": "application/pdf", ".zip": "application/zip",
};

export function contentTypeFor(filePath: string): string | null {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? null;
}

export function isTextFile(filePath: string): boolean {
  return TEXT_EXT.has(path.extname(filePath).toLowerCase());
}

/** Content hash used for optimistic concurrency on writes. */
export function computeRevision(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// ── Path safety ─────────────────────────────────────────────────────────────

/**
 * Absolute path to a level's root directory.
 *
 * Every level goes through the layout module, so nothing here needs to know
 * that episodes live under `series/<s>/episodes/`.
 */
export function levelRoot(
  root: string,
  level: Level,
  params: { channel: string; series?: string; episode?: string },
): string {
  if (level === "channel") return channelPath(root, params.channel);
  if (level === "series") return seriesPath(root, params.channel, params.series!);
  return episodePath(root, params.channel, params.series!, params.episode!);
}

/**
 * Resolve a caller-supplied relative path inside a level, or null if it
 * escapes. Rejecting by prefix alone is not enough — `..` segments and
 * absolute paths are normalised first, and the boundary check requires a
 * separator so `/library/ch2` cannot pass as being inside `/library/ch`.
 */
export function resolveInside(levelDir: string, relative: string): string | null {
  const cleaned = relative.replace(/^\/+/, "");
  const resolved = path.resolve(levelDir, cleaned);
  const base = path.resolve(levelDir);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

const fail = (reply: FastifyReply, status: number, error: string, message: string) =>
  reply.status(status).send({ error, message, correlationId: randomUUID() });

// ── Listing ─────────────────────────────────────────────────────────────────

/** Names that are never content and are hidden from listings. */
const HIDDEN = new Set([".DS_Store", ".workspace", ".revisions"]);

async function listDirectory(dir: string, levelDir: string, recursive: boolean): Promise<FileEntry[]> {
  const out: FileEntry[] = [];

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (HIDDEN.has(entry.name)) continue;
      const abs = path.join(current, entry.name);
      const rel = path.relative(levelDir, abs).split(path.sep).join("/");
      let stat;
      try {
        stat = await fs.stat(abs);
      } catch {
        continue;
      }
      const isDir = entry.isDirectory();
      out.push({
        name: entry.name,
        path: rel,
        kind: isDir ? "directory" : "file",
        size: isDir ? null : stat.size,
        updatedAt: stat.mtime.toISOString(),
        contentType: isDir ? null : contentTypeFor(entry.name),
      });
      if (isDir && recursive) await walk(abs);
    }
  }

  await walk(dir);
  out.sort((a, b) =>
    a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === "directory" ? -1 : 1,
  );
  return out;
}

// ── Registration ────────────────────────────────────────────────────────────

export interface FileRoutesOptions {
  root: string;
  level: Level;
  /** Route prefix, e.g. "/api/channels/:channel/series/:series". */
  prefix: string;
}

export function registerWorkspaceFileRoutes(
  app: FastifyInstance,
  options: FileRoutesOptions,
): void {
  const { root, level, prefix } = options;

  const dirFor = (req: FastifyRequest): string =>
    levelRoot(root, level, req.params as { channel: string; series?: string; episode?: string });

  // ── List ──────────────────────────────────────────────────────────────
  app.get(`${prefix}/files`, {
    schema: {
      description: `List files and directories at the ${level} level.`,
      tags: ["workspace"],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { path?: string; recursive?: string };
    const levelDir = dirFor(request);
    const target = resolveInside(levelDir, query.path ?? "");
    if (!target) return fail(reply, 403, "FORBIDDEN", "Path escapes the workspace");

    try {
      await fs.access(target);
    } catch {
      return fail(reply, 404, "NOT_FOUND", `No such directory: ${query.path ?? "/"}`);
    }

    const entries = await listDirectory(target, levelDir, query.recursive === "true");
    return reply.send({ level, path: query.path ?? "", entries });
  });

  // ── Create (file or directory) ────────────────────────────────────────
  app.post(`${prefix}/files`, {
    schema: {
      description: `Create an empty file or a directory at the ${level} level.`,
      tags: ["workspace"],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { path?: string; kind?: "file" | "directory"; content?: string };
    if (!body?.path) return fail(reply, 400, "BAD_REQUEST", "path is required");

    const levelDir = dirFor(request);
    const target = resolveInside(levelDir, body.path);
    if (!target) return fail(reply, 403, "FORBIDDEN", "Path escapes the workspace");

    try {
      await fs.access(target);
      return fail(reply, 409, "CONFLICT", `Already exists: ${body.path}`);
    } catch { /* expected */ }

    if (body.kind === "directory") {
      await fs.mkdir(target, { recursive: true });
      return reply.status(201).send({ path: body.path, kind: "directory" });
    }

    await fs.mkdir(path.dirname(target), { recursive: true });
    const content = Buffer.from(body.content ?? "", "utf-8");
    await fs.writeFile(target, content);
    return reply.status(201).send({
      path: body.path,
      kind: "file",
      revision: computeRevision(content),
    });
  });

  // ── Upload (any type) ─────────────────────────────────────────────────
  app.post(`${prefix}/upload`, {
    schema: {
      description: `Upload one or more files of any type to the ${level} level.`,
      tags: ["workspace"],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.isMultipart?.()) {
      return fail(reply, 400, "BAD_REQUEST", "Expected a multipart/form-data body");
    }

    const levelDir = dirFor(request);
    const written: Array<{ path: string; size: number }> = [];

    // A `dir` field may precede the files to place them in a subdirectory.
    let targetDir = "";
    for await (const part of (request as any).parts()) {
      if (part.type === "field" && part.fieldname === "dir") {
        targetDir = String(part.value);
        continue;
      }
      if (part.type !== "file") continue;

      const rel = path.posix.join(targetDir, path.basename(part.filename));
      const abs = resolveInside(levelDir, rel);
      if (!abs) {
        return fail(reply, 403, "FORBIDDEN", `Path escapes the workspace: ${rel}`);
      }
      await fs.mkdir(path.dirname(abs), { recursive: true });
      const buffer = await part.toBuffer();
      await fs.writeFile(abs, buffer);
      written.push({ path: rel, size: buffer.length });
    }

    if (!written.length) return fail(reply, 400, "BAD_REQUEST", "No files in the request");
    return reply.status(201).send({ level, uploaded: written });
  });

  // ── Move / rename ─────────────────────────────────────────────────────
  app.post(`${prefix}/move`, {
    schema: {
      description: `Move or rename a file or directory within the ${level} level.`,
      tags: ["workspace"],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { from?: string; to?: string };
    if (!body?.from || !body?.to) {
      return fail(reply, 400, "BAD_REQUEST", "from and to are required");
    }

    const levelDir = dirFor(request);
    const from = resolveInside(levelDir, body.from);
    const to = resolveInside(levelDir, body.to);
    if (!from || !to) return fail(reply, 403, "FORBIDDEN", "Path escapes the workspace");

    try {
      await fs.access(from);
    } catch {
      return fail(reply, 404, "NOT_FOUND", `No such path: ${body.from}`);
    }
    try {
      await fs.access(to);
      return fail(reply, 409, "CONFLICT", `Already exists: ${body.to}`);
    } catch { /* expected */ }

    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
    return reply.send({ from: body.from, to: body.to });
  });

  // ── Write, snapshotting the previous content ──────────────────────────
  app.put(`${prefix}/files`, {
    schema: {
      description: `Write a file at the ${level} level, keeping the previous version.`,
      tags: ["workspace"],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { path?: string; content?: string; expectedRevision?: string };
    if (!body?.path) return fail(reply, 400, "BAD_REQUEST", "path is required");

    const levelDir = dirFor(request);
    const target = resolveInside(levelDir, body.path);
    if (!target) return fail(reply, 403, "FORBIDDEN", "Path escapes the workspace");

    // Optimistic concurrency: refuse a write based on a stale read.
    if (body.expectedRevision) {
      try {
        const current = await fs.readFile(target);
        const actual = computeRevision(current);
        if (actual !== body.expectedRevision) {
          return fail(
            reply,
            409,
            "CONFLICT",
            `File changed since it was read (expected ${body.expectedRevision}, found ${actual})`,
          );
        }
      } catch { /* file is new; nothing to conflict with */ }
    }

    const previous = await recordRevision(levelDir, body.path, target, "edit");
    await fs.mkdir(path.dirname(target), { recursive: true });
    const content = Buffer.from(body.content ?? "", "utf-8");
    await fs.writeFile(target, content);

    return reply.send({
      path: body.path,
      revision: computeRevision(content),
      previousRevision: previous?.id ?? null,
    });
  });

  // ── Revisions ─────────────────────────────────────────────────────────
  app.get(`${prefix}/revisions`, {
    schema: {
      description: `List stored versions of a file at the ${level} level.`,
      tags: ["workspace"],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { path?: string; id?: string };
    if (!query?.path) return fail(reply, 400, "BAD_REQUEST", "path is required");

    const levelDir = dirFor(request);
    if (!resolveInside(levelDir, query.path)) {
      return fail(reply, 403, "FORBIDDEN", "Path escapes the workspace");
    }

    // With `id`, return that version's bytes rather than the list.
    if (query.id) {
      const content = await readRevision(levelDir, query.path, query.id);
      if (content === null) {
        return fail(reply, 404, "NOT_FOUND", `No such revision: ${query.id}`);
      }
      const type = contentTypeFor(query.path);
      if (type) reply.header("content-type", type);
      return reply.send(isTextFile(query.path) ? content.toString("utf-8") : content);
    }

    return reply.send({
      path: query.path,
      revisions: await listRevisions(levelDir, query.path),
    });
  });

  app.post(`${prefix}/revisions/restore`, {
    schema: {
      description: `Restore a stored version over the live file at the ${level} level.`,
      tags: ["workspace"],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { path?: string; id?: string };
    if (!body?.path || !body?.id) {
      return fail(reply, 400, "BAD_REQUEST", "path and id are required");
    }

    const levelDir = dirFor(request);
    const target = resolveInside(levelDir, body.path);
    if (!target) return fail(reply, 403, "FORBIDDEN", "Path escapes the workspace");

    const result = await restoreRevision(levelDir, body.path, target, body.id);
    if (!result) return fail(reply, 404, "NOT_FOUND", `No such revision: ${body.id}`);

    // The pre-restore content is itself kept, so this is undoable.
    return reply.send({ path: body.path, restored: body.id, previous: result.previous?.id ?? null });
  });

  // ── Delete ────────────────────────────────────────────────────────────
  app.delete(`${prefix}/files`, {
    schema: {
      description: `Delete a file or directory at the ${level} level.`,
      tags: ["workspace"],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { path?: string; recursive?: string };
    if (!query?.path) return fail(reply, 400, "BAD_REQUEST", "path is required");

    const levelDir = dirFor(request);
    const target = resolveInside(levelDir, query.path);
    if (!target) return fail(reply, 403, "FORBIDDEN", "Path escapes the workspace");
    if (path.resolve(target) === path.resolve(levelDir)) {
      return fail(reply, 403, "FORBIDDEN", "Refusing to delete the workspace root");
    }

    let stat;
    try {
      stat = await fs.stat(target);
    } catch {
      return fail(reply, 404, "NOT_FOUND", `No such path: ${query.path}`);
    }

    // A non-empty directory needs explicit intent: deleting an episode's
    // artifacts by accident is not recoverable from here.
    if (stat.isDirectory()) {
      const contents = await fs.readdir(target);
      if (contents.length > 0 && query.recursive !== "true") {
        return fail(
          reply,
          409,
          "CONFLICT",
          `Directory is not empty (${contents.length} entries). Pass recursive=true to delete it and everything inside.`,
        );
      }
      await fs.rm(target, { recursive: true, force: true });
    } else {
      // Keep a copy so a delete is recoverable from the revision history.
      await recordRevision(levelDir, query.path, target, "delete");
      await fs.rm(target);
    }

    return reply.send({ path: query.path, deleted: true });
  });
}
