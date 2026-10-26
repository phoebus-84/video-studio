// A renderer with renderTimeline's shape that renders on an engine: find the
// engine, give it this commit, send the files it does not have yet, render
// there into the episode's own cache, and bring the mp4 back to outputPath.
// What happens before and after the render (checks, naming, audit, state)
// stays with the caller, exactly as with a local render.

import { createReadStream, createWriteStream, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import type { RenderResult, RenderTimelineOptions } from "@av/remotion-composer";
import { localGit, renderCommit, syncCode, type Git } from "./code-sync.js";
import { sha256File, prepareJob } from "./files.js";
import { engineCommand, findEngine, readHostsConfig, type EngineTarget, type HostsConfig, type TailscalePeer } from "./hosts.js";
import { checkKey, encodeBundle, lastJsonLine, RenderWorkerError, type EngineVersion } from "./protocol.js";
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

const DEFAULT_REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

export function remoteRenderer(options: RemoteRendererOptions): (render: RenderTimelineOptions) => Promise<RemoteRenderResult> {
  const key = checkKey(options.key);
  const exec = options.exec ?? sshExec();
  const log = options.onLog ?? (() => undefined);
  const signal = options.signal;
  const withSignal = signal ? { signal } : {};

  return async (render) => {
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

    const prepared = await prepareJob(render);
    const manifest = prepared.files.map((f) => f.entry);
    const { missing } = lastJsonLine<{ missing: string[] }>((await call(exec, target, ["diff", key], { stdin: JSON.stringify(manifest), ...withSignal }, "diff")).stdout);
    let sentBytes = 0;
    if (missing.length > 0) {
      const wanted = new Set(missing);
      const sending = prepared.files.filter((f) => wanted.has(f.entry.path));
      sentBytes = sending.reduce((n, f) => n + f.entry.size, 0);
      log(`sending ${sending.length} file(s), ${formatBytes(sentBytes)}, to ${target.name}`);
      await call(exec, target, ["receive", key], {
        stdin: encodeBundle(sending.map((f) => ({ entry: f.entry, read: () => createReadStream(f.local) }))),
        ...withSignal,
      }, "receive");
    }

    const answer = await call(exec, target, ["render", key], {
      stdin: JSON.stringify(prepared.job),
      onStderrLine: (line) => {
        const progress = /^progress (\d+(?:\.\d+)?)$/.exec(line);
        if (progress) render.onProgress?.(Number(progress[1]));
        else if (line.trim()) log(line);
      },
      ...withSignal,
    }, "render");
    const result = lastJsonLine<RenderResult & { engine?: { concurrency?: number; browsers?: number; commit?: string | null } }>(answer.stdout);

    const partial = `${render.outputPath}.download`;
    try {
      await call(exec, target, ["fetch", key], { stdout: createWriteStream(partial), ...withSignal }, "fetch");
      const size = statSync(partial).size;
      const hash = await sha256File(partial);
      if (size !== result.sizeBytes || hash !== result.hash) {
        throw new RenderWorkerError("transfer-failed", `the video came back as ${size} bytes ${hash}, the engine rendered ${result.sizeBytes} bytes ${result.hash}`);
      }
      renameSync(partial, render.outputPath);
    } finally {
      rmSync(partial, { force: true });
    }

    const { engine, ...rendered } = result;
    return {
      ...rendered,
      path: render.outputPath,
      engine: {
        host: target.name,
        commit: engine?.commit ?? sha,
        ...(engine?.concurrency !== undefined ? { concurrency: engine.concurrency } : {}),
        ...(engine?.browsers !== undefined ? { browsers: engine.browsers } : {}),
        sentFiles: missing.length,
        sentBytes,
      },
    };
  };
}

function warnMismatches(version: EngineVersion | null, log: (line: string) => void): void {
  for (const m of version?.mismatches ?? []) log(`warning: ${m}`);
}

/** One engine command; a failure becomes the engine's own error when it sent one. */
async function call(exec: Exec, target: EngineTarget, args: string[], input: Parameters<Exec>[2], what: string): Promise<ExecResult> {
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

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MiB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}
