# Agentic Video Studio

Turns one prompt plus source material into a validated, narrated, illustrated
1080p video. Pi is the creative executive producer; a deterministic runtime
keeps pipeline state; dedicated packages generate media; FFmpeg compiles the
result; a gateway connects Pi to a browser studio.

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
| `packages/voice` | Speech synthesis and voice cloning on MLX |
| `packages/fal-media` | Tracked image generation/editing against fal.ai |
| `packages/graphics` | Deterministic SVG/PNG code frames, diagrams, titles |
| `packages/infographics` | Frame-accurate animated infographics via Remotion |
| `packages/video-composer` | Typed edit timeline → FFmpeg filter graph, plus QA |

| Studio module | Role |
|---|---|
| `studio/contracts` | Canonical schemas, vocabulary, bindings |
| `studio/runtime` | Snapshots, leases, staleness, journal, policy |
| `studio/pipelines` | Built-in pipeline manifests |
| `studio/agent` | The Pi executive-producer package |
| `studio/gateway` | Pi RPC ownership and event streaming |
| `studio/web` | Browser studio |

## Install

```bash
bun install                       # one install for every module
npm run compose -- --profile=full # wire the pieces you want
npm run doctor                    # check this machine can run them
```

That is the whole install. See [`docs/install.md`](docs/install.md) for
profiles, system requirements, and credentials.

Then [run the agent](docs/running.md):

```bash
ln -sfn /path/to/your/library library    # once — where episodes live
pi -e studio/agent/extensions/index.ts
```

You do not have to take all of it. `npm run compose -- --list` shows the
profiles; `--profile=voice` gives you just the voice tool, `--profile=render`
just the rendering packages.

## Documentation

Everything is under [`docs/`](docs/README.md) — one place, one index.

- [Install and composition](docs/install.md)
- [Running the agent](docs/running.md)
- [Architecture](docs/architecture.md)
- [Domain language](docs/context.md)
- [Workspace layout](docs/workspace.md)
- [Pipelines](docs/pipelines.md)
- [Contributing](docs/contributing.md)
- [Per-package reference](docs/README.md#packages)
- [Decision records](docs/adr/)

## Everyday commands

```bash
npm test                  # every module's tests
npm run typecheck         # every module's typecheck
npm run check             # paths + boundaries + typecheck + tests
npm run compose -- --list # available profiles
npm run doctor            # toolchain, credentials, capability readiness
```
