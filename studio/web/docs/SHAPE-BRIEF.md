# Video Studio MVP Shape Brief

Status: Approved

Approved by the project owner on 2026-07-27 after an interactive discovery review. This approval unblocks application scaffolding under `vsw-pbt.2`.

## 1. Feature Summary

Video Studio is a production-ready desktop web application for a technical solo creator supervising agent-directed video production on localhost. Creation begins in Pi; the studio projects the canonical workspace so the creator can monitor autopilot, inspect structured artifacts and media, review immutable attempts, understand blockers and staleness, and request precise corrections without navigating production as a chat transcript.

The default experience optimizes for exception supervision. It also supports hands-on work at any granularity, from one stage or script revision to one asset, narration segment, review anchor, or rerun plan.

## 2. Primary User Action

Understand whether the active production is progressing safely or requires intervention, then reach the exact artifact, media attempt, blocker, or corrective action with minimal context switching.

## 3. Design Direction

**Register:** Product

**Color strategy:** Restrained. Tinted neutral surfaces dominate; muted oxide orange marks current selection and primary action. Semantic colors are scarce and reserved for running, attention, blocked, current, and stale states. Every state has a non-color cue.

**Theme scene:** A technical solo creator uses the localhost studio on a large desktop monitor throughout a focused production session while ambient light changes during the day. The interface follows the operating-system theme so both light and dark modes remain comfortable, consistent, and fully capable.

**Creative North Star:** The Provenance Workbench

**Anchor references:**
- Linear for restrained hierarchy, responsiveness, and keyboard fluency
- DaVinci Resolve for focused media inspection and persistent production context
- VS Code for hierarchical structure, adaptable panes, technical density, and familiar keyboard navigation

**Anti-references:**
- ChatGPT for chat-dominated interaction
- Monday.com for colorful card-grid clutter
- Generic SaaS dashboards and decorative AI styling

**Visual probe:** Skipped because the current harness has no native image-generation capability. No external API or one-off image tooling is required for this design task. The first executable visual check will use deterministic browser screenshots from fixture data after the scaffold exists.

## 4. Scope

- **Fidelity:** Production-ready
- **Breadth:** The complete desktop MVP surface and its connected core journeys
- **Interactivity:** Shipped-quality browser application, not a static mock or isolated prototype
- **Time intent:** Build incrementally to release quality, preserving the approved information architecture and design context across modules
- **Responsive target:** Desktop-first. Large desktop and laptop layouts support all MVP actions. Narrow layouts may prioritize monitoring, playback, approval, and comments; full small-screen editing is not an MVP requirement.
- **Accessibility target:** WCAG 2.2 AA, complete keyboard journeys, reduced motion, non-color state cues, and accessible media controls

## 5. Layout Strategy

The desktop shell uses three persistent layers of context rather than a dashboard of cards:

1. **Structure region:** A hierarchical channel, series, episode, and production tree. It exposes the current location, episode state, malformed or unavailable entries, search, and recent activity. The structure remains stable across live updates.
2. **Production canvas:** The dominant region. It changes with the selected stage or artifact and gives media, editorial content, storyboard, timeline, diff, or render playback enough space to be inspected properly.
3. **Contextual inspector:** A resizable or collapsible region for provenance, attempt history, parameters, revisions, validation findings, comments, cost, and actions related to the current selection.

Episode identity, approval mode, budget posture, connectivity, current deliverable, and consequential blockers form a compact persistent frame. The pipeline stage rail remains visible near the production canvas, showing current stage, progress, gates, attempts, stale paths, and failures without requiring a modal.

The hierarchy favors one active production. Global library structure is secondary once an episode is open; current work and required intervention dominate. Secondary details expand in place or appear in the inspector. Chat appears only as contextual agent activity attached to an episode, stage, action, or review thread.

## 6. Key States

### Library and entry
- **No discovered workspace:** Explain that creation begins in Pi and show gateway/root diagnostics.
- **No active production:** Preserve the library and current deliverables; explain how to start work in Pi.
- **Malformed or unavailable episode:** Keep it visible in the hierarchy with exact diagnostics and repair guidance.
- **Large library:** Search and filtering remain responsive without losing hierarchy or selection.

### Connection and synchronization
- **Initial loading:** Use structural skeletons that preserve expected layout.
- **Live and synchronized:** Show a quiet connection state without persistent celebration.
- **Reconnecting:** Preserve the last confirmed projection in read-only form and explain that actions are paused.
- **Gateway offline:** Keep cached workspace inspection usable where possible; expose reconnection details.
- **Pi offline:** Keep workspace review and safe direct editing available; queue nothing ambiguously.
- **Resynchronizing:** Reconcile snapshot and events without duplicate actions or resetting focus, scroll, playback, or editor state.

