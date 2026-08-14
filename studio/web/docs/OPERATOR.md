# Operator guide

## MVP operating model

Video Studio is a localhost companion to Pi. For the MVP, start production in Pi by defining a series, requesting an episode, running a stage, or generating assets. Open the studio to supervise the one active production, inspect generated artifacts and media, review blockers, and request corrections.

The application is desktop-first. A normal workspace contains 1 to 5 series and 10 to 15 episodes per series. A heavy workspace may contain 5 to 10 series and up to 100 episodes per series. Only one production is active at a time.

## Expected behavior

- The studio follows the operating-system light or dark theme.
- Workspace content remains inspectable when Pi is offline where gateway and filesystem policy permit it.
- Connection loss preserves the last confirmed projection in a clearly degraded or read-only state.
- Generated attempts remain visible after another attempt is selected.
- Paid actions, reruns, and material downgrades show their consequences before approval.
- A deliverable is labeled current only after required validation and dependency checks.

## Accessibility

The target is WCAG 2.2 AA. Production monitoring, navigation, media playback, review, approval, and rerun planning must work by keyboard. Reduced-motion preferences are respected, and production state never relies on color alone.

## Design context

The approved product and visual direction live in `PRODUCT.md`, `DESIGN.md`, and `docs/SHAPE-BRIEF.md`. Run `npm run check` to validate that this context remains complete before scaffolding or changing core information architecture.
