# Documentation

Everything is here, in one place.

## Start

| Document | What it answers |
|---|---|
| [Install and composition](./install) | How do I install this, and choose which pieces are wired? |
| [Running the agent](./running) | How do I actually run it? |
| [Repository layout](./repository-layout) | Why is the tree split into `packages/` and `studio/`, and where does my code go? |
| [Contributing](./contributing) | How do I add a package, capability, skill or pipeline? |

## Understanding the system

| Document | What it answers |
|---|---|
| [Architecture](./architecture) | How does the system behave, and where are the boundaries? |
| [Domain language](./context) | What does each term mean? Read this before naming anything. |
| [Workspace layout](./workspace) | What does the on-disk channel/series/episode tree look like? |
| [Pipelines](./pipelines) | How are pipeline manifests and overrides structured? |

## Packages

Reusable outside this project. They know nothing about episodes or pipelines.

| Package | Capabilities |
|---|---|
| [voice](./packages/voice) | `speech.synthesize` |
| [fal-media](./packages/fal-media) | `image.generate`, `image.edit` |
| [graphics](./packages/graphics) | `graphics.render` |
| [infographics](./packages/infographics) | `graphics.animate` |
| [video-composer](./packages/video-composer) | `video.compose`, `media.probe` |

## Studio

The product. Depends on `packages/`. All studio-specific integration lives here.

| Module | Role |
|---|---|
| [contracts](./studio/contracts) | Canonical schemas, vocabulary, bindings |
| [runtime](./studio/runtime) | Snapshots, leases, staleness, journal, policy |
| [pipelines](./studio/pipelines) | Built-in pipeline manifests |
| [agent](./studio/agent) | The Pi executive-producer package |
| [gateway](./studio/gateway) | Pi RPC ownership and event streaming |
| [web](./studio/web) | Browser studio |

Each component page links to that component's own README and `docs/`, which are
synced into the site at build time from where they live next to the code.

## Decision records

[`adr/`](./adr/0032-single-repository-with-reusable-packages) holds 32 accepted
decisions. The ones that most shape the code:

| ADR | Decision |
|---|---|
| [0015](./adr/0015-stages-request-capabilities-not-providers) | Stages request capabilities, not providers |
| [0024](./adr/0024-canonical-pipeline-manifest-owned-by-contracts) | The pipeline manifest schema is owned by contracts |
| [0026](./adr/0026-capability-dispatch-via-package-imports) | Capability dispatch uses package imports, never path guessing |
| [0029](./adr/0029-skills-single-source-of-truth) | `skills/` is the source of truth; `.pi/skills/` is generated |
| [0030](./adr/0030-secrets-are-environment-only-and-dev-auth-is-explicit) | Secrets are environment-only |
| [0032](./adr/0032-single-repository-with-reusable-packages) | One repository, split into reusable packages and the product |

ADR-0022 (independent repositories per module) is superseded by 0032.
