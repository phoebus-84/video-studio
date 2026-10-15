#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Claude Code status line: the studio's status bar
// ---------------------------------------------------------------------------
// Under Pi the extension sets status items (version, gateway stream, the
// production dashboard). The MCP server writes the same items to
// <state>/status.json; this prints them on one line. Opt in from your own
// settings (it is a personal choice, so the repository does not set it):
//
//   .claude/settings.local.json
//   { "statusLine": { "type": "command",
//       "command": "node \"$CLAUDE_PROJECT_DIR\"/studio/agent/claude/statusline.mjs" } }
// ---------------------------------------------------------------------------

import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function statusLine(raw, now = Date.now(), alive = processAlive) {
  let status;
  try {
    status = JSON.parse(raw);
  } catch {
    return "";
  }
  // A server that died without clearing its file must not leave a stale bar.
  if (typeof status.pid === "number" && !alive(status.pid)) return "";
  const updated = Date.parse(status.updatedAt ?? "");
  if (Number.isFinite(updated) && now - updated > 24 * 60 * 60 * 1000) return "";
  return Object.values(status.items ?? {}).filter((v) => typeof v === "string" && v).join(" · ");
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

function readStdin() {
  try {
    return readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

function main() {
  let projectDir = process.env.CLAUDE_PROJECT_DIR;
  try {
    const input = JSON.parse(readStdin() || "{}");
    projectDir ??= input.workspace?.project_dir ?? input.cwd;
  } catch {
    // No session JSON: fall back to the working directory.
  }
  const dir = process.env.AVG_CLAUDE_STATE_DIR
    ? resolve(process.env.AVG_CLAUDE_STATE_DIR)
    : join(projectDir ?? process.cwd(), ".claude", "pva");
  let raw;
  try {
    raw = readFileSync(join(dir, "status.json"), "utf-8");
  } catch {
    return;
  }
  const line = statusLine(raw);
  if (line) process.stdout.write(line + "\n");
}

function isEntryPoint() {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? "")).href;
  } catch {
    return false;
  }
}

if (isEntryPoint()) main();
