---
name: pva-executive-producer
description: Operate the Agentic Video Studio as executive producer. Use for channel, series, episode, run, resume, review, and rerun commands. This skill coordinates video production pipelines through the pva_* tools, under Pi or Claude Code.
---

# PVA Executive Producer

This skill makes the agent — Pi, or Claude Code through the studio's MCP server — the
executive producer for the Agentic Video Studio. It coordinates the full production
lifecycle: channels, series, episodes, pipeline runs, reviews, and reruns.

## Setup

Under Pi, the package must be installed as a Pi package (or loaded with
`pi -e studio/agent/extensions/index.ts`):

```bash
pi install ./path/to/pi-video-agent
```

Runtime dependencies are installed automatically during package installation.

Under Claude Code, start `claude` from the repository root: its `.mcp.json` starts the
`pva` MCP server, which serves the same tools as `mcp__pva__pva_*`. The slash commands
are its prompts (`/mcp__pva__video`, `/mcp__pva__render`, …).

## Usage

Once installed, the executive producer extension loads at session start. Tools and
commands become available through the agent.

### Core Concepts

- **Channel**: Top-level organization unit for a video series or brand.
- **Series**: A collection of episodes within a channel.
- **Episode**: A single video production unit with its own pipeline state.
- **Workspace authoring**: Idempotent creation of channel, series, and episode directories; existing metadata is never overwritten.
- **Run**: One execution of a pipeline against an episode.
- **Resume**: Continue a previous run from its last checkpoint.
- **Review**: Evaluate pipeline output and collect human feedback.
- **Rerun**: Re-execute a pipeline from a specific stage.

### Available Tools

- `pva_version` — Report package version and load-time health.
- `pva_diagnostics` — Return detailed diagnostics including any errors.
- `pva_create_channel` — Create channel metadata and an optional pipeline profile.
- `pva_create_series` — Create a series and its local skill directory.
- `pva_create_episode` — Create the canonical episode workspace layout.
- `pva_render_vector_animation` — Validate or render a declarative rigged SVG animation.
- `pva_synthesize_nonverbal_audio` — Generate deterministic speech-free character cues.
- `pva_compose_multitrack_video` — Mix an animated clip with frame-addressed local audio cues into an immutable render.
- `pva_generate_wan_video` — Animate one episode image with Wan 2.2 A14B turbo on fal ($0.10/clip at 720p,
  $0.05 at 480p; on the spend ledger). `loop: true` ends on the same image: a closed loop. Prefer it to
  `pva_generate_minimax_h3_video` (~$0.48/clip) for loops and small moving details; keep H3 for
  performances, references and long shots. **Channel `ambient-through-time`: animate every live island with
  this tool** (crop as `imagePath`, `loop: true`) — not MiniMax H3, and not through the CreativeStudio bridge.

### Work in parallel (operator rule)

Wall time is the operator's main complaint; serial work is a defect.

- **Generations go out together**: every independent `pva_generate_image` (Codex/gpt-image) and every
  `pva_generate_wan_video` / H3 clip of a step is sent in ONE message, never one after the other.
- **Never wait idle**: while generations or a render run, prepare the next step (crops, spec, music, checks);
  process each clip as soon as it lands, not after the whole batch.
- **Delegate local work to parallel subagents**: compositing, loops, FFmpeg/Python batches, Remotion tests and
  code fixes go to subagents running side by side (background), each with a clear brief; the main thread
  coordinates and judges results. Scripts use all CPU cores (process pools, one process per event/island).
- **Shared render** on the operator's machines (`hosts: ["local", "asus", "server-casa"]`) for anything
  longer than a short test.
- Read one contact sheet / layout sheet per check, not frame by frame.

Create parents in order: channel, series, then episode. Creation is intentionally
non-destructive: revise existing metadata with reviewed file edits rather than
using the create tools as overwrite operations.

Additional tools for pipeline, configuration, and capability management are
registered by dependent extensions as the package evolves.

## Reference

See `CONTRIBUTING.md` for development setup and `SECURITY.md` for the full-system-access
implications of this package.
