# Dentro i versi · long — version 1.0.0

Rewritten from CreativeStudio's `poesie-museo-long` standard (version 1.4.0;
references Il lampo, runtime v10; San Martino, v13; S'i' fosse foco, v15).
Compiler and validator: `dentro-i-versi-long@1.0.0`. Theme: `dentro-i-versi@1.0.0`.

## Standard

**The style is fixed, the direction is not (UP-61).** These stay the
references':
- rooms, characters, fonts, palette, layout and voices (the theme);
- the rhythm, the five chapters with their 4-second pauses, and the same
  sound theme at the opening and the end.

These are designed for each poem, in this episode's data:
- the story's phases;
- the note on the text;
- one figure tool per painting;
- the metre;
- the invitation;
- the summary;
- the effects and the sounds.

The rules shared with the short live once in the channel's `brand/`, not here:
- the voice follows the interpreter;
- the exact text on screen;
- measured pauses;
- the shared source (UP-57).

## Contract

- Italian; 1920×1080, 30 fps; 240–600 s.
- No host but the guide, no call to action.
- Loop: the last frame is the first (the atrio and the cover).
- Safe zone y 120–960; the glass panel 440/150/1060×596; the guide at the
  right, about x 1700; texts on full plates, never under 26 px.

## Structure

The opening in the atrio is followed by the announcement and the first recital. The blocks after it come in five chapters:

1. **I — Il contesto:** the story of the years (`story`) and the poem's
   genesis (`story`).
2. **II — La raccolta:** the note on the text (`note`), then one frame per
   painting, each a `specimen` with its figure tool (merge, cards, stack,
   oxymoron, simile).
3. **III — Metrica:** the metre (`meter`).
4. **IV — Riascolto:** the invitation (`invite`) and the annotated recital
   (`recital`, `annotated`).
5. **V — Considerazioni finali:** the summary (`summary`).

Then the exit to the atrio (`end`).

## Data

`episode-spec.json` holds the poem and its direction:
- `title`, `author`, `kicker`;
- `source`: the pinned short episode whose title and recital takes and
  paintings the lesson replays, unchanged;
- `verses`: text, strong words, figure;
- `pictures`: each painting and the verses it shows;
- `blocks`, in order;
- `sounds`.

Every time inside a block is a **cue**: seconds, `"end"`, or a word of the
block's guide take (`{word, n?, offset?}`). A cue that finds no word stops
compilation with `cue-not-found`. There is no hidden fallback: fix the data.

Each block's guide take is in `artifacts/narration/takes.json`, unit
`lesson`, aligned (`pva_register_take`, `pva_align_take`). The recitals'
takes are the source's.

## Procedure

1. Pin the source episode: `vpr pin`.
2. Draft the spec (`pva_init_spec`) and fill it.
3. Synthesize, register and align a guide take per block.
4. Build the timeline (`pva_build_timeline`) and check the series rules.
5. Make the layout sheet and read it; then `vpr sheet approve`.
6. Render: the render is audited, and becomes current only if it passes.
