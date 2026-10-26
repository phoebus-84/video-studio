// A renderer with renderTimeline's shape that renders on an engine: find the
// engine, give it this commit, send the files it does not have yet, render
// there into the episode's own cache, and bring the mp4 back to outputPath.
// What happens before and after the render (checks, naming, audit, state)
// stays with the caller, exactly as with a local render.

import { createReadStream, createWriteStream, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import type { RenderResult, RenderTimelineOptions } from "@av/remotion-composer";
import { localGit, renderCommit, syncCode, type Git } from "./code-sync.js";
import { sha256File, prepareJob, type JobFile } from "./files.js";
import { engineCommand, findEngine, readHostsConfig, type EngineTarget, type HostsConfig, type TailscalePeer } from "./hosts.js";
import { checkKey, encodeBundle, lastJsonLine, RenderWorkerError, type EngineVersion, type RenderJob } from "./protocol.js";
import { sshExec, type Exec, type ExecResult } from "./ssh.js";

export interface RemoteRendererOptions {
  /** A tailnet peer name (or a render-hosts.json host), or "auto" for the first engine that answers. */
  host: string;
  /** The episode: <channel>/<series>/<episode>; its cache on the engine. */
  key: string;
  /** render-hosts.json; absent or missing means no configuration. */
  configFile?: string;
  config?: HostsConfig;
  /** The clone whose HEAD the engine renders with: the repository this package is in, by default. */
  repoRoot?: string;
  exec?: Exec;
  git?: Git;
  peers?: readonly TailscalePeer[];
  env?: Record<string, string | undefined>;
  onLog?: (line: string) => void;
  signal?: AbortSignal;
}

export interface RemoteRenderResult extends RenderResult {
  engine: { host: string; commit: string | null; concurrency?: number; browsers?: number; sentFiles: number; sentBytes: number };
}

export const DEFAULT_REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

export function remoteRenderer(options: RemoteRendererOptions): (render: RenderTimelineOptions) => Promise<RemoteRenderResult> {
  const key = checkKey(options.key);
  return async (render) => {
    const engine = await openEngine({ ...options, key });
    const prepared = await prepareJob(render);
    const sent = await sendFiles(engine, prepared.files);
    const result = await renderOn<RenderResult & { engine?: EngineAnswer }>(engine, prepared.job, (p) => render.onProgress?.(p));
    await fetchVideo(engine, render.outputPath, result);
    const { engine: answered, ...rendered } = result;
    return { ...rendered, path: render.outputPath, engine: { host: engine.target.name, ...engineFacts(answered, engine.sha), ...sent } };
  };
}

/** What an engine says about itself in a render's answer. */
export interface EngineAnswer { concurrency?: number; browsers?: number; commit?: string | null }

export function engineFacts(answer: EngineAnswer | undefined, sha: string): { commit: string | null; concurrency?: number; browsers?: number } {
  return {
    commit: answer?.commit ?? sha,
    ...(answer?.concurrency !== undefined ? { concurrency: answer.concurrency } : {}),
    ...(answer?.browsers !== undefined ? { browsers: answer.browsers } : {}),
  };
}

/** An engine found and on this commit, ready for one episode's commands. */
export interface EngineSession {
  target: EngineTarget;
  exec: Exec;
  key: string;
  sha: string;
  log: (line: string) => void;
  signal?: AbortSignal;
}

export async function openEngine(options: Omit<RemoteRendererOptions, "key"> & { key: string }): Promise<EngineSession> {
  const exec = options.exec ?? sshExec();
  const log = options.onLog ?? (() => undefined);
  const withSignal = options.signal ? { signal: options.signal } : {};
  const config = options.config ?? readHostsConfig(options.configFile);
  const found = await findEngine(options.host, {
    exec,
    config,
    ...(options.peers ? { peers: options.peers } : {}),
    ...(options.env ? { env: options.env } : {}),
  });
  const target = found.target;
  log(`rendering on ${target.name} (${target.destination})`);
  warnMismatches(found.version, log);

  const git = options.git ?? localGit(options.repoRoot ?? DEFAULT_REPO_ROOT);
  const sha = renderCommit(git);
  const synced = found.version?.synced === sha && found.version.commit === sha ? sha : null;
  if (await syncCode({ git, exec, target, sha, synced, onLog: log, ...withSignal })) {
    const after = lastJsonLine<EngineVersion>((await call(exec, target, ["version"], {}, "version")).stdout);
    warnMismatches(after, log);
    if (!after.browser) log(`${target.name} has no Remotion browser yet; the render will download one`);
  }
  return { target, exec, key: checkKey(options.key), sha, log, ...withSignal };
}

/** Sends the job's files the engine does not have yet. */
export async function sendFiles(engine: EngineSession, files: readonly JobFile[]): Promise<{ sentFiles: number; sentBytes: number }> {
  const { target, exec, key } = engine;
  const withSignal = engine.signal ? { signal: engine.signal } : {};
  const manifest = files.map((f) => f.entry);
  const { missing } = lastJsonLine<{ missing: string[] }>((await call(exec, target, ["diff", key], { stdin: JSON.stringify(manifest), ...withSignal }, "diff")).stdout);
  let sentBytes = 0;
  if (missing.length > 0) {
    const wanted = new Set(missing);
    const sending = files.filter((f) => wanted.has(f.entry.path));
    sentBytes = sending.reduce((n, f) => n + f.entry.size, 0);
    engine.log(`sending ${sending.length} file(s), ${formatBytes(sentBytes)}, to ${target.name}`);
    await call(exec, target, ["receive", key], {
      stdin: encodeBundle(sending.map((f) => ({ entry: f.entry, read: () => createReadStream(f.local) }))),
      ...withSignal,
    }, "receive");
  }
  return { sentFiles: missing.length, sentBytes };
}

/** Runs a job on the engine; its answer is the last stdout line. */
export async function renderOn<T>(engine: EngineSession, job: RenderJob, onProgress: (progress: number) => void): Promise<T> {
  const answer = await call(engine.exec, engine.target, ["render", engine.key], {
    stdin: JSON.stringify(job),
    onStderrLine: (line) => {
      const progress = /^progress (\d+(?:\.\d+)?)$/.exec(line);
      if (progress) onProgress(Number(progress[1]));
      else if (line.trim()) engine.log(line);
    },
    ...(engine.signal ? { signal: engine.signal } : {}),
  }, "render");
  return lastJsonLine<T>(answer.stdout);
}

/** Brings the engine's rendered mp4 to `outputPath`, checked against what it said it rendered. */
export async function fetchVideo(engine: EngineSession, outputPath: string, rendered: { sizeBytes: number; hash: string }): Promise<void> {
  const partial = `${outputPath}.download`;
  try {
    await call(engine.exec, engine.target, ["fetch", engine.key], { stdout: createWriteStream(partial), ...(engine.signal ? { signal: engine.signal } : {}) }, "fetch");
    const size = statSync(partial).size;
    const hash = await sha256File(partial);
    if (size !== rendered.sizeBytes || hash !== rendered.hash) {
      throw new RenderWorkerError("transfer-failed", `the video came back as ${size} bytes ${hash}, the engine rendered ${rendered.sizeBytes} bytes ${rendered.hash}`);
    }
    renameSync(partial, outputPath);
  } finally {
    rmSync(partial, { force: true });
  }
}

function warnMismatches(version: EngineVersion | null, log: (line: string) => void): void {
  for (const m of version?.mismatches ?? []) log(`warning: ${m}`);
}

/** One engine command; a failure becomes the engine's own error when it sent one. */
export async function call(exec: Exec, target: EngineTarget, args: string[], input: Parameters<Exec>[2], what: string): Promise<ExecResult> {
  const run = await exec(target.destination, engineCommand(target, args), input);
  if (run.code === 0) return run;
  let error: { code?: string; message?: string; problems?: { code: string; message: string; path?: string }[] } | undefined;
  try {
    error = (JSON.parse(run.stdout.trimEnd().split("\n").pop() ?? "") as { error?: typeof error }).error;
  } catch {
    error = undefined;
  }
  if (error?.code && error.message) throw new RenderWorkerError(error.code, `${target.name}: ${error.message}`, error.problems);
  throw new RenderWorkerError("engine-failed", `${target.name}: ${what} failed (exit ${run.code}): ${run.stderr.split("\n").filter(Boolean).slice(-5).join(" | ")}`);
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MiB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}
