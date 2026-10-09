// ---------------------------------------------------------------------------
// `vpr channel init` and `vpr channel media` (avg-d1x phase 5): a channel as
// its own repository, its media named by hash. Spawns the compiled CLI.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/src/cli.js");
const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

function vpr(root: string, args: string[]) {
  const result = spawnSync("node", [cliPath, "channel", ...args, "--library", root, "--json"], {
    encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid" },
  });
  return { status: result.status ?? 1, json: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
}

describe("vpr channel", { timeout: 30_000 }, () => {
  it("makes a channel its own repository, then checks this machine's media against its lock", () => {
    const root = mkdtempSync(path.join(tmpdir(), "cli-channel-"));
    roots.push(root);
    const images = path.join(root, "sample", "series", "poetry", "episodes", "morning", "assets", "images");
    mkdirSync(images, { recursive: true });
    writeFileSync(path.join(root, "sample", "channel.json"), "{}\n");
    writeFileSync(path.join(images, "sea.png"), "a sea");

    const made = vpr(root, ["init", "sample", "--commit"]);
    expect(made.status, made.stderr).toBe(0);
    expect(made.json.media).toEqual({ files: 1, bytes: 5, absent: 0, pruned: 0 });
    expect(made.json.notIgnored).toEqual([]);
    expect(execFileSync("git", ["-C", path.join(root, "sample"), "ls-files"], { encoding: "utf-8" })).not.toContain("sea.png");

    expect(vpr(root, ["media", "sample", "--check"]).status).toBe(0);
    rmSync(path.join(images, "sea.png"));
    const lacking = vpr(root, ["media", "sample", "--check"]);
    expect([lacking.status, lacking.json.missing]).toEqual([2, ["series/poetry/episodes/morning/assets/images/sea.png"]]);

    // A file this machine lacks stays named; only --prune forgets it.
    expect(vpr(root, ["media", "sample"]).json).toMatchObject({ files: 1, absent: 1, pruned: 0 });
    expect(vpr(root, ["media", "sample", "--prune"]).json).toMatchObject({ files: 0, pruned: 1 });
    expect(vpr(root, ["media", "sample", "--check", "--verify"]).status).toBe(0);
  });

  it("refuses a channel that is not there, and a bad command", () => {
    const root = mkdtempSync(path.join(tmpdir(), "cli-channel-"));
    roots.push(root);
    expect(vpr(root, ["init", "nowhere"]).status).toBe(2);
    expect(vpr(root, ["init", "../x"]).status).toBe(1);
    expect(vpr(root, ["push", "sample"]).status).toBe(1);
  });
});
