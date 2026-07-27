# Beads implementation plan

Epic: `sgr-3i9` — Deliver deterministic technical and editorial graphics

Beads/Dolt is the issue source of truth. `.beads/issues.jsonl` is an inspectable export, not a backup.

```bash
bd status
bd list
bd graph --all
bd show sgr-3i9
```

## Current dependency graph

```text
📊 Dependency graph for sgr-3i9:

  Status: ○ open  ◐ in_progress  ● blocked  ✓ closed  ❄ deferred

  LAYER 0 (ready)                    LAYER 1                            LAYER 2                            LAYER 3                            LAYER 4                            LAYER 5                            LAYER 6                      

  ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐
  │ ○ Deliver deterministic … │   ╭─▶│ ○ Implement series theme… │─────▶│ ○ Build safe SVG layout … │─────▶│ ○ Render syntax-highligh… │─┬┬─┬▶│ ○ Implement PNG rasteriz… │─────▶│ ○ Harden untrusted conte… │─────▶│ ○ Create visual fixture … │
  │ sgr-3i9 P1                │   │  │ sgr-3i9.2 P1              │      │ sgr-3i9.3 P1              │ ││ │ │ sgr-3i9.4 P2              │ ││ │ │ sgr-3i9.8 P1              │      │ sgr-3i9.9 P2              │      │ sgr-3i9.10 P1             │
  └───────────────────────────┘   │  └───────────────────────────┘      └───────────────────────────┘ ││ │ └───────────────────────────┘ ││ │ └───────────────────────────┘      └───────────────────────────┘      └───────────────────────────┘
                                  │                                                                   ││ │                               ││ │
  ┌───────────────────────────┐   │                                                                   ││ │ ┌───────────────────────────┐ ││ │
  │ ○ Scaffold renderer pack… │───╯                                                                   ││ ╰▶│ ○ Render architecture an… │─┼┼─╯
  │ sgr-3i9.1 P1              │                                                                       ││   │ sgr-3i9.5 P2              │ ││
  └───────────────────────────┘                                                                       ││   └───────────────────────────┘ ││
                                                                                                      ││                                 ││
                                                                                                      ││   ┌───────────────────────────┐ ││
                                                                                                      │╰──▶│ ○ Render simple charts a… │─╯│
                                                                                                      │    │ sgr-3i9.6 P2              │  │
                                                                                                      │    └───────────────────────────┘  │
                                                                                                      │                                   │
                                                                                                      │    ┌───────────────────────────┐  │
                                                                                                      ╰───▶│ ○ Render titles, quotes,… │──╯
                                                                                                           │ sgr-3i9.7 P2              │
                                                                                                           └───────────────────────────┘

  Dependencies: 12 blocking relationships
  Total: 11 issues across 7 layers
```
