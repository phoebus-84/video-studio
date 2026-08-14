# Beads implementation plan

Epic: `pva-sob` — Ship the Pi executive-producer package

Beads/Dolt is the issue source of truth. `.beads/issues.jsonl` is an inspectable export, not a backup.

```bash
bd status
bd list
bd graph --all
bd show pva-sob
```

## Current dependency graph

```text
📊 Dependency graph for pva-sob:

  Status: ○ open  ◐ in_progress  ● blocked  ✓ closed  ❄ deferred

  LAYER 0 (ready)                    LAYER 1                            LAYER 2                            LAYER 3                            LAYER 4                            LAYER 5                            LAYER 6                            LAYER 7                            LAYER 8                            LAYER 9                      

  ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐
  │ ○ Ship the Pi executive-… │   ╭─▶│ ○ Resolve studio configu… │─────▶│ ○ Discover built-in and … │─────▶│ ○ Inject current product… │─────▶│ ○ Register workspace and… │─────▶│ ○ Register pipeline exec… │───┬─▶│ ○ Register capability to… │────┬▶│ ○ Implement trust, path,… │───┬─▶│ ○ Harden RPC-mode behavi… │─────▶│ ○ Package end-to-end Pi … │
  │ pva-sob P1                │   │  │ pva-sob.2 P1              │      │ pva-sob.3 P1              │      │ pva-sob.4 P1              │      │ pva-sob.5 P2              │      │ pva-sob.6 P2              │   │  │ pva-sob.7 P2              │ │  │ │ pva-sob.11 P2             │   │  │ pva-sob.10 P2             │      │ pva-sob.12 P1             │
  └───────────────────────────┘   │  └───────────────────────────┘      └───────────────────────────┘      └───────────────────────────┘      └───────────────────────────┘      └───────────────────────────┘   │  └───────────────────────────┘ │  │ └───────────────────────────┘   │  └───────────────────────────┘      └───────────────────────────┘
                                  │                                                                                                                                                                              │                                │  │                                 │
  ┌───────────────────────────┐   │                                                                                                                                                                              │  ┌───────────────────────────┐ │  │ ┌───────────────────────────┐   │
  │ ○ Scaffold distributable… │───╯                                                                                                                                                                              ╰─▶│ ○ Implement user-facing … │────┴▶│ ○ Add compact TUI produc… │───╯
  │ pva-sob.1 P1              │                                                                                                                                                                                     │ pva-sob.8 P2              │      │ pva-sob.9 P2              │
  └───────────────────────────┘                                                                                                                                                                                     └───────────────────────────┘      └───────────────────────────┘

  Dependencies: 16 blocking relationships
  Total: 13 issues across 10 layers
```
