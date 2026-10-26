// The engine's side of protocol.ts. Every command works in one episode's
// folder under the cache root, <cache>/<channel>/<series>/<episode>:
//
//   files/         the job's files, mirrored by their path on the controlling machine
//   index.json     {path: {size, mtimeMs, hash}} — what files/ holds, so `diff` need not rehash
//   cache/         the composer's render cache (renderTimeline's cacheDir)
//   render.lock    held by the running render (its pid)
//   out.mp4        the last render, for `fetch`
//
// Nothing is shared between episodes and nothing is removed.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { finished } from "node:stream/promises";
import type { Writable } from "node:stream";
import type { RenderResult, RenderTimelineOptions } from "@av/remotion-composer";
import { defaultRenderConcurrency, renderBrowsers } from "./concurrency.js";
import { sha256File } from "./files.js";
import {
  checkJobPath, checkKey, decodeBundle, PROTOCOL_VERSION, RenderWorkerError,
  type EngineVersion, type ManifestEntry, type RenderJob,
} from "./protocol.js";

export interface EngineIO {
  stdin: AsyncIterable<Buffer | string>;
  stdout: Writable;
  stderrLine: (line: string) => void;
}

export interface EngineContext {
  /** The engine's clone. */
  repo: string;
  /** The cache root; episodes live under <cache>/<key>. */
  cache: string;
  version?: () => Promise<EngineVersion>;
  sync?: (sha: string, log: (line: string) => void) => Promise<void>;
  render?: (options: RenderTimelineOptions) => Promise<RenderResult>;
  concurrency?: () => { concurrency: number; browsers: number };
}

export function defaultCacheRoot(env: Record<string, string | undefined> = process.env): string {
  return path.join(env.XDG_CACHE_HOME || path.join(homedir(), ".cache"), "video-studio", "render");
}

/** Runs one command; its exit code. A failure's last stdout line is {"error":{code,message,problems}}. */
export async function runEngine(argv: readonly string[], io: EngineIO, ctx: EngineContext): Promise<number> {
  const [command, ...args] = argv;
  try {
    switch (command) {
      case "version":
        return answer(io, await (ctx.version ?? (() => engineVersion(ctx.repo)))());
      case "sync": {
        const sha = args[0];
        if (!sha || !/^[0-9a-f]{40}$/.test(sha)) throw new RenderWorkerError("bad-request", "sync takes a full commit sha");
        await (ctx.sync ?? ((s, log) => syncEngine(ctx.repo, s, log)))(sha, io.stderrLine);
        return answer(io, { synced: sha });
      }
      case "diff":
        return answer(io, await diff(jobDir(ctx, args[0]), io.stdin));
      case "receive":
        return answer(io, await receive(jobDir(ctx, args[0]), io.stdin));
      case "render":
        return answer(io, await render(jobDir(ctx, args[0]), io, ctx));
      case "fetch": {
        const out = path.join(jobDir(ctx, args[0]), "out.mp4");
        if (!existsSync(out)) throw new RenderWorkerError("missing-file", "nothing has been rendered for this episode");
        await pipeline(createReadStream(out), io.stdout, { end: false });
        return 0;
      }
      default:
        throw new RenderWorkerError("bad-request", `unknown command "${command ?? ""}"; commands: version, sync, diff, receive, render, fetch`);
    }
  } catch (e) {
    const error = e as { code?: unknown; message?: unknown; problems?: unknown };
    const code = typeof error.code === "string" ? error.code : "engine-failed";
    const message = typeof error.message === "string" ? error.message : String(e);
    io.stderrLine(`error ${code}: ${message}`);
    io.stdout.write(`${JSON.stringify({ error: { code, message, ...(Array.isArray(error.problems) ? { problems: error.problems } : {}) } })}\n`);
    return 1;
  }
}

function answer(io: EngineIO, value: unknown): number {
  io.stdout.write(`${JSON.stringify(value)}\n`);
  return 0;
}

