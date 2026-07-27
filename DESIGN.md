---
name: Video Studio
description: A precise localhost production workbench for supervising and correcting agent-created video.
---

<!-- SEED: re-run impeccable document once implementation exists to capture actual tokens and components. -->

# Design System: Video Studio

## Overview

**Creative North Star: "The Provenance Workbench"**

Video Studio should feel like a well-kept technical workbench where every production object has a place, a state, and a history. The structure is as legible as a source tree, while media receives the focused inspection space of an editing suite. The interface remains calm during long-running generation and becomes assertive only when a decision, blocker, conflict, or material consequence requires attention.

The default follows the operating-system theme because the creator may work across changing ambient light during long desktop sessions. Light and dark themes are peers, not separate brands. Both use restrained tinted neutrals, a rare oxide-orange accent, and semantic state colors with non-color reinforcement.

The system rejects ChatGPT-style chat dominance, Monday.com-style colorful card grids, generic SaaS hero metrics, decorative AI imagery, glassmorphism, and ornamental motion.

**Key Characteristics:**
- Desktop-first, dense, and structurally predictable
- Filesystem hierarchy paired with focused media inspection
- Restrained color with explicit semantic state
- History, provenance, and consequence visible at the point of action
- Fast keyboard navigation with stable focus and selection
- Responsive state transitions without decorative choreography

## Colors

The palette is restrained. Tinted neutral surfaces carry nearly the entire interface; muted oxide orange identifies primary actions, current selection, and active focus. Exact color tokens will be resolved and contrast-tested when the application scaffold establishes both operating-system themes.

### Primary
- **Muted Oxide:** Reserved for the current actionable selection, primary confirmation, and focused production context. It must not decorate passive surfaces or compete with warnings and failures.

### Neutral
- **Paper Alloy:** The light-theme content plane, subtly warm rather than pure white.
- **Graphite Alloy:** The dark-theme content plane, softened rather than pure black.
- **Workbench Layers:** Small tonal steps distinguish navigation, canvas, inspector, editor, and transport regions without surrounding every region with a card.
- **Structural Lines:** Low-contrast separators clarify resizable regions, timelines, rows, and grouped metadata.

### Semantic
- **Running:** A distinct informational state for work currently executing.
- **Needs Attention:** A caution state for approval, budget, or recoverable intervention.
- **Blocked:** A high-priority state for failures or policy stops.
- **Current:** A success state used only when validation and dependency status justify it.
- **Stale:** A non-destructive state that explains outdated dependencies without resembling failure.

**The Rare Signal Rule.** Accent and semantic colors communicate selection or production meaning. They never fill inactive navigation, decorate containers, or create a rainbow of status chips.

**The State Is More Than Color Rule.** Every state pairs color with text, iconography, shape, position, or progress semantics.

## Typography

**Display Font:** Operating-system sans-serif stack
**Body Font:** Operating-system sans-serif stack
**Label/Mono Font:** Platform monospace stack

**Character:** Native, compact, and highly legible. The sans-serif hierarchy lets the tool disappear into the operating system; monospace is reserved for paths, IDs, revisions, timecodes, structured values, and logs.

### Hierarchy
- **Headline:** Semibold and compact for episode identity and the current artifact, never oversized.
- **Title:** Medium or semibold for sections, stage names, and inspector groups.
- **Body:** Regular for editorial context and explanations, capped near 70 characters for prose.
- **Label:** Medium with restrained size contrast for controls and metadata. Uppercase is reserved for short technical abbreviations.
- **Mono:** Regular for machine identity and timing. It does not replace body copy.

**The Native Instrument Rule.** Use one system sans family across product controls. Do not introduce display typography into labels, navigation, editors, or production data.

**The Evidence Rule.** Use monospace only when character alignment or literal machine identity helps the creator verify evidence.

## Elevation

The studio is flat by default. Depth comes from tonal layering, structural dividers, sticky positioning, and controlled overlap. Shadows appear only when a floating element genuinely crosses another plane, such as a command palette, menu, tooltip, or dragged comparison divider.

**The Structural Depth Rule.** Persistent regions are separated by tone and geometry, not stacks of shadows or nested cards.

**The Temporary Lift Rule.** Elevation communicates temporary spatial behavior. If an element is not floating, it receives no floating shadow.

## Components

No production components exist yet. The scaffold must establish one consistent vocabulary for buttons, fields, tree rows, stage rows, status indicators, media transport controls, tabs, split panes, inspectors, inline notices, menus, and approval surfaces. Every interactive component requires default, hover, focus, active, disabled, loading, error, and reduced-motion behavior where applicable.

Buttons should remain compact and familiar. Lists and trees should prioritize stable alignment, clear nesting, and generous target sizes without turning every row into a card. Inputs should expose validation near the exact field or line. Status indicators must combine concise labels with icons or structural cues. Consequential actions must preview cost, staleness, preservation, and reversibility inline before confirmation.

The application shell uses a persistent structural region, a focused work canvas, and a contextual inspector. Secondary regions may collapse or resize, but current production identity and blocker state remain accessible. Modal dialogs are reserved for short, blocking decisions that cannot be understood safely inline.

## Do's and Don'ts

### Do:
- **Do** keep the active production, current stage, blocker state, and current deliverable legible without opening a dialog.
- **Do** use familiar trees, lists, timelines, inspectors, diffs, transport controls, and command navigation.
- **Do** preserve selection, focus, editor state, and scroll position across live updates and reconnects.
- **Do** show immutable attempts, provenance, cost, revision, and downstream consequence at the point where the user chooses or reruns work.
- **Do** make both operating-system themes first-class and meet WCAG 2.2 AA in each.
- **Do** favor inline expansion and contextual inspectors before introducing modal workflows.

### Don't:
- **Don't** imitate ChatGPT by making conversation the primary representation of production.
- **Don't** imitate Monday.com with colorful card-grid clutter or decorative status widgets.
- **Don't** use generic SaaS hero metrics, nested cards, excessive empty space, or detached summary panels.
- **Don't** use decorative AI styling, neon gradients, glowing orbs, glass surfaces, animated agent avatars, or gradient text.
- **Don't** use colored side-stripe borders as accents on cards, list rows, callouts, or alerts.
- **Don't** hide offline, partial, stale, conflicting, unavailable, cancelled, or materially downgraded states behind optimistic fallback content.
- **Don't** animate layout properties or add motion that does not explain state.
