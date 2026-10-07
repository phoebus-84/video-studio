---
name: compare-versions
version: "0.1.0"
description: After a correction to a rendered episode, prove by pixel comparison that only the requested part changed
inputs:
  - name: episode
    type: string
    description: The channel/series/episode that was corrected and rendered again
  - name: old
    type: string
    description: The render the person received before the correction (its render id), or a golden reference of the series
  - name: sections
    type: string
    description: The sections the correction was meant to change
outputs:
  - reviews/compare/<old>--<new>/:
      kind: directory
      description: report.json with every pair measured and the verdict, pairs/ and changed.jpg (old | new | difference)
capabilities:
  - llm
---

# Compare Versions

A correction to an episode the person has already seen changes **only** what
they asked for; everything else stays identical (UP-54). That is shown, not
claimed: the new render is compared with the old one at the same instants —
the layout sheet's instants, carried section by section, so a block that got
longer does not make everything after it look different — and every frame
that differs is listed with its section.

## Steps

1. **Correct only the part asked for**, in the spec or the timeline, and
   render the new version (the render keeps its timeline beside the video).
2. **Compare** with `pva_compare_versions { channel, series, episode, old,
   expect }`: `old` is the render id the person received (from
   `output/`, or the render they named), `expect` the sections the
   correction should change — section ids, or a prefix with `*`.
3. **Read the verdict.**
   - `ok`: every difference is inside the expected sections. Open
     `changed.jpg` and check the differences are the ones asked for.
   - `unexpected changes`: the correction touched more than it should. Each
     `❌` line names the frame, its time and its section. Undo or narrow the
     change, render again, compare again.
   - A warning that an expected section did not change usually means the
     wrong render was compared, or the correction did not take.
4. **Report** to the person: the verdict, the frames that changed, and the
   path of `changed.jpg`.

## Never

- Never wave an unexpected change through, or widen `expect` to make one
  disappear: an improvement nobody asked for is proposed separately.
- Never compare against anything but the version the person received.
- Never raise the threshold to hide a difference; ask the person if a
  difference is noise.
