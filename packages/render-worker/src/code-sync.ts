// The engine renders with the code this machine would: the same commit. The
// commit is pushed to the engine's clone over SSH (git's own transfer, so only
// what is new travels), checked out there, and `engine.sh sync` installs and
// builds what that commit changed. Uncommitted changes to the code that
// renders cannot travel this way, so they stop the render instead of being
// silently left out.

import { spawnSync } from "node:child_process";
import { RenderWorkerError } from "./protocol.js";
import { shellPath, shellQuote, type Exec } from "./ssh.js";
import { engineCommand, type EngineTarget } from "./hosts.js";

/** What decides the rendered pixels and how the engine runs: changes here must be committed first. */
export const RENDER_CODE = ["packages/remotion-composer", "packages/render-worker", "package.json", "bun.lock"];

/** Where the pushed commit lands on the engine before it is checked out. */
export const INCOMING_REF = "refs/render-worker/incoming";

export interface Git {
  (args: readonly string[], options?: { env?: Record<string, string> }): { code: number; stdout: string; stderr: string };
}

export function localGit(repoRoot: string): Git {
  return (args, options = {}) => {
    const run = spawnSync("git", args, {
      cwd: repoRoot,
      encoding: "utf-8",
      windowsHide: true,
      env: { ...process.env, ...options.env },
    });
    if (run.error) throw new RenderWorkerError("code-sync-failed", `git could not run: ${run.error.message}`);
    return { code: run.status ?? 1, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
  };
}

/** The commit to render with; refuses when the render code has uncommitted changes. */
export function renderCommit(git: Git): string {
  const head = git(["rev-parse", "HEAD"]);
  if (head.code !== 0) throw new RenderWorkerError("code-sync-failed", `not a git checkout: ${head.stderr.trim()}`);
  const status = git(["status", "--porcelain", "--untracked-files=all", "--", ...RENDER_CODE]);
  if (status.code !== 0) throw new RenderWorkerError("code-sync-failed", `git status failed: ${status.stderr.trim()}`);
  const dirty = status.stdout.split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
  if (dirty.length > 0) {
    throw new RenderWorkerError(
      "dirty-code",
      `the engine renders committed code only, and ${dirty.length} file(s) that shape the render are not committed: ${dirty.slice(0, 8).join(", ")}${dirty.length > 8 ? ", …" : ""}. Commit them (a local branch is enough), or render here.`,
    );
  }
  return head.stdout.trim();
}

/** The engine's clone as a git remote: ssh://[user@]address/<path>, "~/…" kept for the remote shell. */
export function gitRemote(target: EngineTarget): string {
  const repo = target.repo.startsWith("~/") ? `~/${target.repo.slice(2)}` : target.repo;
  return `ssh://${target.destination}${repo.startsWith("/") ? "" : "/"}${repo}`;
}

/**
 * Puts `sha` on the engine, checked out and built. `synced` is what the
 * engine reported it already has; when it matches nothing is sent.
 */
export async function syncCode(options: {
  git: Git;
  exec: Exec;
  target: EngineTarget;
  sha: string;
  synced: string | null;
  sshProgram?: string;
  onLog?: (line: string) => void;
  signal?: AbortSignal;
}): Promise<boolean> {
  const { git, exec, target, sha } = options;
  if (options.synced === sha) return false;
  const ssh = options.sshProgram ?? process.env.AVG_RENDER_SSH ?? "ssh";
  options.onLog?.(`sending commit ${sha.slice(0, 10)} to ${target.name}`);
  const push = git(["push", "--quiet", gitRemote(target), `+${sha}:${INCOMING_REF}`], {
    env: { GIT_SSH_COMMAND: `${ssh} -o BatchMode=yes -o ConnectTimeout=10` },
  });
  if (push.code !== 0) throw new RenderWorkerError("code-sync-failed", `git push to ${target.name} failed: ${push.stderr.trim()}`);
  // The checkout runs before engine.sh, so a clone that predates the engine code still gets it.
  const command = [
    `cd ${shellPath(target.repo)}`,
    `git checkout --quiet --force -B engine ${shellQuote(sha)}`,
    engineCommand(target, ["sync", sha]),
  ].join(" && ");
  const run = await exec(target.destination, command, {
    ...(options.onLog ? { onStderrLine: options.onLog } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (run.code !== 0) throw new RenderWorkerError("code-sync-failed", `${target.name} could not check out and build ${sha.slice(0, 10)}: ${run.stderr.split("\n").slice(-5).join(" | ")}`);
  return true;
}
