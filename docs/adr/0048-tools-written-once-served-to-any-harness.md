# ADR-0048: The agent's tools are written once, for Pi, and served to other harnesses over MCP

## Status

Accepted. Implemented:
- `studio/agent/mcp/`: a Pi-shaped host and an MCP stdio server around the
  unchanged extension;
- `studio/agent/claude/`: Claude Code's hooks and status line;
- `.mcp.json`, `.claude/settings.json`, `CLAUDE.md`, and `.claude/skills/`
  written by `npm run compose`;
- the gateway's `AgentSessionManager`, with `ClaudeSessionManager` (Claude
  Agent SDK) beside `PiProcessManager`, chosen by `AVG_AGENT_BACKEND`.

## Context

Pi is the studio's executive producer, and its 61 production tools are
registered through Pi's extension API. The tools themselves do not need Pi:
each is a name, a JSON schema and an `execute` that calls the reusable
packages. What they read of Pi is small — `ui.notify`, `ui.setStatus`, the
model registry (for the Codex image login), and the extension's
`sendUserMessage` / `sendMessage` for gateway events.

Claude Code, and most other agent harnesses, call tools over MCP and read
skills as `SKILL.md` files. Running the studio there should not mean a second
copy of each tool that drifts from the first, nor a Pi that works less well.

## Decision

- **One implementation.** Tools, commands and lifecycle handlers stay in
  `studio/agent/src/`, written against Pi's API. Pi loads them as before; no
  Pi code path changed.
- **A host, not a port.** `mcp/host.ts` gives the extension the part of Pi's
  API it uses, and `mcp/server.ts` serves what it registers over MCP:
  - tools → MCP tools, same names and schemas (TypeBox schemas are JSON
    Schema), errors as error results, updates as progress;
  - slash commands → MCP prompts, the handler run with the prompt's words;
  - `ui.setStatus` → a status file a status line prints;
  - `sendUserMessage` → a channel event when Claude Code loads the server as
    a channel, else an inbox a `UserPromptSubmit` hook hands to the next
    prompt; `sendMessage` → the inbox;
  - the model registry → Pi's credential store when Pi is installed, else the
    Codex CLI's login or `AVG_CODEX_TOKEN`.
- **Skills from the same sources.** `npm run compose` writes
  `.claude/skills/<name>/SKILL.md` from the sets it already copies to
  `.pi/skills/`.
- **The gateway runs either agent.** The intent router, UI bridge and health
  depend on `AgentSessionManager`. Pi stays the default; `AVG_AGENT_BACKEND=claude`
  runs each episode as a Claude Agent SDK session whose tools are the same MCP
  server, so the gateway still produces nothing itself.

## Consequences

- A new tool is added once, in `studio/agent/src/`, and both harnesses have
  it; `tests/mcp-server.test.ts` checks the MCP side serves every tool the
  extension registers.
- A tool that starts using more of Pi's API must have that part added to the
  host. Until it is, that tool fails outside Pi with an error result, never
  silently.
- Under Claude Code, tools that write or spend ask for permission unless
  allowed; Pi never asked. The gateway's headless Claude sessions allow what
  Pi has and refuse the rest.
- Live review activity in an interactive Claude Code session depends on
  channels, a research preview; without them it arrives with the next prompt.
- The MCP server still imports Pi's library helpers (`StringEnum`,
  `withFileMutationQueue`) through the extension, so Pi's packages stay
  installed: replacing them would change how Pi coordinates file writes with
  its own edit tools.
