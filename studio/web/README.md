# video-studio-web

Browser production studio for inspecting and steering every stage of an episode.

## Core surfaces

Channel and series library, pipeline/stage rail, editable editorial documents, scene timeline, asset attempt comparison, audio and video review, anchored comments, generation progress, staleness explanations, budget/provenance views, approvals, and targeted reruns.

## Product constraints

The GUI is a projection over the canonical workspace. Every mutation uses revision checks. It must remain useful while Pi is offline, expose errors and degraded states, support keyboard navigation and accessible media controls, and avoid hiding production history behind a chat-only interface.

## Approved product direction

The studio is a desktop-first localhost companion for a technical solo creator. Creation begins in Pi; the GUI optimizes for exception supervision while allowing granular artifact, media, review, and rerun work.

The approved direction is **The Provenance Workbench**: restrained hierarchy and keyboard fluency inspired by Linear, focused media inspection inspired by DaVinci Resolve, and structural trees and panes inspired by VS Code. It follows the operating-system theme and targets WCAG 2.2 AA.

Required design context:

- [`PRODUCT.md`](PRODUCT.md)
- [`DESIGN.md`](DESIGN.md)
- [`docs/SHAPE-BRIEF.md`](docs/SHAPE-BRIEF.md)

## Trust boundary

The GUI is a projection over the canonical workspace. It talks only to the trusted Agent Gateway, never owns Pi processes or provider credentials, never accesses unrestricted filesystem paths, and never overwrites immutable generated attempts. See [`docs/CONTRACT.md`](docs/CONTRACT.md).

## Development

This repository currently contains the approved design context and its deterministic validator. The Svelte application scaffold begins in `vsw-pbt.2`.

```bash
npm run check
```

Contributor and operator guidance:

- [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md)
- [`docs/OPERATOR.md`](docs/OPERATOR.md)

## Plan

Work is tracked once, for the whole repository, at its root; this module keeps no plan of its own.
