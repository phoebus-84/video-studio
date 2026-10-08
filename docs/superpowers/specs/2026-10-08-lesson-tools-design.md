# The lesson's teaching tools: narrative tools, figure tools, metre

**Issues:** `avg-dcf.4.2` and its children `avg-dcf.4.2.1` (narrative tools) and `avg-dcf.4.2.2` (figure tools and metre), done in one run
**Epic:** `avg-dcf` — test channel "Dentro i versi" (the `cs-port` plan)
**Builds on:**
- the lesson stage: channel themes, `look`, fonts by family, `font-metrics`, `lesson-stage`, and the ten neutral 16:9 kits (`avg-dcf.4.1`, ADR-0040);
- frozen kit libraries (ADR-0039).

**Unblocks:** `avg-dcf.6` (Il lampo long end to end: the long compiler places these kits)
**Source:** `../CreativeStudio/formats/poesie-museo-long/runtime/v10/index.tsx` (`StoryScene`, `Scheda`, `Specimen` and its `Progress`, `Meter`, `Card`, `Summary`), `ui.tsx` (`HStack`, `HItem`, `SciTimeline`, `GlassChip`, `Tag`, `Light`, `Shatter`), `fx7.tsx` (`IrisLive`), `components.json`. Read only; nothing copied.
**Date:** 2026-10-08

## Problem

The long lesson teaches through about 700 lines of CreativeStudio code:
- story scenes for the historical context and the genesis;
- the note on the text, with its word tracks and an interlinear translation;
- one tool per picture of the poem, chosen by its rhetorical figure;
- the metre lesson;
- the invitation to listen again;
- the summary.

None of this exists as a kit. CreativeStudio draws each scene in one function: glass, texts, effects and sounds together, with Italian words such as «PESO», «SILENZIO» and «SILLABE METRICHE» written into the code.

## Decisions taken with the user

1. **Two parts, done in one run:** one spec, one plan, one branch and PR, one commit per piece.
   - the narrative tools (`avg-dcf.4.2.1`);
   - the figure tools and the metre (`avg-dcf.4.2.2`).
