# Product

## Register

product

## Users

The primary user is a technical solo creator who is comfortable with Pi, terminal workflows, structured production artifacts, file hierarchies, pipeline stages, revision history, and provider diagnostics. They work locally on a desktop computer and use the studio during focused video-production sessions.

The user starts creation in Pi. They may define a series, request a complete video, run one stage, generate assets for an existing script, or review and correct prior work. The browser studio is a localhost companion for inspecting the resulting structure and media, supervising execution, and steering corrections.

A typical library contains 1 to 5 series with 10 to 15 episodes each. A heavy library contains 5 to 10 series with up to 100 episodes each. Only one production is active at a time. A scene typically has 1 to 5 immutable asset attempts.

## Product Purpose

Video Studio makes an agent-directed production legible and correctable without reducing it to a chat transcript. It projects the canonical filesystem workspace into a production-ready desktop interface where the creator can watch autopilot, inspect artifacts and media, understand blockers and staleness, compare immutable attempts, leave anchored feedback, and request precise reruns.

The default operating mode is exception supervision. A creator should be able to understand what Pi is doing, whether intervention is required, what an action will cost or invalidate, and which deliverable is current without continuously managing the pipeline. When deeper control is wanted, the same interface must support hands-on review at the stage, artifact, scene, asset, narration-segment, and render-attempt levels.

Success means the creator can trust unattended progress, find consequential state quickly, inspect any generated result with its provenance, and make a correction without losing history or accidentally rebuilding unaffected work.

## Brand Personality

**Precise, calm, trustworthy.**

The studio speaks like a capable production instrument. Copy is concise, factual, and specific about state, cause, consequence, and available recovery. It avoids hype, anthropomorphic theatrics, and false reassurance. Dense information is welcome when it supports a decision, but hierarchy must keep the current production state immediately legible.

## Anti-references

- **ChatGPT:** the studio must not make a chat transcript the primary navigation or representation of production.
- **Monday.com:** the studio must not become a colorful grid of interchangeable cards, badges, and decorative status widgets.
- Generic SaaS dashboards with hero metrics, nested cards, excessive empty space, or detached summary panels.
- Decorative AI styling such as neon gradients, glowing orbs, glass surfaces, and animated agent avatars.
- Media tools that hide provenance, attempt history, errors, costs, or destructive consequences behind optimistic controls.
- Interfaces that silently substitute a lower-quality capability, overwrite generated history, or obscure offline and degraded states.

## Design Principles

1. **Production state before conversation.** The episode, pipeline, artifacts, attempts, blockers, and current deliverable form the primary information architecture. Agent conversation is contextual evidence and an action channel, not the product shell.
2. **Supervise by exception, inspect on demand.** Keep the active stage, meaningful progress, and required intervention prominent. Reveal detailed parameters, logs, provenance, and history progressively without hiding them.
3. **Show history and consequence.** Immutable attempts remain visible. Every edit, selection, approval, and rerun states what changed, what becomes stale, what is preserved, and what it may cost before execution.
4. **Use familiar technical affordances.** Borrow the structural clarity and keyboard fluency of Linear and VS Code, plus the media-inspection discipline of DaVinci Resolve. Do not invent novel controls where a tree, list, timeline, inspector, diff, or transport control already communicates well.
5. **Be honest under failure.** Offline Pi, disconnected gateway, missing models, provider errors, corrupt media, revision conflicts, and partial results remain visible with specific recovery choices. A degraded result is never presented as equivalent success.

## Accessibility & Inclusion

The MVP targets WCAG 2.2 AA. All primary journeys must be operable by keyboard, including stage navigation, media playback, attempt selection, comments, approvals, and rerun planning. Focus is always visible and logical. Status never depends on color alone. Text and controls meet contrast requirements in both operating-system themes.

Motion respects reduced-motion preferences and communicates state rather than decoration. Media controls expose accessible names, captions, time position, duration, and playback state. Long sessions require readable density, predictable layouts, resizable or collapsible secondary regions, and preservation of focus, scroll, editor state, and selection during live updates.
