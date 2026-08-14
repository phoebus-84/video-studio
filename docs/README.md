# Documentation

Everything is here, in one place.

## Start

| Document | What it answers |
|---|---|
| [install.md](install.md) | How do I install and compose this? |
| [architecture.md](architecture.md) | How does the system behave, and where are the boundaries? |
| [context.md](context.md) | What does each domain term mean? Read this before naming anything. |
| [workspace.md](workspace.md) | What does the on-disk channel/series/episode layout look like? |
| [pipelines.md](pipelines.md) | How are pipeline manifests and overrides structured? |
| [contributing.md](contributing.md) | How do I add a package, capability, skill or pipeline? |
| [repository-layout.md](repository-layout.md) | Why is the tree split into `packages/` and `studio/`? |

## Packages

Reusable outside this project. They know nothing about episodes or pipelines.

| Package | Capabilities | Reference |
|---|---|---|
| `packages/voice` | `speech.synthesize` | [packages/voice.md](packages/voice.md) |
| `packages/fal-media` | `image.generate`, `image.edit` | [packages/fal-media.md](packages/fal-media.md) |
| `packages/graphics` | `graphics.render` | [packages/graphics.md](packages/graphics.md) |
| `packages/infographics` | `graphics.animate` | [packages/infographics.md](packages/infographics.md) |
| `packages/video-composer` | `video.compose`, `media.probe` | [packages/video-composer.md](packages/video-composer.md) |

## Studio

The product. Depends on `packages/`. All studio-specific integration lives here.

| Module | Reference |
|---|---|
| `studio/contracts` | [studio/contracts.md](studio/contracts.md) |
| `studio/runtime` | [studio/runtime.md](studio/runtime.md) |
| `studio/pipelines` | [studio/pipelines.md](studio/pipelines.md) |
| `studio/agent` | [studio/agent.md](studio/agent.md) |
| `studio/gateway` | [studio/gateway.md](studio/gateway.md) |
| `studio/web` | [studio/web.md](studio/web.md) |

Each module also keeps its own in-tree `README.md` and `docs/` covering its
internals. This index links the entry points; it does not duplicate them.

## Decision records

[`adr/`](adr/) holds 31 accepted decisions. The ones that most shape the code:

| ADR | Decision |
|---|---|
| [0015](adr/0015-stages-request-capabilities-not-providers.md) | Stages request capabilities, not providers |
| [0022](adr/0022-modules-have-independent-git-and-beads-history.md) | *Superseded* — modules had independent repos; see [0032](adr/0032-single-repository-with-reusable-packages.md) |
| [0024](adr/0024-canonical-pipeline-manifest-owned-by-contracts.md) | The pipeline manifest schema is owned by contracts |
| [0026](adr/0026-capability-dispatch-via-package-imports.md) | Capability dispatch uses package imports, never path guessing |
| [0029](adr/0029-skills-single-source-of-truth.md) | `skills/` is the source of truth; `.pi/skills/` is generated |
| [0030](adr/0030-secrets-are-environment-only-and-dev-auth-is-explicit.md) | Secrets are environment-only |
| [0032](adr/0032-single-repository-with-reusable-packages.md) | One repository, split into reusable packages and the product |
