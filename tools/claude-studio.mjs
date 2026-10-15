#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Start Claude Code as the studio's executive producer, with live events.
// ---------------------------------------------------------------------------
// A plain `claude` from the repository root already has the studio's tools
// (.mcp.json) and sees review activity on its next prompt (the inbox hook).
// This starts it with the pva server loaded as a development channel instead,
// so operator review activity starts a turn as it arrives — what Pi does with
// sendUserMessage. Channels are a Claude Code research preview: interactive
// sessions only, and a confirmation prompt at start.
//
//   npm run studio:claude [-- <more claude args>]
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const child = spawn(
  process.env.CLAUDE_BIN ?? "claude",
  ["--dangerously-load-development-channels", "server:pva", ...process.argv.slice(2)],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, AVG_CLAUDE_CHANNEL: "1" },
    shell: process.platform === "win32",
  },
);
child.on("error", (err) => {
  console.error(`Could not start Claude Code (${err.message}). Install it, or set CLAUDE_BIN.`);
  process.exit(1);
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 0));
