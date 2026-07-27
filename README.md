# video-studio-web

Browser production studio for inspecting and steering every stage of an episode.

## Core surfaces

Channel and series library, pipeline/stage rail, editable editorial documents, scene timeline, asset attempt comparison, audio and video review, anchored comments, generation progress, staleness explanations, budget/provenance views, approvals, and targeted reruns.

## Product constraints

The GUI is a projection over the canonical workspace. Every mutation uses revision checks. It must remain useful while Pi is offline, expose errors and degraded states, support keyboard navigation and accessible media controls, and avoid hiding production history behind a chat-only interface.

Visual shape and brand decisions are intentionally deferred to a dedicated product-design brief before implementation.

## Plan

Run `bd list`, `bd graph`, and `bd show <id>`.