### Production execution
- **Queued, running, polling, and settling:** Show the exact stage or capability, meaningful progress, elapsed time, cancellation availability, and known cost context.
- **Partial success:** Preserve successful segments or assets and identify only the failed subset.
- **Cancelled:** Distinguish operator cancellation from failure and show what remains usable.
- **Blocked:** State attempted action, cause, consequence, available recovery options, and recommendation.
- **Approval required:** Present budget, capability, licensing, safety, or material-downgrade evidence before the decision.
- **Completed and current:** Mark a deliverable current only after validation and dependency checks pass.

### Editing and review
- **Clean, dirty, saving, saved:** Keep revision identity and validation status visible.
- **Validation failure:** Point to the exact field or line when available and preserve the unsaved edit.
- **Revision conflict:** Preserve both versions and provide a three-way resolution path without destructive overwrite.
- **Stale dependency:** Explain the dependency path, affected outputs, preserved expensive work, and rerun choices.
- **Missing or corrupt media:** Retain provenance and attempt metadata while offering repair or regeneration.
- **No attempts, one attempt, and multiple attempts:** Scale from an explicit empty state to keyboard-accessible comparison without changing the underlying mental model.
- **Open, resolved, and reopened review threads:** Keep anchors tied to the artifact revision, scene, asset, segment, frame, or timecode.

## 7. Interaction Model

- Creation starts in Pi for the MVP. The studio discovers and opens the resulting series and episode projection.
- The user reaches the active episode through the hierarchy or a prominent current-production entry, then navigates stages with pointer, keyboard, or command navigation.
- Selecting a stage updates the production canvas while preserving the shell. Selecting an artifact, scene, asset attempt, narration segment, or render updates the contextual inspector.
- Asset attempts remain immutable. Selection changes a pointer and previews downstream staleness before confirmation.
- Editorial saves use revision checks. Conflicts open an inline or dedicated resolution workspace, not a destructive overwrite prompt.
- Comments anchor to the selected artifact range, scene, asset, narration segment, frame, or timecode. Sending feedback to Pi clearly distinguishes queued, running, and settled agent actions.
- Rerun actions begin with a plan showing affected and preserved work, capability needs, budget impact, approvals, and current-deliverable consequences.
- Live updates patch production state without replacing the current editor buffer, media position, scroll, focus, selection, or open comparison.
- Hover provides supplementary metadata only. Every action and explanation remains available through keyboard focus and touch-capable controls.
- Motion lasts roughly 150 to 250 milliseconds, uses ease-out curves, and communicates state changes only. Reduced-motion mode removes nonessential transitions.

## 8. Content Requirements

The interface needs concise, consistent language for:

- Production status: queued, running, awaiting review, blocked, cancelled, failed, completed, current, stale, and accepted stale
- Connectivity: gateway connected, reconnecting, offline, Pi unavailable, provider unavailable, and model unavailable
- Revision state: revision ID, dirty, validating, saving, saved, conflict, and externally updated
- Attempts: attempt identity, selected state, source revision, prompt, references, provider/model, parameters, dimensions, duration, cost, license, and file availability
- Consequences: what will change, what will become stale, what remains preserved, estimated cost slot, approval impact, and reversibility
- Recovery: specific cause, recommended option, alternatives, and links to relevant diagnostics
- Review: anchor description, artifact revision, author, status, agent queue state, response, and resulting stage attempt

Dynamic ranges include 1 to 10 series, 10 to 100 episodes per series, one active production, multiple pipeline stages, and 1 to 5 asset attempts per scene. Lists must handle missing titles, long paths, international text, long diagnostic messages, and unavailable local media without collapsing the hierarchy.

Copy never says only “Something went wrong.” It identifies the failing component and gives a safe next action. Paid work never appears as an unexplained indeterminate spinner. Material downgrade language is explicit and requires affirmative approval.

## 9. Recommended References

Implementation should load these design references when relevant:

- `product.md` for familiar, state-complete product components
- `spatial-design.md` for the three-region workspace and resizable production canvas
- `interaction-design.md` for selection, revision-safe editing, comments, approvals, and action feedback
- `cognitive-load.md` for exception supervision and progressive disclosure
- `responsive-design.md` for desktop-first structural adaptation
- `color-and-contrast.md` for dual-theme semantic state and WCAG contrast
- `typography.md` for dense system-sans and monospace hierarchy
- `motion-design.md` for live-update and progress transitions
- `ux-writing.md` for blockers, conflicts, degraded states, and rerun consequences
- `harden.md` and `audit.md` before release

## 10. Open Questions

These are implementation choices that do not block approval of the shape:

1. The exact oxide-orange and neutral token values must be selected and contrast-tested in both themes during the scaffold task.
2. The initial desktop breakpoint and minimum supported viewport should be verified against realistic storyboard, diff, and media-inspection fixtures.
3. The stage rail may use a horizontal or compact vertical form depending on measured stage count and canvas pressure; both must preserve keyboard order and blocker visibility.
4. Narrow-layout monitoring behavior should be validated after the desktop shell is usable, without expanding the MVP into full mobile editing.
