# Beads implementation plan

Epic: `fma-9km` — Deliver tracked fal.ai image production

Beads/Dolt is the issue source of truth. `.beads/issues.jsonl` is an inspectable export, not a backup.

```bash
bd status
bd list
bd graph --all
bd show fma-9km
```

## Current dependency graph

```text
📊 Dependency graph for fma-9km:

  Status: ○ open  ◐ in_progress  ● blocked  ✓ closed  ❄ deferred

  LAYER 0 (ready)                    LAYER 1                            LAYER 2                            LAYER 3                            LAYER 4                            LAYER 5                            LAYER 6                      

  ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐
  │ ○ Deliver tracked fal.ai… │   ╭─▶│ ○ Define versioned endpo… │────┬▶│ ○ Implement durable idem… │───┬─▶│ ○ Implement poll, progre… │───┬─▶│ ○ Download and validate … │───┬─▶│ ○ Build fake-provider co… │─────▶│ ○ Add opt-in live smoke … │
  │ fma-9km P1                │   │  │ fma-9km.2 P1              │ │  │ │ fma-9km.4 P1              │   │  │ fma-9km.5 P1              │   │  │ fma-9km.6 P1              │   │  │ fma-9km.9 P2              │      │ fma-9km.10 P1             │
  └───────────────────────────┘   │  └───────────────────────────┘ │  │ └───────────────────────────┘   │  └───────────────────────────┘   │  └───────────────────────────┘   │  └───────────────────────────┘      └───────────────────────────┘
                                  │                                │  │                                 │                                  │                                  │
  ┌───────────────────────────┐   │  ┌───────────────────────────┐ │  │                                 │  ┌───────────────────────────┐   │  ┌───────────────────────────┐   │
  │ ○ Scaffold adapter packa… │───┴─▶│ ○ Implement source uploa… │─╯  ╰▶                             ───┴─▶│ ○ Estimate, reserve, and… │───┴─▶│ ○ Normalize provider fai… │───╯
  │ fma-9km.1 P1              │      │ fma-9km.3 P1              │                                         │ fma-9km.7 P2              │      │ fma-9km.8 P2              │
  └───────────────────────────┘      └───────────────────────────┘                                         └───────────────────────────┘      └───────────────────────────┘

  Dependencies: 13 blocking relationships
  Total: 11 issues across 7 layers
```
