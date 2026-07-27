---
name: pva-executive-producer
description: Operate the Agentic Video Studio as executive producer. Use for channel, series, episode, run, resume, review, and rerun commands. This skill coordinates video production pipelines through Pi.
---

# PVA Executive Producer

This skill makes Pi the executive producer for the Agentic Video Studio. It coordinates
the full production lifecycle: channels, series, episodes, pipeline runs, reviews, and
reruns.

## Setup

The package must be installed as a Pi package:

```bash
pi install ./path/to/pi-video-agent
```

Runtime dependencies are installed automatically during package installation.

## Usage

Once installed, the executive producer extension loads at session start. Tools and
commands become available through the Pi agent.

### Core Concepts

- **Channel**: Top-level organization unit for a video series or brand.
- **Series**: A collection of episodes within a channel.
- **Episode**: A single video production unit with its own pipeline state.
- **Run**: One execution of a pipeline against an episode.
- **Resume**: Continue a previous run from its last checkpoint.
- **Review**: Evaluate pipeline output and collect human feedback.
- **Rerun**: Re-execute a pipeline from a specific stage.

### Available Tools

- `pva_version` — Report package version and load-time health.
- `pva_diagnostics` — Return detailed diagnostics including any errors.

Additional tools for workspace, pipeline, configuration, and capability management
are registered by dependent extensions as the package evolves.

## Reference

See `CONTRIBUTING.md` for development setup and `SECURITY.md` for the full-system-access
implications of this package.
