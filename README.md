# studio-graphics-renderer

Deterministic local renderer for text-critical visual assets.

## Owns

Code frames, architecture diagrams, flow diagrams, title frames, callouts, comparison layouts, simple charts, and infographic primitives rendered to SVG and PNG with reproducible typography and safe areas.

## Why separate from image generation

Generated images are useful for illustrations but unreliable for exact code, labels, diagrams, and localized text. This module gives documentation episodes a precise visual path and gives fairy tales deterministic titles and captions.

## Safety

Repository content is treated as data. The renderer does not execute source code or arbitrary HTML/JavaScript.

## Plan

Run `bd list`, `bd graph`, and `bd show <id>`.
