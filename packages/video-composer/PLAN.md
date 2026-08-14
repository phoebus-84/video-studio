# Beads implementation plan

Epic: `fvc-0zz` — Deliver typed FFmpeg composition and delivery QA

Beads/Dolt is the issue source of truth. `.beads/issues.jsonl` is an inspectable export, not a backup.

```bash
bd status
bd list
bd graph --all
bd show fvc-0zz
```

## Current dependency graph

```text
📊 Dependency graph for fvc-0zz:

  Status: ○ open  ◐ in_progress  ● blocked  ✓ closed  ❄ deferred

  LAYER 0 (ready)                    LAYER 1                            LAYER 2                            LAYER 3                            LAYER 4                            LAYER 5                            LAYER 6                            LAYER 7                            LAYER 8                            LAYER 9                      

  ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐
  │ ○ Deliver typed FFmpeg c… │   ╭─▶│ ○ Validate timeline sema… │─────▶│ ○ Compile still scenes, … │─────▶│ ○ Compile cuts and trans… │───┬─▶│ ○ Compile segment-level … │─────▶│ ○ Build deterministic fi… │─────▶│ ○ Add render progress, c… │─────▶│ ○ Implement YouTube 1080… │─────▶│ ○ Generate render report… │─────▶│ ○ Build composition gold… │
  │ fvc-0zz P1                │   │  │ fvc-0zz.2 P1              │ │  │ │ fvc-0zz.4 P2              │ │  │ │ fvc-0zz.5 P2              │   │  │ fvc-0zz.7 P2              │      │ fvc-0zz.9 P1              │      │ fvc-0zz.10 P1             │      │ fvc-0zz.11 P2             │      │ fvc-0zz.12 P2             │      │ fvc-0zz.13 P1             │
  └───────────────────────────┘   │  └───────────────────────────┘ │  │ └───────────────────────────┘ │  │ └───────────────────────────┘   │  └───────────────────────────┘      └───────────────────────────┘      └───────────────────────────┘      └───────────────────────────┘      └───────────────────────────┘      └───────────────────────────┘
                                  │                                │  │                               │  │                                 │
  ┌───────────────────────────┐   │  ┌───────────────────────────┐ │  │ ┌───────────────────────────┐ │  │ ┌───────────────────────────┐   │
  │ ○ Scaffold composer pack… │───┴─▶│ ○ Probe and normalize he… │────┴▶│ ○ Compile narration, opt… │─╯  ╰▶│ ○ Compile deterministic … │───╯
  │ fvc-0zz.1 P1              │      │ fvc-0zz.3 P1              │      │ fvc-0zz.8 P2              │      │ fvc-0zz.6 P2              │
  └───────────────────────────┘      └───────────────────────────┘      └───────────────────────────┘      └───────────────────────────┘

  Dependencies: 16 blocking relationships
  Total: 14 issues across 10 layers
```