function jobDir(ctx: EngineContext, key: string | undefined): string {
  const dir = path.join(ctx.cache, ...checkKey(key ?? "").split("/"));
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function readAll(input: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of input) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString("utf-8");
}

function parseJson<T>(text: string, what: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new RenderWorkerError("bad-request", `${what} is not JSON`);
  }
}

// ── files ──────────────────────────────────────────────────────────────────

type Index = Record<string, { size: number; mtimeMs: number; hash: string }>;

function readIndex(dir: string): Index {
  const file = path.join(dir, "index.json");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as Index;
  } catch {
    return {};
  }
}

function writeIndex(dir: string, index: Index): void {
  const file = path.join(dir, "index.json");
  writeFileSync(`${file}.tmp`, JSON.stringify(index));
  renameSync(`${file}.tmp`, file);
}

async function diff(dir: string, stdin: EngineIO["stdin"]): Promise<{ missing: string[] }> {
  const manifest = parseJson<ManifestEntry[]>(await readAll(stdin), "the manifest");
  if (!Array.isArray(manifest)) throw new RenderWorkerError("bad-request", "the manifest is not a list");
  const index = readIndex(dir);
  const missing: string[] = [];
  let changed = false;
  for (const entry of manifest) {
    const rel = checkJobPath(entry.path);
    const file = path.join(dir, ...rel.split("/"));
    if (!existsSync(file)) {
      missing.push(rel);
      continue;
    }
    const stat = statSync(file);
    const known = index[rel];
    if (stat.size !== entry.size) {
      missing.push(rel);
    } else if (known && known.size === stat.size && known.mtimeMs === stat.mtimeMs && known.hash === entry.hash) {
      continue;
    } else {
      const hash = await sha256File(file);
      index[rel] = { size: stat.size, mtimeMs: stat.mtimeMs, hash };
      changed = true;
      if (hash !== entry.hash) missing.push(rel);
    }
  }
  if (changed) writeIndex(dir, index);
  return { missing };
}

async function receive(dir: string, stdin: EngineIO["stdin"]): Promise<{ received: number; bytes: number }> {
  const index = readIndex(dir);
  let bytes = 0;
  let sink: { out: Writable; hash: ReturnType<typeof createHash>; part: string; file: string } | null = null;
  try {
    const received = await decodeBundle(stdin, {
      start(entry) {
        const file = path.join(dir, ...entry.path.split("/"));
        mkdirSync(path.dirname(file), { recursive: true });
        const part = `${file}.part`;
        sink = { out: createWriteStream(part), hash: createHash("sha256"), part, file };
      },
      async data(chunk) {
        sink!.hash.update(chunk);
        bytes += chunk.length;
        if (!sink!.out.write(chunk)) await new Promise((r) => sink!.out.once("drain", r));
      },
      async end(entry) {
        const s = sink!;
        sink = null;
        s.out.end();
        await finished(s.out);
        const hash = `sha256:${s.hash.digest("hex")}`;
        if (hash !== entry.hash) {
          rmSync(s.part, { force: true });
          throw new RenderWorkerError("hash-mismatch", `${entry.path} arrived as ${hash}, not ${entry.hash}`);
        }
        renameSync(s.part, s.file);
        index[entry.path] = { size: entry.size, mtimeMs: statSync(s.file).mtimeMs, hash };
      },
    });
    return { received, bytes };
  } finally {
    const open = sink as { out: Writable; part: string } | null;
    if (open) {
      open.out.destroy();
      rmSync(open.part, { force: true });
    }
    writeIndex(dir, index);
  }
}

// ── render ─────────────────────────────────────────────────────────────────

