# Beads implementation plan

Epic: `vpr-qo0` — Deliver the deterministic filesystem pipeline runtime

Beads/Dolt is the issue source of truth. `.beads/issues.jsonl` is an inspectable export, not a backup.

```bash
bd status
bd list
bd graph --all
bd show vpr-qo0
```

## Current dependency graph

```text
📊 Dependency graph for vpr-qo0:

  Status: ○ open  ◐ in_progress  ● blocked  ✓ closed  ❄ deferred

  LAYER 0 (ready)                    LAYER 1                            LAYER 2                            LAYER 3                            LAYER 4                            LAYER 5                            LAYER 6                            LAYER 7                            LAYER 8                      

  ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐
  │ ○ Deliver the determinis… │   ╭─▶│ ○ Initialize and discove… │─────▶│ ○ Resolve system, channe… │─────▶│ ○ Freeze immutable episo… │───┬─▶│ ○ Implement stage state … │─────▶│ ○ Enforce approval and b… │───┬─▶│ ○ Plan targeted reruns a… │─────▶│ ○ Expose operator CLI an… │─────▶│ ○ Build runtime end-to-e… │
  │ vpr-qo0 P1                │   │  │ vpr-qo0.2 P1              │ │  │ │ vpr-qo0.3 P1              │      │ vpr-qo0.5 P1              │   │  │ vpr-qo0.8 P1              │   │  │ vpr-qo0.10 P2             │   │  │ vpr-qo0.11 P1             │      │ vpr-qo0.12 P2             │      │ vpr-qo0.13 P1             │
  └───────────────────────────┘   │  └───────────────────────────┘ │  │ └───────────────────────────┘      └───────────────────────────┘   │  └───────────────────────────┘   │  └───────────────────────────┘   │  └───────────────────────────┘      └───────────────────────────┘      └───────────────────────────┘
                                  │                                │  │                                                                    │                                  │                                  │
  ┌───────────────────────────┐   │  ┌───────────────────────────┐ │  │ ┌───────────────────────────┐      ┌───────────────────────────┐   │                                  │  ┌───────────────────────────┐   │
  │ ○ Scaffold runtime packa… │───┴─▶│ ○ Resolve pipeline inher… │────┴▶│ ○ Implement atomic revis… │─────▶│ ○ Implement append-only … │───┴─▶                             ─────▶│ ○ Build artifact depende… │───╯
  │ vpr-qo0.1 P1              │      │ vpr-qo0.4 P1              │      │ vpr-qo0.6 P1              │      │ vpr-qo0.7 P1              │                                         │ vpr-qo0.9 P1              │
  └───────────────────────────┘      └───────────────────────────┘      └───────────────────────────┘      └───────────────────────────┘                                         └───────────────────────────┘

  Dependencies: 17 blocking relationships
  Total: 14 issues across 9 layers
```
