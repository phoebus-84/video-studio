---
name: review-layout-sheet
version: "0.1.0"
description: Make an episode's layout sheet and read it tile by tile for layout mistakes before a render is spent
inputs:
  - name: episode
    type: string
    description: The channel/series/episode whose checked timeline is about to be rendered
outputs:
  - layout-sheet.json:
      kind: application/json
      description: artifacts/layout-sheet/sheet.json, with sheet.jpg and frames/ beside it — what the sheet shows and the inputs hash that says when it is stale
capabilities:
  - llm
---

# Review Layout Sheet

A render costs minutes; most layout mistakes are visible in a still. The
layout sheet is a grid of small stills of the timeline a render would use, at
instants chosen the same way every time: the first and last frame, a spread
over the sections, and the instants the series' template release declares.
Each tile says its number, its time (`mm:ss.ff`) and why it was picked. This
is the `sheet` stage of the `series-production` pipeline; a person approves
it at its gate, and the render refuses a sheet that no longer shows exactly
what it would render.

## Steps

1. **Make it** with `pva_layout_sheet { channel, series, episode }`. It
   refuses a timeline that breaks the series' rules: fix those first
   (`pva_check_episode`).
2. **Open the grid** at the path the tool gives (`…/artifacts/layout-sheet/sheet.jpg`).
   For a tile you cannot read at that size, open its still in `frames/`
   (`frames/007.jpg` is tile `#07`).
3. **Read every tile**, in order, against this list:
   - no text over a face or over the picture's subject;
   - no two texts overlapping, and no text outside the margins;
   - no figure or object covering a text;
   - hands and objects inside the frame at the peak of a gesture;
   - titles at their size, captions saying what the voice says at that time;
   - no empty, black or wrong picture where the section needs one.
4. **Report** each problem with its tile number, its time and what is wrong
   (`#07 · 00:03.07 — the caption covers the cup`), then what to change (the
   spec, a picture, or the timeline). Report the tool's warnings too: an
   instant the series declares that fell outside its section usually means a
   section was shortened by hand.
5. **Hand it over** at the stage's review gate. A sheet with no problem
   found still needs a person's look — unless the operator set
   `sheet.approval: auto` in the series' (or channel's) `settings.yaml`
   (`pva_layout_sheet` says which). Then your reading stands for theirs:
   record it with `pva_record_sheet_reading`, every problem from step 4 in
   `problems` (`[]` only when you read every tile and found none). With
   problems the render refuses the sheet: stop there and tell the operator
   what you found and what you propose to change.

## Never

- Never approve the sheet yourself, or say the layout is fine without
  having opened the grid. `pva_record_sheet_reading` is not an approval of
  yours: it records your reading where the operator's setting asks for it,
  and only then.
- Never write `sheet.approval` into a settings.yaml: it is the operator's.
- Never edit `sheet.json`, the stills or the grid: an image that is not the
  one rendered makes the render refuse the sheet.
- Never render to "see it moving" instead: the sheet is the cheap look.
