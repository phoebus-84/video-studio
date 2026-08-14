# Beads implementation plan

Epic: `vwc-5q0` — Ship v1alpha1 cross-module production contracts

Beads/Dolt is the issue source of truth. `.beads/issues.jsonl` is an inspectable export, not a backup.

```bash
bd status
bd list
bd graph --all
bd show vwc-5q0
```

## Current dependency graph

```text
📊 Dependency graph for vwc-5q0:

  Status: ○ open  ◐ in_progress  ● blocked  ✓ closed  ❄ deferred

  LAYER 0 (ready)                    LAYER 1                            LAYER 2                            LAYER 3                            LAYER 4                            LAYER 5                            LAYER 6                      

  ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐
  │ ○ Ship v1alpha1 cross-mo… │   ╭─▶│ ○ Define identity, revis… │─────▶│ ○ Model channel, series,… │─────▶│ ○ Model pipeline definit… │─────▶│ ○ Model edit timeline, c… │────┬▶│ ○ Generate and package T… │─────▶│ ○ Build compatibility ma… │
  │ vwc-5q0 P1                │   │  │ vwc-5q0.2 P1              │   │  │ vwc-5q0.3 P1              │   │  │ vwc-5q0.4 P1              │ │  │ │ vwc-5q0.6 P1              │ │  │ │ vwc-5q0.8 P2              │   │  │ vwc-5q0.10 P1             │
  └───────────────────────────┘   │  └───────────────────────────┘   │  └───────────────────────────┘   │  └───────────────────────────┘ │  │ └───────────────────────────┘ │  │ └───────────────────────────┘   │  └───────────────────────────┘
                                  │                                  │                                  │                                │  │                               │  │                                 │
  ┌───────────────────────────┐   │                                  │                                  │  ┌───────────────────────────┐ │  │ ┌───────────────────────────┐ │  │ ┌───────────────────────────┐   │
  │ ○ Document contract taxo… │───╯                                  ╰─▶                             ───┴─▶│ ○ Model editorial artifa… │─┴──┴▶│ ○ Model event journal, r… │────┴▶│ ○ Generate and package P… │───╯
  │ vwc-5q0.1 P1              │                                                                            │ vwc-5q0.5 P1              │      │ vwc-5q0.7 P1              │      │ vwc-5q0.9 P2              │
  └───────────────────────────┘                                                                            └───────────────────────────┘      └───────────────────────────┘      └───────────────────────────┘

  Dependencies: 17 blocking relationships
  Total: 11 issues across 7 layers
```