2. **Layers the compiler places.** Each CreativeStudio scene breaks into kit items with their own times. The panel's backgrounds, the text stacks and the effects are separate kits. The figure tools draw their panel themselves, because their effects work on the picture itself. Verse bars, figure titles and the guide's close-ups stay the stage's items.
3. **One kit per tool**, each with its own version lifecycle.
4. **Channel-neutral**, as for the stage (ADR-0040): every kit takes `look`, and every text is a prop.
5. **The science bridge stays out** (CreativeStudio's light-and-sound demonstration for «tacito»). Each poem's bridge is its own demonstration. Once the needed bridges are known, they can become kits.

## Design

### 1. Shared drawing: `lib/lesson-tools/1.0.0.tsx`

A frozen library module, holding what several tools draw:

| Piece | What it is |
|---|---|
| `GlassChip` | A chip of text on dark glass with an accent line, and an optional second line |
| `Tag` | A minimal label with a dash |
| `LightTitle` | A title that lights up: its tracking closes and it fades in |
| `wavePath` | A calm or agitated wave |
| `Eyelids` | Eyelids that close over a point |
| `IrisLive` | Copies of the picture masked to the iris and pupil, turning and breathing, around the measured centre |
| `Shards` | A picture breaking into triangles that fly into the room |
| `Wind` | Leaves and streaks |
| `Smoke` | Smoke |
| `coverPoint` | Where a point of a picture (0–1) lands once framed as `Cover` frames it (object-fit cover, focus, zoom), given the picture's aspect |
| `fitLine` | The largest size at which lines fit their room with their letter spacing and their plate's padding, border and shadow |
| `PictureSchema`, `PANEL` | The figure tools' picture `{src, focus?, aspect?}` (aspect = width / height, default 4/3) and the panel's default box |

Colours come from the look's roles; SVG ids are unique per instance.

### 2. The kits

All of them:
- are `1.0.0`, except `panel@1.1.0`;
- are drawn for `youtube-1920x1080`;
- take `look`;
- give times in seconds from the item's start;
- fit every single-line text to the room it has (`fitSize`).

Colours given in props name a look role (`text`, `accent`, `highlight`, `glow`, `lightning`, `signal`).

**Narrative (`avg-dcf.4.2.1`)**

| Kit | Layer | Props (besides `look`) |
|---|---|---|
| `panel@1.1.0` | fill | As 1.0.0, with each phase's content a list of `layers`, stacked (see below) |
| `text-stack` | overlay | `x`, `y` (or `bottom`), `width?` (900), `align?`, `gap?`, and `items` (see below) |
| `timeline` | fill | `box`, and either `axis {from, to, marks: {label, at}[]}` or `stops {items: {label, sub?, at}[], lineFrom?}` (see below) |
| `story-fx` | fill | `effects` (see below), positions inside the panel box |
| `word-tracks` | fill | `box`, `lines` (the verses' text), `read: [from, to]`, `point?`, `merge?` (see below) |
| `interlinear` | overlay | `x`, `y`, `width`, `words: {text, gloss, at, glossAt}[]`, `strike?: {indices, at}` (see below) |
| `monitor-wall` | fill | `box?`, `cells: {src, focus?, kind: picture \| clip}[]` (1–8), `appear?`, `caption: {text, at, color?}[]` (see below) |
| `summary` | fill | `x?`, `y?`, `rows: {src, focus?, keyword, figure, at}[]` (1–8), `closing?: {text, at}`, `lit?` (see below) |
| `progress` | overlay | `box?`, `steps: {label}[]` (1–8), `current`, `done` (see below) |

- **`panel` layers**: each layer is one of
  - `picture {src, focus?, zoom?, push?}`;
  - `split {items: {src, focus?, at?, label?}[2–4], gap?, sign?}`;
  - `clip {src, live?, push?}`;
  - `grid {at?}`;
  - `dark {amount}`;
  - `portrait {src, width?, focusY?, dark?}`;
  - `framed {src, box?, at?, focus?, push?}`.

  Each layer may take `shade?` (`left` | `left-strong` | `quote` | `storm` | an amount) and `dim?: {at, amount}`. The glass turns between phases. Texts are separate items, so the compiler hides them during a turn through their own `until` and `at` (CreativeStudio hid them over `[turn − 0.95, turn + 0.2]`).
- **`text-stack` items**: each item is one of
  - `{kind: big | year | title | chip | quote | kicker | note, text, at, until?, size?, color?, wrap?}`;
  - `{row: items[], gap?}`;
  - `{space: px}`.

  Space is reserved from the start, so items never overlap. Plates are full under titles, quotes and notes.
- **`timeline` modes**:
  - `axis`: a light thread, a tick every 5 years, stops lighting up, labels above and below on as many lines as they need not to touch, a cursor;
  - `stops`: dots with label and sub-label, the line drawing out.
- **`story-fx` effects**:
  - `{people: {at, total?, lit?, extra?: {at}, x0?, y?, step?}}`;
  - `{arc: {at, path: [x0, y0, cx, cy, x1, y1], color?}}`;
  - `{badge: {text, x, y}}`;
  - `{bolt: {strikes, path?, seed?}}`;
  - `{lightline: {at, until, path?}}`.
- **`word-tracks`**: one track per verse and one pill per word, as long as the word. Punctuation is light: a comma one dot, a semicolon or colon two, a full stop that glows and rings from `point`. The cursor reads over `read`, and the tracks merge into one sentence from `merge`.
- **`interlinear`**: each word over its translation, in columns that never compress. Struck words turn `signal`, are crossed out, then close.
- **`monitor-wall`**: a grid that adapts (2, 3 or 4 columns), glasses appearing one after the other, a caption plate under the grid.
- **`summary`**: rows on full plates, each with its thumbnail on glass, keyword and figure. The closing line sits on a highlight edge, and a flash at `lit` lights every thumbnail.
- **`progress`**: one segment per picture. Finished ones show their keyword, the current one is in the accent colour, and the others show their number.

**Figure tools (`avg-dcf.4.2.2`)**

Each draws the glass panel and its picture (`picture: {src, focus?, aspect?}`), its effects and its chips. Positions are inside the panel box (`box?`, default 440/150/1060×596). Points on the picture (`house`, `eye`) are found through the picture's `aspect`, which the compiler passes.

| Kit | Times (`times`) | Labels and data |
|---|---|---|
| `merge` | `a`, `b`, `tear`, `verb`, `result`, `end` | `labels: {a, b, verb, verbSub?, result}` |
| `cards` | each card's `at`, `human`, `end` | `cards: {word (≤14), gloss (≤30), icon (asset or "bruise"), pulse?, at}[1–3]`, `human: string[]` (≤4) |
| `stack` | `w1`–`w3`, `stairs`, `s1`–`s3`, `collapse` | `steps: {word, gloss, color?}[3]` (colours default to glow, highlight, signal), `row?: string[3]`, `clip?`, `labels: {weight}` |
| `oxymoron` | `glow`, `a`, `b`, `on`, `off`, `noConj` | `house: [x, y]` (on the picture), `labels: {glow, glowSub?, a, aSub?, b, bSub?, on, off, conj, noConj}` |
| `simile` | `subject`, `etym`, `like`, `open`, `close`, `dark` | `eye: {x, y, r?}` (`r`: the iris's radius as a share of the picture's width, default 0.148), `labels: {etymWord?, etymOrigin?, etymMeaning?, like, open, close}`, `bridgeImage?` |

What each tool draws:
- **`merge`**: the panel is dark and a live bolt crawls in it; the dark tears in two along a jagged light line and parts on the picture, where bolts keep striking; the two chips meet in the result.
- **`cards`**: up to three cards slide in, the last one jolts the picture; the `human` lines stack on the left; wind blows.
- **`stack`**: the adjectives in a row, then a staircase of growing weight with its gauge. At `collapse` the picture shatters into shards, smoke, and a rebuilt dimmed glass.
- **`oxymoron`**: a glow on the house; two halves (calm and agitated waves); lights on and off; the conjunction struck out.
- **`simile`**: the zoom to the eye, the living iris, an etymology plate, the bridge with a drawn eye and "like", eyelids opening and closing. The whole frame darkens at `dark`.

**Metre (`avg-dcf.4.2.2`)**

| Kit | Times | Data |
|---|---|---|
| `syllables` | `sample`, `vowel`, `breath`, `figure`, `metric` | `syllables: string[]` (2–20), `merges: {a, b, label, vowels, text, at}[0–2]`, `metric`, `labels: {counted, metric, rule, ruleResult, figure?}` |
| `rhymes` | `rhymes`, `a`, `b`, `close` | `ends: string[]` (2–10), `scheme` (one capital letter per verse), `pair: [i, j]`, `title`, `label` |

- **`syllables`**: tiles that close up as the vowels merge, arcs over the meeting vowels, the count, and the figure's name.
- **`rhymes`**: the last words with their scheme letters, the pair lit and joined by an arc, the closing eye.

### 3. Validation

The props schemas refuse, at their paths:
- 2–4 split items;
- at most 3 cards and 2 merges;
- exactly 3 `stack` steps;
- interlinear and rhyme indices that do not point to a word or line, a rhyme pair out of order, a scheme without one letter per verse;
- `read`, phase times and each tool's `times` out of order;
- 1–8 monitor cells and summary rows;
- a syllable merge whose `b` is not the syllable after `a`;
- colours that are not look roles.

## Verifying the look

Before the plan, uncommitted, as for the stage: the kits drawn with the Dentro i versi theme, beside frames of CreativeStudio's delivered Il lampo long.
- **Story, timeline, word tracks, interlinear, iris, bolt:** at the times of its component previews.
- **The five figure tools, the metre, the monitor wall and the summary:** at moments found in the video.

The comparison is shown to the user for approval.

**Done on 2026-10-08:** thirteen moments of the delivered video beside the kits drawn with the Dentro i versi look, with crops of CreativeStudio's panel as the pictures: word tracks and counts, interlinear, merge, cards, stack, oxymoron (halves, struck conjunction), simile (etymology, bridge), syllables, rhymes, monitor wall, summary. Tools, layouts, colours and type match. The differences are in the data and the timing, which belong to the compiler (`avg-dcf.6`), and CreativeStudio's own card icons. The prototype also settled:
- `fitLine` (the stack's plates were shrinking their text);
- labels on as many lines as they need on the axis;
- arrows drawn to their full length;
- the dark before the tear in `merge`.

## Testing

- **Each kit:**
  - examples at its meaningful moments;
  - one real frame each in 16:9;
  - overlays inside the safe zone;
  - previews;
  - the lock;
  - malformed props refused at their path.
- **Long texts:** long-text examples wherever a text is fitted.
- **Kept in sync (`@studio/series`):** the list of neutral kits gains the 16. Their look is fed through every example automatically.

## Documentation

The composer README (the kits, `lesson-tools`). No contract changes.

## Out of scope

- The science bridge.
- Sounds: all audio is the compiler's, on timeline tracks.
- Placing the tools on a timeline from a lesson's data (`avg-dcf.6`).
