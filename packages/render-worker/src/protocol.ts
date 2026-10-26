// What the controlling machine and an engine say to each other. Every exchange
// is one SSH command: arguments on the command line, a request on stdin, an
// answer on stdout, progress and logs on stderr, one line at a time.
//
//   version            → {"commit","synced","node","ffmpeg","bun","remotion","browser","mismatches"}
//   sync <sha>         ← (run after `git checkout <sha>`) installs and builds what changed
//   diff <key>         ← manifest [{path,size,hash}]   → {"missing":[path…]}
//   receive <key>      ← bundle of the missing files   → {"received":n,"bytes":n}
//   render <key>       ← job                           → RenderResult (last stdout line); stderr "progress 0.42"
//   fetch <key>        → the rendered mp4's bytes
//   send-drawn <key>   ← [index…]                      → bundle of drawn/segment-<i>.mp4
//   receive-drawn <key> ← bundle of drawn/segment-<i>.mp4 → {"received":n,"bytes":n}
//
// A shared render (shared.ts) splits a video's one-second segments among
// engines: a job with `drawOnly` draws its share into the job's drawn/ and
// answers with their hashes; the assembling engine's job lists in `drawn` every
// segment in its drawn/: its own share and those receive-drawn put there.
//
// Files are named by where they are on the controlling machine: an absolute
// path mirrored under the job's files/ (F:\a\b → files/F/a/b, /a/b →
// files/a/b), so relative paths between them, ".." included, mean on the
// engine what they meant here.

import type { LibraryKit, LoudnessTarget } from "@av/remotion-composer";

export const PROTOCOL_VERSION = 1;

export class RenderWorkerError extends Error {
  constructor(
    public readonly code: RenderWorkerErrorCode | (string & {}),
    message: string,
    /** The composer's own problems, when the engine's render refused the timeline. */
    public readonly problems?: { code: string; message: string; path?: string }[],
  ) {
    super(message);
    this.name = "RenderWorkerError";
  }
}

export type RenderWorkerErrorCode =
  | "bad-key"
  | "bad-path"
  | "bad-request"
  | "no-engine"
  | "dirty-code"
  | "code-sync-failed"
  | "hash-mismatch"
  | "missing-file"
  | "engine-busy"
  | "engine-failed"
  | "transfer-failed";

/** One file the job needs: where it is mirrored, how big, what it hashes to ("sha256:…"). */
export interface ManifestEntry {
  path: string;
  size: number;
  hash: string;
}

/** What `render` reads on stdin. Paths are relative to the engine's job directory. */
export interface RenderJob {
  version: typeof PROTOCOL_VERSION;
  timeline: unknown;
  assetRoot: string;
  sharedRoots: string[];
  kits: LibraryKit[];
  loudness?: LoudnessTarget;
  /** A shared render's share: draw only these segments into drawn/, no video. */
  drawOnly?: { segments: number[]; audio?: boolean };
  /** A shared render's assembly: every segment in drawn/, by index → hash. */
  drawn?: Record<string, string>;
}

/** What a `drawOnly` render answers. */
export interface DrawAnswer {
  segments: { index: number; hash: string; bytes: number }[];
  totalSegments: number;
  engine?: { concurrency?: number; browsers?: number; commit?: string | null };
}

export const drawnPath = (index: number): string => `drawn/segment-${index}.mp4`;

/** What `version` answers. `mismatches` lists binaries that differ from engine.env's pins. */
export interface EngineVersion {
  commit: string | null;
  /** The commit whose dependencies and build are installed (`sync` writes it). */
  synced: string | null;
  node: string;
  ffmpeg: string | null;
  bun: string | null;
  remotion: string | null;
  browser: boolean;
  mismatches: string[];
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** An episode's key on the engine: `<channel>/<series>/<episode>`, plain names only. */
export function checkKey(key: string): string {
  const parts = key.split("/");
  if (parts.length !== 3 || !parts.every((p) => SEGMENT.test(p) && !p.includes(".."))) {
    throw new RenderWorkerError("bad-key", `"${key}" is not <channel>/<series>/<episode>`);
  }
  return key;
}

/** Where an absolute local path is mirrored, relative to the job's files/ folder. */
export function mirrorPath(absolute: string): string {
  const drive = /^([A-Za-z]):[\\/]/.exec(absolute);
  let rest: string;
  if (drive) rest = `${drive[1]!.toUpperCase()}/${absolute.slice(3)}`;
  else if (/^[\\/]{2}[^\\/]/.test(absolute)) rest = `unc/${absolute.slice(2)}`;
  else if (absolute.startsWith("/")) rest = absolute.slice(1);
  else throw new RenderWorkerError("bad-path", `${absolute} is not an absolute path`);
  const parts = rest.split(/[\\/]+/).filter((p) => p !== "" && p !== ".");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else out.push(p);
  }
  return ["files", ...out].join("/");
}

