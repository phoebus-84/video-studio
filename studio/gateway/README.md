# video-studio-gateway

Trusted local backend connecting browser clients, Pi RPC, and filesystem production state.

## Owns

Pi RPC process lifecycle, strict JSONL framing, session-to-episode association, contextual prompt/steer/follow-up routing, extension UI bridging, workspace read APIs, revision-safe edits, review threads, file watching, projections, authentication, and WebSocket/SSE delivery.

## Boundary

The gateway does not make creative decisions and does not replace the pipeline runtime. The browser never receives Pi credentials, provider secrets, or unrestricted filesystem access.

## Plan

Run `bd list`, `bd graph`, and `bd show <id>`.
