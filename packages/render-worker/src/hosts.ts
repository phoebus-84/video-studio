// Which machine renders. Nothing about the machines is written in code: they
// are the tailnet's online Linux peers (`tailscale status --json`) that answer
// `engine.sh version` over SSH, and the SSH user, the clone's path and the
// cache's path come from configuration — a render-hosts.json the caller
// names, environment variables, then the user's SSH config and the defaults.
//
// render-hosts.json (every field optional):
//   {
//     "user": "…",                 SSH user for every engine
//     "repo": "~/video-studio",     the engine's clone
//     "cache": "~/.cache/…",        the engine's render cache root
//     "hosts": { "<peer name>": { "address", "user", "repo", "cache" } }
//   }
// Environment, over the file: AVG_RENDER_SSH_USER, AVG_RENDER_ENGINE_REPO,
// AVG_RENDER_ENGINE_CACHE. AVG_TAILSCALE names the tailscale program; else
// `tailscale` on PATH, then where the OS installer puts it (Windows does not
// add it to PATH). "auto" tries only online peers whose OS is Linux.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { lastJsonLine, RenderWorkerError, type EngineVersion } from "./protocol.js";
import { shellPath, SSH_FAILED, type Exec } from "./ssh.js";

export interface HostSettings {
  address?: string;
  user?: string;
  repo?: string;
  cache?: string;
}

export interface HostsConfig extends Omit<HostSettings, "address"> {
  hosts?: Record<string, HostSettings>;
}

/** Where an engine is and how to reach it. */
export interface EngineTarget {
  /** The peer's name, for messages and reports. */
  name: string;
  /** What ssh connects to: [user@]address. */
  destination: string;
  /** The engine's clone, "~/…" allowed. */
  repo: string;
  /** The engine's render cache root; the engine's default when absent. */
  cache?: string;
}

export interface TailscalePeer {
  name: string;
  dnsName: string | null;
  addresses: string[];
  online: boolean;
  os: string | null;
}

export const DEFAULT_REPO = "~/video-studio";