/** A manifest path the engine may write: under files/ (or `root`), no "..", no absolute part. */
export function checkJobPath(path: string, root = "files"): string {
  const parts = path.split("/");
  if (parts[0] !== root || parts.length < 2 || parts.some((p) => p === "" || p === "." || p === ".." || p.includes("\\") || p.includes("\0"))) {
    throw new RenderWorkerError("bad-path", `"${path}" is not a path under ${root}/`);
  }
  return path;
}

// ── The bundle: the files `receive` reads ──────────────────────────────────
// Repeated: one JSON header line {"path","size","hash"}, then exactly `size`
// raw bytes. Plain enough to write from any OS without tar.

export async function* encodeBundle(
  files: readonly { entry: ManifestEntry; read: () => AsyncIterable<Buffer | string> }[],
): AsyncGenerator<Buffer> {
  for (const { entry, read } of files) {
    yield Buffer.from(`${JSON.stringify(entry)}\n`);
    let sent = 0;
    for await (const chunk of read()) {
      const b = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      sent += b.length;
      if (sent > entry.size) throw new RenderWorkerError("transfer-failed", `${entry.path} grew while it was being sent`);
      yield b;
    }
    if (sent !== entry.size) throw new RenderWorkerError("transfer-failed", `${entry.path} changed size while it was being sent`);
  }
}

export interface BundleSink {
  start(entry: ManifestEntry): Promise<void> | void;
  data(chunk: Buffer): Promise<void> | void;
  end(entry: ManifestEntry): Promise<void> | void;
}

export async function decodeBundle(input: AsyncIterable<Buffer | string>, sink: BundleSink, root = "files"): Promise<number> {
  let pending = Buffer.alloc(0);
  let current: ManifestEntry | null = null;
  let left = 0;
  let count = 0;
  const finish = async () => {
    await sink.end(current!);
    current = null;
    count++;
  };
  for await (const raw of input) {
    let chunk = typeof raw === "string" ? Buffer.from(raw) : raw;
    while (chunk.length > 0) {
      if (current) {
        const take = Math.min(left, chunk.length);
        if (take > 0) await sink.data(chunk.subarray(0, take));
        left -= take;
        chunk = chunk.subarray(take);
        if (left === 0) await finish();
        continue;
      }
      const nl = chunk.indexOf(10);
      if (nl < 0) {
        pending = Buffer.concat([pending, chunk]);
        if (pending.length > 64 * 1024) throw new RenderWorkerError("bad-request", "bundle header too long");
        break;
      }
      const header = Buffer.concat([pending, chunk.subarray(0, nl)]).toString("utf-8");
      pending = Buffer.alloc(0);
      chunk = chunk.subarray(nl + 1);
      current = parseEntry(header, root);
      left = current.size;
      await sink.start(current);
      if (left === 0) await finish();
    }
  }
  if (current || pending.length > 0) throw new RenderWorkerError("transfer-failed", "the bundle ended in the middle of a file");
  return count;
}

export function parseEntry(text: string, root = "files"): ManifestEntry {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new RenderWorkerError("bad-request", "a bundle header is not JSON");
  }
  const e = value as Partial<ManifestEntry>;
  if (typeof e.path !== "string" || typeof e.hash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(e.hash)
    || typeof e.size !== "number" || !Number.isSafeInteger(e.size) || e.size < 0) {
    throw new RenderWorkerError("bad-request", `not a manifest entry: ${text.slice(0, 200)}`);
  }
  return { path: checkJobPath(e.path, root), size: e.size, hash: e.hash };
}

/** The last non-empty line of an engine's stdout, as JSON. */
export function lastJsonLine<T>(stdout: string): T {
  const line = stdout.trimEnd().split("\n").pop() ?? "";
  try {
    return JSON.parse(line) as T;
  } catch {
    throw new RenderWorkerError("engine-failed", `the engine did not answer with JSON: ${line.slice(0, 300)}`);
  }
}
