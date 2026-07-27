# Beads implementation plan

Epic: `vsg-e57` — Deliver the trusted local studio gateway

Beads/Dolt is the issue source of truth. `.beads/issues.jsonl` is an inspectable export, not a backup.

```bash
bd status
bd list
bd graph --all
bd show vsg-e57
```

## Current dependency graph

```text
📊 Dependency graph for vsg-e57:

  Status: ○ open  ◐ in_progress  ● blocked  ✓ closed  ❄ deferred

  LAYER 0 (ready)                    LAYER 1                            LAYER 2                            LAYER 3                            LAYER 4                            LAYER 5                            LAYER 6                            LAYER 7                      

  ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐
  │ ○ Deliver the trusted lo… │   ╭─▶│ ○ Implement workspace di… │────┬▶│ ○ Watch workspace change… │─┬──┬▶│ ○ Implement anchored Rev… │─────▶│ ○ Route GUI intent to pr… │─────▶│ ○ Unify Pi, runtime, pro… │─────▶│ ○ Harden trust, authenti… │─────▶│ ○ Build gateway integrat… │
  │ vsg-e57 P1                │   │  │ vsg-e57.2 P1              │ │  │ │ vsg-e57.3 P1              │ │  │ │ vsg-e57.5 P1              │   │  │ vsg-e57.8 P2              │      │ vsg-e57.10 P1             │      │ vsg-e57.11 P2             │      │ vsg-e57.12 P1             │
  └───────────────────────────┘   │  └───────────────────────────┘ │  │ └───────────────────────────┘ │  │ └───────────────────────────┘   │  └───────────────────────────┘      └───────────────────────────┘      └───────────────────────────┘      └───────────────────────────┘
                                  │                                │  │                               │  │                                 │
  ┌───────────────────────────┐   │  ┌───────────────────────────┐ │  │ ┌───────────────────────────┐ │  │ ┌───────────────────────────┐   │
  │ ○ Scaffold gateway serve… │─────▶│ ○ Implement strict Pi RP… │──┬─┼▶│ ○ Expose revision-safe e… │─╯╭─┼▶│ ○ Bridge Pi extension UI… │───╯
  │ vsg-e57.1 P1              │      │ vsg-e57.6 P2              │  │ │ │ vsg-e57.4 P1              │  │ │ │ vsg-e57.9 P2              │
  └───────────────────────────┘      └───────────────────────────┘  │ │ └───────────────────────────┘  │ │ └───────────────────────────┘
                                                                    │ │                                │ │
                                                                    │ │ ┌───────────────────────────┐  │ │
                                                                    ╰─┴▶│ ○ Manage Pi processes an… │────╯
                                                                        │ vsg-e57.7 P2              │
                                                                        └───────────────────────────┘

  Dependencies: 16 blocking relationships
  Total: 13 issues across 8 layers
```
