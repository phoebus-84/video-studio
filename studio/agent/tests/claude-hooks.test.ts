/**
 * The Claude Code side of the MCP server: the hooks and the status line read
 * what the server leaves in its state directory. Run as Claude Code runs
 * them — separate processes, JSON on stdout.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SessionState } from "../mcp/state.js";

const AGENT = resolve(__dirname, "..");
const INBOX_HOOK = join(AGENT, "claude", "inbox-hook.mjs");
const STATUSLINE = join(AGENT, "claude", "statusline.mjs");
const SESSION_START = join(AGENT, "claude", "session-start.ts");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pva-hooks-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(args: string[], env: Record<string, string>, input = "") {
  const result = spawnSync(process.execPath, args, {
    cwd: dir,
    input,
    encoding: "utf-8",
    env: { PATH: process.env.PATH ?? "", HOME: dir, ...env },
    timeout: 30_000,
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

describe("UserPromptSubmit hook", () => {
  it("hands the inbox to the next prompt once, then stays quiet", () => {
    const state = new SessionState(join(dir, ".claude", "pva"));
    state.post("review", "New review thread on \"scene-2\"");
    state.post("stage-update", "Stage \"brief\" completed");

    const first = run([INBOX_HOOK], { CLAUDE_PROJECT_DIR: dir });
    expect(first.status).toBe(0);
    const out = JSON.parse(first.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(out.hookSpecificOutput.additionalContext).toContain("New review thread on \"scene-2\"");
    expect(out.hookSpecificOutput.additionalContext).toContain("[stage-update");

    const second = run([INBOX_HOOK], { CLAUDE_PROJECT_DIR: dir });
    expect(second.status).toBe(0);
    expect(second.stdout).toBe("");
  });

  it("keeps the newest entries when the inbox is long", () => {
    const state = new SessionState(join(dir, "state"));
    for (let i = 0; i < 200; i++) state.post("workspace", `File changed: assets/${i}.png ${"x".repeat(40)}`);
    const out = JSON.parse(run([INBOX_HOOK], { AVG_CLAUDE_STATE_DIR: join(dir, "state") }).stdout);
    const context: string = out.hookSpecificOutput.additionalContext;
    expect(context).toContain("assets/199.png");
    expect(context).not.toContain("assets/0.png ");
    expect(context).toMatch(/earlier entries omitted/);
    expect(context.length).toBeLessThan(5000);
  });

  it("says nothing without an inbox", () => {
    const result = run([INBOX_HOOK], { CLAUDE_PROJECT_DIR: dir });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });
});

describe("status line", () => {
  it("prints the server's status items", () => {
    const state = new SessionState(join(dir, ".claude", "pva"));
    state.setStatus("pva", "pva 0.1.0 (ready)");
    state.setStatus("pva-prod", "2 episodes");
    const result = run([STATUSLINE], {}, JSON.stringify({ workspace: { project_dir: dir } }));
    expect(result.stdout.trim()).toBe("pva 0.1.0 (ready) · 2 episodes");
  });

  it("prints nothing for a server that is gone", () => {
    mkdirSync(join(dir, "state"));
    writeFileSync(
      join(dir, "state", "status.json"),
      JSON.stringify({ updatedAt: new Date().toISOString(), pid: 2 ** 22 + 12345, items: { pva: "stale" } }),
    );
    const result = run([STATUSLINE], { AVG_CLAUDE_STATE_DIR: join(dir, "state") }, "{}");
    expect(result.stdout).toBe("");
  });
});

describe("SessionStart hook", () => {
  // Spawned asynchronously: the fake gateway lives in this process.
  function sessionStart(env: Record<string, string>): Promise<{ stdout: string; status: number | null }> {
    return new Promise((done) => {
      const child = spawn(process.execPath, ["--import", "tsx", SESSION_START], {
        cwd: resolve(AGENT, "..", ".."),
        env: { PATH: process.env.PATH ?? "", HOME: dir, AVG_LIBRARY_ROOT: dir, ...env },
      });
      let stdout = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.on("close", (status) => done({ stdout, status }));
    });
  }

  async function gateway(libraryRoots: string[]): Promise<{ url: string; close(): void }> {
    const server = createHttpServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(req.url === "/health" ? "{\"status\":\"ok\"}" : JSON.stringify({ libraryRoots }));
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const { port } = server.address() as { port: number };
    return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
  }

  it("warns when the gateway serves another library", async () => {
    const gw = await gateway([join(dir, "elsewhere")]);
    try {
      const result = await sessionStart({ AVG_GATEWAY_URL: gw.url, AVG_TTS_WORKER_URL: gw.url });
      expect(result.status).toBe(0);
      const out = JSON.parse(result.stdout);
      expect(out.systemMessage).toMatch(/NOT served by the gateway/);
      expect(out.hookSpecificOutput).toEqual({ hookEventName: "SessionStart", additionalContext: out.systemMessage });
    } finally {
      gw.close();
    }
  }, 60_000);

  it("is silent when the gateway serves this library", async () => {
    const gw = await gateway([realpathSync(dir)]);
    try {
      const result = await sessionStart({ AVG_GATEWAY_URL: gw.url, AVG_TTS_WORKER_URL: gw.url });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
    } finally {
      gw.close();
    }
  }, 60_000);

  it("is silent when the gateway is not running", async () => {
    // A port that was free a moment ago: nothing listens on it.
    const port = await new Promise<number>((done) => {
      const server = createServer().listen(0, "127.0.0.1", () => {
        const { port } = server.address() as { port: number };
        server.close(() => done(port));
      });
    });
    const result = await sessionStart({ AVG_GATEWAY_URL: `http://127.0.0.1:${port}`, AVG_TTS_WORKER_URL: `http://127.0.0.1:${port}` });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  }, 60_000);
});
