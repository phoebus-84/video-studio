// ---------------------------------------------------------------------------
// Claude Code SessionStart hook: is this session's library the studio's?
// ---------------------------------------------------------------------------
// The same check the extension makes at Pi's session_start: the agent writes
// to the library under the directory it was started in (or AVG_LIBRARY_ROOT),
// and when the gateway serves a different one, everything produced here is
// invisible in the studio — silently, because from the agent's side nothing
// is wrong. Says so, and only then; a gateway that is not running is not news.
//
//   cd "$CLAUDE_PROJECT_DIR" && node --import tsx studio/agent/claude/session-start.ts
// ---------------------------------------------------------------------------

import { checkServiceHealth, resolveConfig } from "../src/config.js";

async function main(): Promise<void> {
  const config = await resolveConfig();
  const { health } = await checkServiceHealth(config);
  const visibility = health["library-visibility"];
  if (!visibility || visibility.available) return;

  const message = `Agentic Video Studio: ${visibility.message}`;
  process.stdout.write(
    JSON.stringify({
      systemMessage: message,
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: message },
    }) + "\n",
  );
}

// Advisory only: never fail a session over a diagnostic.
main().catch(() => {}).finally(() => process.exit(0));
