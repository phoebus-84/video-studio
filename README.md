# Agentic Video Studio

Turns one prompt plus source material into a validated, narrated, illustrated
video. An agent — Pi, or Claude Code through the studio's MCP server — is the
executive producer; a deterministic runtime keeps pipeline state; dedicated
packages generate media; Remotion renders the episode's edit timeline and
FFmpeg masters and checks it; a gateway connects the agent to a browser studio.

## The shape of this repository

The repository is split along one line, and that line is enforced by
`npm run check:boundaries`:

```
packages/     reusable outside this project — they know nothing about episodes,
              pipelines, or the studio. Use them in any project.

studio/       the product. Depends on packages/. All studio-specific
              integration lives here, never inside a package.

skills/       shared/ is useful in any agent workflow; studio/ holds the
              production-stage skills.
```

A voice tool should be a voice tool. The fact that this studio uses it to
narrate episodes is the studio's business, not the tool's.

| Package | What it is on its own |
|---|---|
| `packages/remotion-composer` | Renders a layered, kit-based edit timeline with Remotion, then normalises loudness |
| `packages/render-worker` | Renders that timeline on other machines over SSH, or shares it among several |
| `packages/voice` | Speech synthesis, voice cloning, forced alignment and transcription on MLX |
| `packages/fal-media` | Tracked image and video generation against fal.ai, with provenance and cost |
| `packages/codex-image` | Image generation and editing through an OpenAI subscription or the Images API |
| `packages/elevenlabs` | ElevenLabs client: forced alignment, with rate and retry rules |
| `packages/archive-media` | Free archive and stock media with verifiable licences |
| `packages/audio-edit` | Audio cut on words, layered, ducked and mastered from a recipe |
| `packages/graphics` | Deterministic SVG/PNG code frames, diagrams, callouts, titles |
| `packages/infographics` | Frame-accurate animated infographics via Remotion |
| `packages/terminal-recorder` | A terminal session recorded to video from a VHS tape |
| `packages/blender` | Editable 3D scenes, Geometry Nodes, Eevee/Cycles animation and Poly Haven assets |
| `packages/video-composer` | Typed timeline → FFmpeg filter graph; probes and QA; multitrack mixes |

| Studio module | Role |
|---|---|
| `studio/contracts` | Canonical schemas, vocabulary, bindings |
| `studio/series` | Series compilers: episode spec and narration → edit timeline |
| `studio/episode` | An episode on disk, produced: timeline built or compiled, checked, rendered |
| `studio/runtime` | Snapshots, leases, staleness, journal, policy |
| `studio/pipelines` | Built-in pipeline manifests |
| `studio/agent` | The executive-producer tools: a Pi extension, served to Claude Code over MCP |
| `studio/adapters` | Stage adapters: the code that performs a stage, matched by contract |
| `studio/gateway` | Agent sessions (Pi RPC or the Claude Agent SDK) and event streaming |
| `studio/web` | Browser studio |

## Install

```bash
bun install                       # one install for every module
npm run compose -- --profile=full # wire the pieces you want
npm run doctor                    # check this machine can run them
```

This installs and wires the workspace, not every external tool or provider.
See [`docs/install.md`](docs/install.md) for profiles, requirements and
credentials. `npm run demo:render` runs a small asset-free render once the
workspace and FFmpeg are ready.

Then [run the agent](docs/running.md):

```bash
ln -sfn /path/to/your/library library    # once — where episodes live
pi -e studio/agent/extensions/index.ts   # Pi
claude                                   # or Claude Code, from the repository root
```

The browser UI is optional; the agent's pipeline tools still need a running
gateway for stage tracking, approval requests and budget status. See the
[running guide](docs/running.md).

You do not have to take all of it. `npm run compose -- --list` shows the
profiles; `--profile=voice` gives you just the voice tool, `--profile=render`
just the rendering packages.

## Documentation

The product website, recipes and selected films live in the independent
`video-studio-site` Git project. Its build does not depend on this workspace;
it imports an explicit snapshot of the technical reference when requested.

The application documentation remains under [`docs/`](docs/index.md), with its
own lightweight VitePress reference site:

```bash
npm run docs:dev     # http://localhost:5173
npm run docs:build   # also fails on any dead internal link
```

- [Install and composition](docs/install.md)
- [Running the agent](docs/running.md)
- [Channel Git and media storage](docs/workspace.md#git-and-storage) — version text and restore media by hash
- [Architecture](docs/architecture.md)
- [Domain language](docs/context.md)
- [Workspace layout](docs/workspace.md)
- [Pipelines](docs/pipelines.md)
- [Contributing](docs/contributing.md)
- [Blender setup and workflow](packages/blender/README.md)
- [DaVinci Resolve editorial handoff](docs/resolve-handoff.md) — optional integration through the actively maintained [davinci-resolve-mcp](https://github.com/samuelgursky/davinci-resolve-mcp)
- [Harness review and improvement priorities](docs/harness-review.md)
- [Per-component reference](docs/index.md#packages)
- [Decision records](docs/adr/)

## Everyday commands

```bash
npm test                  # every module's tests
npm run typecheck         # every module's typecheck
npm run check             # paths + boundaries + typecheck + tests
npm run compose -- --list # available profiles
npm run doctor            # toolchain, credentials, capability readiness
npm run resolve:plan -- --help # offline Resolve handoff preflight; live edits use upstream MCP
```
