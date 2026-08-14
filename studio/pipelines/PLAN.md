# Beads implementation plan

Epic: `vbp-cal` — Ship the initial pipeline and skill library

Beads/Dolt is the issue source of truth. `.beads/issues.jsonl` is an inspectable export, not a backup.

```bash
bd status
bd list
bd graph --all
bd show vbp-cal
```

## Current dependency graph

```text
📊 Dependency graph for vbp-cal:

  Status: ○ open  ◐ in_progress  ● blocked  ✓ closed  ❄ deferred

  LAYER 0 (ready)                    LAYER 1                            LAYER 2                            LAYER 3                            LAYER 4                            LAYER 5                      

  ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐
  │ ○ Ship the initial pipel… │ ╭───▶│ ○ Define narrated-illust… │────┬▶│ ○ Author brief, script, … │────┬▶│ ○ Implement repository d… │────┬▶│ ○ Provide series-local o… │─────▶│ ○ Build golden artifacts… │
  │ vbp-cal P1                │ │    │ vbp-cal.2 P1              │    │ │ vbp-cal.3 P2              │ ││││ │ vbp-cal.10 P2             │ │  │ │ vbp-cal.11 P2             │      │ vbp-cal.12 P1             │
  └───────────────────────────┘ │    └───────────────────────────┘    │ └───────────────────────────┘ ││││ └───────────────────────────┘ │  │ └───────────────────────────┘      └───────────────────────────┘
                                │                                     │                               ││││                               │  │
  ┌───────────────────────────┐ │    ┌───────────────────────────┐    │ ┌───────────────────────────┐ ││││ ┌───────────────────────────┐ │  │
  │ ○ Define pipeline author… │─────▶│ ○ Implement fairy-tale i… │─╮  ╰▶│ ○ Author art direction, … │───┼─▶│ ○ Author edit, compositi… │─╯  │
  │ vbp-cal.1 P1              │    │ │ vbp-cal.6 P2              │ │    │ vbp-cal.4 P2              │ │ │  │ vbp-cal.5 P2              │    │
  └───────────────────────────┘    │ └───────────────────────────┘ │    └───────────────────────────┘ │ │  └───────────────────────────┘    │
                                   │                               │                                  │ │                                   │
                                   │ ┌───────────────────────────┐ │    ┌───────────────────────────┐ │ │  ┌───────────────────────────┐    │
                                   ╰▶│ ○ Implement pinned repos… │─┴───▶│ ○ Implement repository C… │───┴─▶│ ○ Implement fairy-tale s… │────╯
                                     │ vbp-cal.8 P2              │      │ vbp-cal.9 P2              │      │ vbp-cal.7 P2              │
                                     └───────────────────────────┘      └───────────────────────────┘      └───────────────────────────┘

  Dependencies: 20 blocking relationships
  Total: 13 issues across 6 layers
```
