# Beads implementation plan

Epic: `qtw-2af` — Deliver persistent local Qwen3-TTS narration

Beads/Dolt is the issue source of truth. `.beads/issues.jsonl` is an inspectable export, not a backup.

```bash
bd status
bd list
bd graph --all
bd show qtw-2af
```

## Current dependency graph

```text
📊 Dependency graph for qtw-2af:

  Status: ○ open  ◐ in_progress  ● blocked  ✓ closed  ❄ deferred

  LAYER 0 (ready)                    LAYER 1                            LAYER 2                            LAYER 3                            LAYER 4                            LAYER 5                            LAYER 6                            LAYER 7                            LAYER 8                      

  ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐
  │ ○ Deliver persistent loc… │   ╭─▶│ ○ Implement model regist… │────┬▶│ ○ Implement warm model l… │─────▶│ ○ Implement persistent s… │─────▶│ ○ Implement preset Custo… │─┬──┬▶│ ○ Produce canonical WAVs… │─────▶│ ○ Add resource limits, c… │─────▶│ ○ Publish client SDK and… │─────▶│ ○ Build fake and Apple-S… │
  │ qtw-2af P1                │   │  │ qtw-2af.2 P1              │    │ │ qtw-2af.3 P1              │      │ qtw-2af.4 P1              │ │  │ │ qtw-2af.6 P2              │ │  │ │ qtw-2af.9 P1              │      │ qtw-2af.10 P2             │      │ qtw-2af.11 P2             │      │ qtw-2af.12 P1             │
  └───────────────────────────┘   │  └───────────────────────────┘    │ └───────────────────────────┘      └───────────────────────────┘ │  │ └───────────────────────────┘ │  │ └───────────────────────────┘      └───────────────────────────┘      └───────────────────────────┘      └───────────────────────────┘
                                  │                                   │                                                                  │  │                               │  │
  ┌───────────────────────────┐   │  ┌───────────────────────────┐    │                                                                  │  │ ┌───────────────────────────┐ │  │
  │ ○ Scaffold Python servic… │───┴─▶│ ○ Normalize and chunk na… │────┴▶                             ─────▶                             ─┼──┴▶│ ○ Implement VoiceDesign … │─┼──╯
  │ qtw-2af.1 P1              │      │ qtw-2af.5 P1              │ │                                                                     │    │ qtw-2af.7 P2              │ │
  └───────────────────────────┘      └───────────────────────────┘ │                                                                     │    └───────────────────────────┘ │
                                                                   │                                                                     │                                  │
                                                                   │                                                                     │    ┌───────────────────────────┐ │
                                                                   ╰───▶                             ─────▶                             ─┴───▶│ ○ Implement voice clonin… │─╯
                                                                                                                                              │ qtw-2af.8 P2              │
                                                                                                                                              └───────────────────────────┘

  Dependencies: 16 blocking relationships
  Total: 13 issues across 9 layers
```
