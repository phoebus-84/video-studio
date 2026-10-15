#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Claude Code UserPromptSubmit hook: what the studio said since the last prompt
// ---------------------------------------------------------------------------
// Under Pi the extension pushes a turn when the operator leaves review activity
// (sendUserMessage) and posts stage updates into the conversation
// (sendMessage). Claude Code takes neither from an MCP server unless it was
// started with the studio's development channel, so the MCP server leaves them
// in <state>/inbox.jsonl (see studio/agent/mcp/state.ts) and this hook hands
// them to the next prompt as context.
//
// <state> is $AVG_CLAUDE_STATE_DIR, else $CLAUDE_PROJECT_DIR/.claude/pva.
// Plain JavaScript on purpose: it runs on every prompt.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, realpathSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Most a hook should put in front of a prompt; older entries are summarised by count. */
const MAX_CHARS = 4000;

export function stateDir(env = process.env) {
  if (env.AVG_CLAUDE_STATE_DIR) return resolve(env.AVG_CLAUDE_STATE_DIR);
  return join(env.CLAUDE_PROJECT_DIR ?? process.cwd(), ".claude", "pva");
}

/** Take every waiting entry, leaving the inbox empty. */
export function drainInbox(dir) {
  const file = join(dir, "inbox.jsonl");
  if (!existsSync(file)) return [];
  // A rename is atomic: the server's next append starts a fresh file.
  const taken = `${file}.${process.pid}.taken`;
  try {
    renameSync(file, taken);
  } catch {
    return [];
  }
  try {
    return readFileSync(taken, "utf-8")
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const entry = JSON.parse(line);
          return typeof entry.text === "string" ? [entry] : [];
        } catch {
          return [];
        }
      });
  } finally {
    rmSync(taken, { force: true });
  }
}

/** The context text for a set of entries, newest kept when they do not all fit. */
export function contextFor(entries) {
  if (entries.length === 0) return null;
  const lines = entries.map((e) => `- [${e.kind ?? "studio"} ${e.at ?? ""}] ${e.text}`.replace(/\s+$/, ""));
  const kept = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (size + lines[i].length > MAX_CHARS && kept.length > 0) break;
    kept.unshift(lines[i]);
    size += lines[i].length + 1;
  }
  const dropped = lines.length - kept.length;
  return [
    "Studio activity since the last prompt (from the pva MCP server):",
    ...(dropped > 0 ? [`- (${dropped} earlier entries omitted; pva_journal has the full record)`] : []),
    ...kept,
  ].join("\n");
}

function main() {
  const context = contextFor(drainInbox(stateDir()));
  if (!context) return;
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context } }) + "\n",
  );
}

function isEntryPoint() {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? "")).href;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  try {
    main();
  } catch {
    // Never block a prompt over the inbox.
  }
}