export function readHostsConfig(file: string | undefined): HostsConfig {
  if (!file || !existsSync(file)) return {};
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    throw new RenderWorkerError("bad-request", `${file} is not JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RenderWorkerError("bad-request", `${file} is not an object`);
  return value as HostsConfig;
}

/** The tailnet's peers, from `tailscale status --json`'s output. */
export function parseTailscaleStatus(json: string): TailscalePeer[] {
  const status = JSON.parse(json) as { Peer?: Record<string, Record<string, unknown>> };
  return Object.values(status.Peer ?? {}).map((p) => {
    const dns = typeof p.DNSName === "string" && p.DNSName ? p.DNSName.replace(/\.$/, "") : null;
    const name = typeof p.HostName === "string" && p.HostName ? p.HostName : (dns?.split(".")[0] ?? "");
    const addresses = Array.isArray(p.TailscaleIPs) ? p.TailscaleIPs.filter((a): a is string => typeof a === "string") : [];
    // IPv4 first: the shorter, and what ssh_config entries usually name
    addresses.sort((a, b) => Number(a.includes(":")) - Number(b.includes(":")));
    return { name, dnsName: dns, addresses, online: p.Online === true, os: typeof p.OS === "string" ? p.OS : null };
  }).filter((p) => p.name !== "");
}

type Run = (program: string, args: readonly string[]) => { status: number | null; stdout: string; error?: Error };

const spawnRun: Run = (program, args) => {
  const run = spawnSync(program, args, { encoding: "utf-8", windowsHide: true, timeout: 10_000 });
  return { status: run.status, stdout: run.stdout ?? "", ...(run.error ? { error: run.error } : {}) };
};

/**
 * The tailscale programs to try, in order: AVG_TAILSCALE, `tailscale` on
 * PATH, then the place each OS's installer puts it (Windows' does not add
 * it to PATH).
 */
export function tailscalePrograms(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] {
  if (env.AVG_TAILSCALE) return [env.AVG_TAILSCALE];
  const programs = ["tailscale"];
  if (platform === "win32") {
    for (const root of [env.ProgramFiles, env["ProgramFiles(x86)"], "C:\\Program Files"]) {
      if (root) programs.push(`${root.replace(/[\\/]+$/, "")}\\Tailscale\\tailscale.exe`);
    }
  } else if (platform === "darwin") {
    programs.push("/Applications/Tailscale.app/Contents/MacOS/Tailscale");
  }
  return [...new Set(programs)];
}

/** The tailnet's peers, or none when tailscale is not installed or not up. */
export function tailscalePeers(options: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; run?: Run } = {}): TailscalePeer[] {
  const run = options.run ?? spawnRun;
  for (const program of tailscalePrograms(options.env, options.platform)) {
    const result = run(program, ["status", "--json"]);
    // not there: try the next; there but failing (tailnet down): no peers
    if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") continue;
    if (result.status !== 0 || !result.stdout) return [];
    try {
      return parseTailscaleStatus(result.stdout);
    } catch {
      return [];
    }
  }
  return [];
}

/** Only Linux peers can be engines; a peer whose OS tailscale does not say is tried too. */
export function mayBeEngine(peer: TailscalePeer): boolean {
  return peer.online && (peer.os === null || peer.os.toLowerCase() === "linux");
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function findPeer(peers: readonly TailscalePeer[], name: string): TailscalePeer | undefined {
  return peers.find((p) => same(p.name, name) || (p.dnsName !== null && (same(p.dnsName, name) || same(p.dnsName.split(".")[0]!, name))));
}

/**
 * How to reach `name`: the config's entry for it, then the environment, then
 * the config's defaults; its address from the config, else the peer's
 * tailnet address, else the name itself (for the SSH config to resolve).
 */
export function engineTarget(name: string, options: { config?: HostsConfig; peers?: readonly TailscalePeer[]; env?: Record<string, string | undefined> } = {}): EngineTarget {
  const config = options.config ?? {};
  const env = options.env ?? process.env;
  const own = Object.entries(config.hosts ?? {}).find(([n]) => same(n, name))?.[1] ?? {};
  const peer = findPeer(options.peers ?? [], name);
  const user = own.user ?? env.AVG_RENDER_SSH_USER ?? config.user;
  const address = own.address ?? peer?.addresses[0] ?? name;
  const repo = own.repo ?? env.AVG_RENDER_ENGINE_REPO ?? config.repo ?? DEFAULT_REPO;
  const cache = own.cache ?? env.AVG_RENDER_ENGINE_CACHE ?? config.cache;
  return {
    name: peer?.name ?? name,
    destination: user ? `${user}@${address}` : address,
    repo,
    ...(cache ? { cache } : {}),
  };
}

/** The engine command line: `<repo>/packages/render-worker/engine.sh [--cache <dir>] <args>`. */
export function engineCommand(target: EngineTarget, args: readonly string[]): string {
  return [
    `${shellPath(target.repo)}/packages/render-worker/engine.sh`,
    ...(target.cache ? ["--cache", shellPath(target.cache)] : []),
    ...args.map((a) => shellPath(a)),
  ].join(" ");
}

export type Probe = { ok: true; version: EngineVersion } | { ok: false; reachable: boolean; reason: string };

/** Asks the engine its version. `reachable` is true when SSH connected but the engine did not answer. */
export async function probeEngine(exec: Exec, target: EngineTarget): Promise<Probe> {
  try {
    const run = await exec(target.destination, engineCommand(target, ["version"]));
    if (run.code === 0) return { ok: true, version: lastJsonLine<EngineVersion>(run.stdout) };
    return { ok: false, reachable: run.code !== SSH_FAILED, reason: run.stderr.split("\n").filter(Boolean).pop() ?? `exit ${run.code}` };
  } catch (e) {
    return { ok: false, reachable: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export interface FoundEngine {
  target: EngineTarget;
  /** null when SSH reached a machine whose clone cannot answer yet (no engine code); it will be synced. */
  version: EngineVersion | null;
}

/**
 * The engine `host` names, or with "auto" the first that answers: the
 * config's hosts in their order, then the tailnet's online Linux peers.
 */
export async function findEngine(
  host: string,
  options: { exec: Exec; config?: HostsConfig; peers?: readonly TailscalePeer[]; env?: Record<string, string | undefined> },
): Promise<FoundEngine> {
  const peers = options.peers ?? tailscalePeers(options.env ? { env: options.env as NodeJS.ProcessEnv } : {});
  const settings = { peers, ...(options.config ? { config: options.config } : {}), ...(options.env ? { env: options.env } : {}) };
  if (host !== "auto") {
    const target = engineTarget(host, settings);
    const probe = await probeEngine(options.exec, target);
    if (probe.ok) return { target, version: probe.version };
    if (probe.reachable) return { target, version: null };
    throw new RenderWorkerError("no-engine", `${host} (${target.destination}) did not answer over SSH: ${probe.reason}`);
  }
  const names = [...Object.keys(options.config?.hosts ?? {})];
  for (const p of peers) if (mayBeEngine(p) && !names.some((n) => same(n, p.name))) names.push(p.name);
  if (names.length === 0) throw new RenderWorkerError("no-engine", "no engine to try: no hosts in the render-hosts config and no online Linux tailnet peers");
  const targets = names.map((n) => engineTarget(n, settings));
  const probes = await Promise.all(targets.map((t) => probeEngine(options.exec, t)));
  const index = probes.findIndex((p) => p.ok);
  if (index >= 0) return { target: targets[index]!, version: (probes[index] as { version: EngineVersion }).version };
  throw new RenderWorkerError("no-engine", `no engine answered: ${targets.map((t, i) => `${t.name}: ${(probes[i] as { reason: string }).reason}`).join("; ")}`);
}
