// ---------------------------------------------------------------------------
// Session-side files the MCP server shares with Claude Code's hooks
// ---------------------------------------------------------------------------
// Pi shows a status line and takes turns pushed by the extension. Claude Code
// does both through hooks and a status line command, which run as separate
// processes, so the server leaves what they need in a small directory:
//
//   <state>/status.json   what the extension last put in the status bar
//   <state>/inbox.jsonl   messages the extension wanted the agent to see,
//                         waiting for the next prompt (one JSON per line)
//
// <state> is $AVG_CLAUDE_STATE_DIR, else .claude/pva under the directory the
// session was started in. studio/agent/claude/*.mjs read the same files.
// ---------------------------------------------------------------------------

import { appendFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface InboxEntry {
  at: string;
  kind: string;
  text: string;
}

export function stateDir(cwd: string = process.cwd(), env: Record<string, string | undefined> = process.env): string {
  return env.AVG_CLAUDE_STATE_DIR ? resolve(env.AVG_CLAUDE_STATE_DIR) : join(cwd, ".claude", "pva");
}

export class SessionState {
  private readonly status = new Map<string, string>();

  constructor(readonly dir: string) {}

  setStatus(key: string, text: string): void {
    if (text) this.status.set(key, text);
    else this.status.delete(key);
    try {
      mkdirSync(this.dir, { recursive: true });
      const file = join(this.dir, "status.json");
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ updatedAt: new Date().toISOString(), pid: process.pid, items: Object.fromEntries(this.status) }) + "\n");
      renameSync(tmp, file);
    } catch {
      // A status bar is a convenience; never fail a session over it.
    }
  }

  /** The status bar's current text, one line per key. */
  statusLines(): string[] {
    return [...this.status.values()];
  }

  clearStatus(): void {
    this.status.clear();
    this.setStatus("", "");
  }

  post(kind: string, text: string): void {
    const entry: InboxEntry = { at: new Date().toISOString(), kind, text };
    try {
      mkdirSync(this.dir, { recursive: true });
      appendFileSync(join(this.dir, "inbox.jsonl"), JSON.stringify(entry) + "\n");
    } catch {
      // Same: the journal (pva_journal) still holds the record.
    }
  }
}
