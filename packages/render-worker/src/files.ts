// What a render needs on the engine, from what renderTimeline would get here:
// every asset the timeline names and every library kit's sealed file, each
// mirrored under the job's files/ by its absolute local path (protocol.ts),
// and the job that points at them. Each file is hashed here first: the hash
// the timeline (or kit) promises must be the file's, or nothing is sent.

import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { RenderTimelineOptions } from "@av/remotion-composer";
import { mirrorPath, PROTOCOL_VERSION, RenderWorkerError, type ManifestEntry, type RenderJob } from "./protocol.js";

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return `sha256:${hash.digest("hex")}`;
}

const remembered = new Map<string, Promise<string>>();

/**
 * sha256File, read once per process while the file's identity, size and
 * modification time stay the same: every shared render hashed every
 * picture again, and so did the render on this machine right after.
 */
export async function sha256FileCached(file: string): Promise<string> {
  const s = await stat(file, { bigint: true });
  const key = `${s.ino !== 0n ? `${s.dev}:${s.ino}` : path.resolve(file)}:${s.size}:${s.mtimeNs}`;
  let pending = remembered.get(key);
  if (!pending) {
    pending = sha256File(file);
    pending.catch(() => remembered.delete(key));
    if (remembered.size >= 4096) remembered.delete(remembered.keys().next().value!);
    remembered.set(key, pending);
  }
  return pending;
}

export interface JobFile {
  entry: ManifestEntry;
  /** Where the file is here. */
  local: string;
}

export interface PreparedJob {
  job: RenderJob;
  files: JobFile[];
}

interface TimelineAssets {
  assets?: Record<string, { path?: unknown; hash?: unknown }>;
}

/** A timeline path the engine can resolve: posix separators, and an absolute one made relative to the asset root's mirror. */
function enginePath(assetRootMirror: string, assetPath: string, absolute: string): string {
  if (path.isAbsolute(assetPath) || /^[A-Za-z]:/.test(assetPath)) return path.posix.relative(assetRootMirror, mirrorPath(absolute));
  return assetPath.includes("\\") ? assetPath.replace(/\\/g, "/") : assetPath;
}

/**
 * The job and its files. The timeline is copied, and an asset path is
 * rewritten only when the engine could not read it as it is (a backslash, or
 * an absolute path); a plain relative path stays byte for byte.
 */
export async function prepareJob(options: RenderTimelineOptions): Promise<PreparedJob> {
  const assetRoot = path.resolve(options.assetRoot);
  const assetRootMirror = mirrorPath(assetRoot);
  const timeline = structuredClone(options.timeline) as TimelineAssets;
  const files = new Map<string, JobFile>();
  const problems: { code: string; message: string; path?: string }[] = [];

  const add = async (local: string, hash: string, where: string): Promise<string | null> => {
    const mirrored = mirrorPath(local);
    if (files.has(mirrored)) return mirrored;
    if (!existsSync(local) || !statSync(local).isFile()) {
      problems.push({ code: "missing-file", message: `${where}: ${local} is not a file`, path: where });
      return null;
    }
    const actual = await sha256FileCached(local);
    if (actual !== hash) {
      problems.push({ code: "hash-mismatch", message: `${where}: ${local} is ${actual}, expected ${hash}`, path: where });
      return null;
    }
    files.set(mirrored, { local, entry: { path: mirrored, size: statSync(local).size, hash } });
    return mirrored;
  };

  for (const [id, asset] of Object.entries(timeline.assets ?? {})) {
    const where = `$.assets[${JSON.stringify(id)}]`;
    if (typeof asset.path !== "string" || typeof asset.hash !== "string") continue; // the engine's validation reports it
    const local = path.resolve(assetRoot, asset.path);
    if ((await add(local, asset.hash, where)) !== null) asset.path = enginePath(assetRootMirror, asset.path, local);
  }

  const kits = [];
  for (const kit of options.kits ?? []) {
    const mirrored = await add(path.resolve(kit.file), kit.hash, `kit ${kit.name}@${kit.version}`);
    if (mirrored !== null) kits.push({ ...kit, file: mirrored });
  }

  if (problems.length > 0) {
    throw new RenderWorkerError(problems[0]!.code, `files are not what the render expects: ${problems.map((p) => p.message).join("; ")}`, problems);
  }

  const job: RenderJob = {
    version: PROTOCOL_VERSION,
    timeline,
    assetRoot: assetRootMirror,
    sharedRoots: (options.sharedRoots ?? []).map((r) => mirrorPath(path.resolve(r))),
    kits,
    ...(options.loudness ? { loudness: options.loudness } : {}),
  };
  return { job, files: [...files.values()] };
}
