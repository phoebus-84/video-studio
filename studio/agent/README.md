# pi-video-agent

A distributable Pi package that turns Pi into the Agentic Video Studio executive producer.

## Owns

- Pi extensions and production tools.
- Idempotent filesystem authoring for channels, series, and episode workspaces.
- Commands for channel, series, episode, run, resume, review, and rerun operations.
- Dynamic discovery of built-in and series-local skills.
- Runtime and adapter clients with compact, abort-aware tool output.
- TUI status, progress, and approval interactions.
- Context injection from current channel, series, episode, snapshot, and stale dependency state.
- Deterministic rigged SVG animation rendering, local nonverbal character-audio synthesis, and frame-addressed multitrack composition.

## Constraints

The package uses Pi's extension and package APIs, supports TUI and RPC modes, starts long-lived resources only after `session_start`, cleans them at `session_shutdown`, throws on tool failure, truncates large output, and never stores production truth only in the Pi session.

## Outside Pi

`mcp/` hosts this extension, unchanged, outside Pi: `mcp/host.ts` gives it the
part of Pi's API it uses, and `mcp/server.ts` serves its tools over MCP stdio
and its slash commands as MCP prompts (ADR-0048). The repository's `.mcp.json`
starts it for Claude Code; `claude/` holds Claude Code's hooks and status line.
Add a tool here once, against Pi's API — both harnesses get it.

## Durable narration client

`src/tts-client.ts` exports an abort-aware `QwenTtsClient` for API 0.1.x. It submits complete canonical segment/profile jobs, resumes polling after restart, preserves worker machine errors, supports cancellation, validation, bounded retry, processing, and final mastering. Legacy `synthesize-speech` remains available during migration; composition prefers the canonical manifest's measured final WAV and fails closed when a present manifest is corrupt.

## Plan

Run `bd list`, `bd graph`, and `bd show <id>`.
