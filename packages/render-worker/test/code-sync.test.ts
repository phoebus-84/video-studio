import assert from "node:assert/strict";
import { test } from "node:test";
import { gitRemote, INCOMING_REF, localGit, RENDER_CODE, renderCommit, syncCode, type Git } from "../src/code-sync.js";
import type { ExecInput } from "../src/ssh.js";

const SHA = "a".repeat(40);

function fakeGit(status: string, push = { code: 0, stderr: "" }): Git & { calls: { args: readonly string[]; env?: Record<string, string> }[] } {
  const calls: { args: readonly string[]; env?: Record<string, string> }[] = [];
  const git = ((args: readonly string[], options: { env?: Record<string, string> } = {}) => {
    calls.push({ args, ...(options.env ? { env: options.env } : {}) });
    if (args[0] === "rev-parse") return { code: 0, stdout: `${SHA}\n`, stderr: "" };
    if (args[0] === "status") return { code: 0, stdout: status, stderr: "" };
    if (args[0] === "push") return { code: push.code, stdout: "", stderr: push.stderr };
    return { code: 1, stdout: "", stderr: "unexpected" };
  }) as Git & { calls: typeof calls };
  git.calls = calls;
  return git;
}

test("the render commit is HEAD, checked only over the code that renders", async () => {
  const git = fakeGit("");
  assert.equal(await renderCommit(git), SHA);
  assert.deepEqual(git.calls[1]!.args, ["status", "--porcelain", "--untracked-files=all", "--", ...RENDER_CODE]);
});

test("uncommitted render code stops the render and names the files", async () => {
  const git = fakeGit(" M packages/remotion-composer/src/render.ts\nM  bun.lock\n");
  await assert.rejects(renderCommit(git), (e: Error & { code?: string }) => e.code === "dirty-code" && /render\.ts/.test(e.message) && /bun\.lock/.test(e.message));
});

test("a clone path becomes an ssh remote, ~ kept for the remote side", () => {
  assert.equal(gitRemote({ name: "x", destination: "someone@100.64.0.9", repo: "~/clone" }), "ssh://someone@100.64.0.9/~/clone");
  assert.equal(gitRemote({ name: "x", destination: "box", repo: "/srv/clone" }), "ssh://box/srv/clone");
});

test("a synced engine gets nothing; another is pushed the commit, checks it out and syncs", async () => {
  const target = { name: "render-box", destination: "someone@100.64.0.9", repo: "~/clone" };
  const commands: string[] = [];
  const exec = async (_d: string, command: string, _i?: ExecInput) => {
    commands.push(command);
    return { code: 0, stdout: "", stderr: "" };
  };
  const git = fakeGit("");
  assert.equal(await syncCode({ git, exec, target, sha: SHA, synced: SHA }), false);
  assert.equal(git.calls.length, 0);

  assert.equal(await syncCode({ git, exec, target, sha: SHA, synced: null, sshProgram: "my-ssh" }), true);
  assert.deepEqual(git.calls[0]!.args, ["push", "--quiet", "ssh://someone@100.64.0.9/~/clone", `+${SHA}:${INCOMING_REF}`]);
  assert.match(git.calls[0]!.env!.GIT_SSH_COMMAND!, /^my-ssh -o BatchMode=yes/);
  assert.equal(commands[0], `cd ~/clone && git checkout --quiet --force -B engine ${SHA} && ~/clone/packages/render-worker/engine.sh sync ${SHA}`);
});

test("a refused push stops before anything runs on the engine", async () => {
  let ran = false;
  const exec = async () => {
    ran = true;
    return { code: 0, stdout: "", stderr: "" };
  };
  await assert.rejects(
    syncCode({ git: fakeGit("", { code: 1, stderr: "permission denied" }), exec, target: { name: "b", destination: "b", repo: "~/c" }, sha: SHA, synced: null }),
    { code: "code-sync-failed" },
  );
  assert.equal(ran, false);
});

test("local git runs beside the event loop, which goes on while it runs", async () => {
  let ticked = false;
  setImmediate(() => (ticked = true));
  const run = await localGit(process.cwd())(["rev-parse", "--is-inside-work-tree"]);
  assert.equal(run.code, 0);
  assert.equal(run.stdout.trim(), "true");
  assert.equal(ticked, true);
});