async function lock(dir: string): Promise<() => void> {
  const file = path.join(dir, "render.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(file, "wx");
      await handle.writeFile(String(process.pid));
      await handle.close();
      return () => rmSync(file, { force: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const pid = Number(readFileSync(file, "utf-8").trim());
      if (Number.isInteger(pid) && pid > 0 && alive(pid)) {
        throw new RenderWorkerError("engine-busy", `this episode is already rendering on the engine (pid ${pid})`);
      }
      rmSync(file, { force: true }); // left by a render that died
    }
  }
  throw new RenderWorkerError("engine-busy", "could not take the episode's render lock");
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function render(dir: string, io: EngineIO, ctx: EngineContext): Promise<unknown> {
  const job = parseJson<RenderJob>(await readAll(io.stdin), "the job");
  if (job?.version !== PROTOCOL_VERSION) throw new RenderWorkerError("bad-request", `the job is protocol ${String(job?.version)}, this engine speaks ${PROTOCOL_VERSION}`);
  const local = (rel: string) => path.join(dir, ...checkJobPath(rel).split("/"));
  const release = await lock(dir);
  try {
    const partial = path.join(dir, "out.partial.mp4");
    const out = path.join(dir, "out.mp4");
    rmSync(partial, { force: true });
    const { concurrency, browsers } = (ctx.concurrency ?? defaultConcurrency)();
    let last = -1;
    let lastAt = 0;
    const result = await (ctx.render ?? composerRender(ctx.repo))({
      timeline: job.timeline,
      assetRoot: local(job.assetRoot),
      sharedRoots: job.sharedRoots.map(local),
      kits: job.kits.map((k) => ({ ...k, file: local(k.file) })),
      cacheDir: path.join(dir, "cache"),
      outputPath: partial,
      concurrency,
      browsers,
      ...(job.loudness ? { loudness: job.loudness } : {}),
      onProgress: (p) => {
        const now = Date.now();
        if (p >= 1 || p - last >= 0.01 || now - lastAt >= 2000) {
          last = p;
          lastAt = now;
          io.stderrLine(`progress ${p.toFixed(3)}`);
        }
      },
    });
    renameSync(partial, out);
    return { ...result, path: "out.mp4", engine: { concurrency, browsers, commit: gitHead(ctx.repo) } };
  } finally {
    release();
  }
}

function defaultConcurrency(): { concurrency: number; browsers: number } {
  const concurrency = defaultRenderConcurrency();
  return { concurrency, browsers: renderBrowsers({ concurrency, env: process.env }) };
}

/** The composer's renderTimeline, run from its package folder (Remotion finds its browser from the working directory). */
function composerRender(repo: string): (options: RenderTimelineOptions) => Promise<RenderResult> {
  return async (options) => {
    process.chdir(path.join(repo, "packages", "remotion-composer"));
    const { renderTimeline } = await import("@av/remotion-composer");
    return renderTimeline(options);
  };
}

// ── version and sync ───────────────────────────────────────────────────────

function gitHead(repo: string): string | null {
  const run = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf-8" });
  return run.status === 0 ? run.stdout.trim() : null;
}

/** engine.env's KEY=VALUE pins. */
export function readPins(repo: string): Record<string, string> {
  const file = path.join(repo, "packages", "render-worker", "engine.env");
  const pins: Record<string, string> = {};
  if (!existsSync(file)) return pins;
  for (const line of readFileSync(file, "utf-8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) pins[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
  }
  return pins;
}

/** Which installed binaries differ from engine.env's pins. */
export function pinMismatches(pins: Record<string, string>, found: { node: string; ffmpeg: string | null; bun: string | null }): string[] {
  const out: string[] = [];
  if (pins.NODE_VERSION && found.node !== `v${pins.NODE_VERSION}`) out.push(`node is ${found.node}, engine.env pins v${pins.NODE_VERSION}`);
  const ffmpeg = pins.FFMPEG_FILE ? /^ffmpeg-(.+?)-linux/.exec(pins.FFMPEG_FILE)?.[1] : undefined;
  if (ffmpeg && !(found.ffmpeg ?? "").includes(ffmpeg)) out.push(`ffmpeg is "${found.ffmpeg ?? "missing"}", engine.env pins ${ffmpeg}`);
  if (pins.BUN_VERSION && found.bun !== pins.BUN_VERSION) out.push(`bun is ${found.bun ?? "missing"}, engine.env pins ${pins.BUN_VERSION}`);
  return out;
}

function bunProgram(repo: string): string {
  const pinned = readPins(repo).BUN_VERSION;
  const file = pinned ? path.join(repo, ".engine", `bun-v${pinned}`, "bun") : "";
  return file && existsSync(file) ? file : "bun";
}

function firstLine(program: string, args: string[], cwd?: string): string | null {
  const run = spawnSync(program, args, { encoding: "utf-8", ...(cwd ? { cwd } : {}) });
  return run.status === 0 ? (run.stdout.split("\n")[0] ?? "").trim() || null : null;
}

export async function engineVersion(repo: string): Promise<EngineVersion> {
  const composer = path.join(repo, "packages", "remotion-composer");
  let remotion: string | null = null;
  try {
    const require = createRequire(path.join(composer, "package.json"));
    remotion = (JSON.parse(readFileSync(require.resolve("@remotion/renderer/package.json"), "utf-8")) as { version: string }).version;
  } catch {
    remotion = null;
  }
  const syncedFile = path.join(repo, ".engine", "synced");
  const found = {
    node: process.version,
    ffmpeg: firstLine(process.env.FFMPEG_PATH || "ffmpeg", ["-version"]),
    bun: firstLine(bunProgram(repo), ["--version"]),
  };
  return {
    commit: gitHead(repo),
    synced: existsSync(syncedFile) ? readFileSync(syncedFile, "utf-8").trim() || null : null,
    ...found,
    remotion,
    browser: existsSync(path.join(composer, "node_modules", ".remotion")),
    mismatches: pinMismatches(readPins(repo), found),
  };
}

/**
 * After `git checkout <sha>`: install when the dependencies changed (the
 * root's postinstall builds the dist/ packages), else rebuild the composer
 * when its sources changed. Children write to stderr; stdout stays the answer.
 */
export async function syncEngine(repo: string, sha: string, log: (line: string) => void): Promise<void> {
  const head = gitHead(repo);
  if (head !== sha) throw new RenderWorkerError("code-sync-failed", `the clone is at ${head ?? "no commit"}, not ${sha}`);
  const syncedFile = path.join(repo, ".engine", "synced");
  const previous = existsSync(syncedFile) ? readFileSync(syncedFile, "utf-8").trim() : "";
  let changed: string[] | null = null;
  if (previous) {
    const run = spawnSync("git", ["diff", "--name-only", previous, sha], { cwd: repo, encoding: "utf-8" });
    if (run.status === 0) changed = run.stdout.split("\n").filter(Boolean);
  }
  const composer = path.join(repo, "packages", "remotion-composer");
  const run = (program: string, args: string[], cwd: string) => {
    log(`$ ${path.basename(program)} ${args.join(" ")}`);
    const r = spawnSync(program, args, { cwd, stdio: ["ignore", 2, 2] });
    if (r.status !== 0) throw new RenderWorkerError("code-sync-failed", `${path.basename(program)} ${args.join(" ")} failed (${r.error?.message ?? `exit ${r.status}`})`);
  };
  const install = changed === null
    || !existsSync(path.join(repo, "node_modules"))
    || changed.some((f) => f === "bun.lock" || f === "package.json" || f.endsWith("/package.json"));
  if (install) run(bunProgram(repo), ["install", "--frozen-lockfile"], repo);
  else if (changed!.some((f) => f.startsWith("packages/remotion-composer/")) || !existsSync(path.join(composer, "dist", "index.js"))) {
    run("npm", ["run", "--silent", "build"], composer);
  }
  mkdirSync(path.dirname(syncedFile), { recursive: true });
  writeFileSync(syncedFile, `${sha}\n`);
}
