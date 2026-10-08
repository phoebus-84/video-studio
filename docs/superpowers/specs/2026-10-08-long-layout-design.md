# The long lesson's layout, from its real sheet: dentro-i-versi-long compiler 1.1.0

**Issue:** `avg-dcf.6.9`, under `avg-dcf.6` (Il lampo long end to end).
**Builds on:**
- the long compiler 1.0.0 (`avg-dcf.6.3`);
- the new look (`avg-dcf.6.8`/`6.10`: sealed themes, `vpr template release`).

**Found by:** the long Il lampo's first real layout sheet (`avg-dcf.6.4`, 2026-10-08, Pi's report `reviews/assets-report.md`).

**Goal now:** test the capabilities and the architecture, not the best episode. These are the layout faults the sheet showed, fixed where they belong.

**Date:** 2026-10-08

## Problem

The sheet showed four faults. Each comes from one decision of compiler 1.0.0.

1. **Writing off the glass.**
   - The lesson's text stacks were placed as on CreativeStudio's stage: x 1420, 900 wide.
   - The panel ends at x 1500 and the guide stands at x 1700, so the text crosses the guide's body (#18: «NESSUNO SARÀ MAI CONDANNATO…») or sits on the white wall.
   - The kits draw light text meant for the dark glass, which nearly vanishes on the white room.
   - CreativeStudio's rule is that every writing stays inside the monitor that holds it. 1.0.0 doesn't check it.
2. **The note's tracks on the white room (#23).** The word tracks and counts are drawn with no panel behind them, in pale cyan on white.
3. **Titles over the subject (#40, #42, #43, #56, #57).**
   - A specimen's headline (OSSIMORO, SIMILITUDINE) sits at the panel's centre, which is where the painting's subject is (the house, the eye).
   - The annotated recital's figure titles sit at the top, over the storm.
4. **The panel's place is code.** `PANEL` is a constant in the compiler, while the theme already says where its panel is (`layout.panel`). That is the channel-specific code `avg-d1x` wants out.

## Decisions

1. **A new compiler version, `dentro-i-versi-long@1.1.0`.** 1.0.0 stays registered and unchanged, with its golden: a release pinned to it keeps compiling the same way.
2. **The panel comes from the theme.**
   - 1.1.0 reads `theme.layout.panel`, and falls back to 1.0.0's box when the theme has none.
   - The guide's place stays a stage constant, as in 1.0.0.
3. **Writing stays on the glass: `text-off-panel`.**
   - Every text stack the spec places (story texts, a note's counts, the quote's title) must fit the panel. `x ± width/2` for `center`, or `x … x + width` for `left`, must lie within the panel's x range. `y` must lie within its y range.
   - A stack that doesn't fit stops compilation with `text-off-panel` at its JSON path, naming the panel's box. There is no clamping: the data is fixed, as for `cue-not-found`.
4. **The note has its glass.** Under its tracks and counts, the note block draws the panel with no picture (an empty phase). The tracks then sit on dark glass, as the story texts do.
5. **Titles go in the panel's lower band.**
   - A specimen's headline and the annotated recital's figure titles sit at the panel's lower band: `y = panel.y + panel.h − 110`, centred.
   - The painting's subject, which these paintings keep central, stays clear.
6. **Il lampo's data is corrected, not the compiler bent.** In the fixture and the library spec, the text stacks are moved and narrowed onto the glass:
   - centre-aligned at x 1420 / 900 wide becomes x 1180 / 560;
   - a stack below the panel (y 780) moves up inside it.
7. **A template release can name a new compiler.** `vpr template release` gains `--compiler <version>` and `--validator <version>`. Each must be an exact `x.y.z` (`bad-version` otherwise). Whether it is registered is the loader's check at the first compile (`unknown-compiler`), since the runtime doesn't load `@studio/series`. The library's `dentro-i-versi-long@1.2.0` is 1.1.0 (theme `dentro-i-versi@1.1.0`) with compiler 1.1.0.
8. **The guide steps in.** At x 1700 a wide pose takes the guide's hand off the frame (sheet #16). 1.1.0 puts the guide at x 1650.
9. **A draft moves too** (a fix to `upgradeEpisodeSpec`, found by Pi's move of the short Il lampo, whose sounds are still `__FILL__`). A schema error on a value that is itself unfilled (an id's pattern refusing `__FILL__`) no longer stops the move.
10. **The golden.** `fixtures/dentro-i-versi-long/1.1.0/`: the release, pinned to compiler 1.1.0 and the fixture theme; `input.json`, 1.0.0's with the corrected data; and its `expected-timeline.json`.

## Testing

- **Compiler (series):**
  - 1.1.0's golden;
  - `text-off-panel` for a story text, a count and the quote's title, each at its path;
  - the panel from a theme's `layout.panel`, and 1.0.0's box without one;
  - the note's empty panel under its tracks;
  - headlines in the lower band;
  - 1.0.0's golden is unchanged.
- **Runtime:**
  - `vpr template release --compiler 1.1.0` writes it into the manifest;
  - a compiler or validator version that isn't exact is refused (`bad-version`).
- **Episode:**
  - a draft whose patterned fields are `__FILL__` upgrades.
  - the long golden compiles end to end on 1.1.0 (`divLongEpisode` gains the option of the 1.1.0 fixture).
- **Library:**
  - long 1.2.0 is released;
  - Il lampo is upgraded and its data corrected;
  - a new layout sheet goes to the person for review.

## Out of scope

- An episode's own atrio and monitor (CreativeStudio wants them per poem). A spec slot that overrides the theme's rooms is a follow-up.
- Layout rules the validator could check from pictures: a subject's position is not known to the studio.
- The short's compiler.
