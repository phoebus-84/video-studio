# Browser projection contract

The browser is a projection over the canonical workspace. It does not own production truth, unrestricted filesystem access, credentials, provider selection, Pi processes, or pipeline execution state.

## Trust boundary

The browser connects only to the trusted Agent Gateway. The gateway restricts allowed roots, authenticates the local session, validates revisions, owns Pi RPC processes, and translates canonical records into versioned HTTP and event contracts. Browser code never reads arbitrary local paths or receives provider credentials.

## Mutation rules

- Editorial writes carry the last observed revision or ETag.
- A stale write returns a structured conflict and preserves both versions.
- Generated media attempts are immutable.
- Selecting an attempt changes an explicit pointer rather than overwriting history.
- Feedback anchors identify the target artifact and revision, scene, attempt, segment, frame, or timecode as applicable.
- Consequential actions return or request a preview of affected work, preserved work, staleness, cost slots, and approval impact.
- The browser never treats a locally optimistic state as canonical confirmation.

## Event rules

Snapshot and event delivery may disconnect, duplicate, or resume. The client reconciles by stable identity and event identity, then converges to a fresh gateway snapshot. Reconciliation must preserve local editor buffers, selection, focus, scroll position, and media playback position whenever safe.

## Degraded operation

Pi availability, gateway connectivity, runtime health, provider health, model availability, and local media availability are distinct states. The interface exposes them independently. It does not substitute capabilities or label a partial or materially downgraded result as equivalent success.

The generated API and event schemas will be established in `vsw-pbt.2`. Hardcoded browser models must not drift from released gateway and workspace contracts.
