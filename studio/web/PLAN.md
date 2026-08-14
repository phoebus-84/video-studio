# Beads implementation plan

Epic: `vsw-pbt` — Deliver the browser production studio MVP

Beads/Dolt is the issue source of truth. `.beads/issues.jsonl` is an inspectable export, not a backup.

```bash
bd status
bd list
bd graph --all
bd show vsw-pbt
```

## Current dependency graph

```text
📊 Dependency graph for vsw-pbt:

  Status: ○ open  ◐ in_progress  ● blocked  ✓ closed  ❄ deferred

  LAYER 0 (ready)                    LAYER 1                            LAYER 2                            LAYER 3                            LAYER 4                            LAYER 5                            LAYER 6                            LAYER 7                            LAYER 8                            LAYER 9                            LAYER 10                     

  ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐
  │ ○ Deliver the browser pr… │   ╭─▶│ ○ Scaffold web app, gene… │─────▶│ ○ Build channel, series,… │─────▶│ ○ Build episode workspac… │─────▶│ ○ Build revision-safe Ma… │────┬▶│ ○ Build immutable asset … │─┬──┬▶│ ○ Build review inbox and… │─────▶│ ○ Build progress, budget… │─────▶│ ○ Build staleness explan… │─────▶│ ○ Harden accessibility, … │─────▶│ ○ Build browser end-to-e… │
  │ vsw-pbt P1                │   │  │ vsw-pbt.2 P1              │      │ vsw-pbt.3 P1              │      │ vsw-pbt.4 P1              │   │  │ vsw-pbt.5 P2              │    │ │ vsw-pbt.7 P2              │ │  │ │ vsw-pbt.10 P2             │      │ vsw-pbt.11 P2             │      │ vsw-pbt.12 P2             │      │ vsw-pbt.13 P2             │      │ vsw-pbt.14 P1             │
  └───────────────────────────┘   │  └───────────────────────────┘      └───────────────────────────┘      └───────────────────────────┘   │  └───────────────────────────┘    │ └───────────────────────────┘ │  │ └───────────────────────────┘      └───────────────────────────┘      └───────────────────────────┘      └───────────────────────────┘      └───────────────────────────┘
                                  │                                                                                                        │                                   │                               │  │
  ┌───────────────────────────┐   │                                                                                                        │  ┌───────────────────────────┐    │ ┌───────────────────────────┐ │  │
  │ ○ Create and approve the… │───╯                                                                                                        ╰─▶│ ○ Build scene storyboard… │────┴▶│ ○ Build narration segmen… │─┼──╯
  │ vsw-pbt.1 P2              │                                                                                                               │ vsw-pbt.6 P2              │ │    │ vsw-pbt.8 P2              │ │
  └───────────────────────────┘                                                                                                               └───────────────────────────┘ │    └───────────────────────────┘ │
                                                                                                                                                                            │                                  │
                                                                                                                                                                            │    ┌───────────────────────────┐ │
                                                                                                                                                                            ╰───▶│ ○ Build render player wi… │─╯
                                                                                                                                                                                 │ vsw-pbt.9 P2              │
                                                                                                                                                                                 └───────────────────────────┘

  Dependencies: 16 blocking relationships
  Total: 15 issues across 11 layers
```
