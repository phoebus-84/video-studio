# pi-video-agent

A distributable Pi package that turns Pi into the Agentic Video Studio executive producer.

## Owns

- Pi extensions and production tools.
- Commands for channel, series, episode, run, resume, review, and rerun operations.
- Dynamic discovery of built-in and series-local skills.
- Runtime and adapter clients with compact, abort-aware tool output.
- TUI status, progress, and approval interactions.
- Context injection from current channel, series, episode, snapshot, and stale dependency state.

## Constraints

The package uses Pi's extension and package APIs, supports TUI and RPC modes, starts long-lived resources only after `session_start`, cleans them at `session_shutdown`, throws on tool failure, truncates large output, and never stores production truth only in the Pi session.

## Plan

Run `bd list`, `bd graph`, and `bd show <id>`.
