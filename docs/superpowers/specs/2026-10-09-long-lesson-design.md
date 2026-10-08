# The long lesson: template, pinned source, compiler

**Issues:** `avg-dcf.6.2` (the `dentro-i-versi-long@1.0.0` template and Il lampo's spec) and `avg-dcf.6.3` (the long compiler and validator), in one run.
**Epic:** `avg-dcf.6`, Il lampo long end to end.
**Builds on:**
- the lesson stage and the teaching tools (`avg-dcf.4`, ADR-0040);
- series templates and compilers (ADR-0037);
- pinned shared material (ADR-0035);
- the render audit (`loop`);
- the signed sheet review;
- registered takes.

**Goal now (user, 2026-10-09):** test the capabilities, the architecture and the kits end to end. This is not the best episode. Quality gaps are noted, not chased.
**Date:** 2026-10-09

## Problem

CreativeStudio's long lesson is about 1300 lines of runtime per version (v10 to v15) reading a 60 KB `lezione.json`. The style is fixed and the direction is designed per poem (UP-61). Video-studio already has every kit that lesson draws. It has no template saying what a long episode's spec holds, and no compiler that turns that spec into a timeline of those kits. Also, the long cannot reach its poem's paintings and recital: they belong to the short episode (the shared source, UP-57), and the series loader reads only files inside the episode.

## Decisions

1. **One run, one PR, three pieces:**
   - the loader reads pinned sources;
   - the release, Il lampo's spec and its fixture;
   - the compiler and validator.

   Each piece is a commit.
2. **Pinned sources in the loader.** An episode with `source/pins/<id>.json` naming another episode of its channel (ADR-0035) offers that episode's material to the compiler:
   - its pictures as `source-<pin>-image-<assetId>`;
   - its takes as `source-<pin>-narration-<take>`;
   - its takes and timings as `CompileInput.sources[<pin>]` = `{narration, timings}`.

   Every file read must match the pin's inventory, or the load stops with `pin-mismatch`, telling you to renew the pin. A source episode's runtime folders are never read. The source episode's folder becomes one of the render's shared roots, with the theme's.
3. **The long template `dentro-i-versi-long@1.0.0`:**
   - pins the theme `dentro-i-versi@1.0.0`;
   - renders `youtube-1920x1080`;
   - names its compiler and validator;
   - has sheet instants at every block's start and middle, the chapter cards and the specimens' tools;
   - its `FORMAT.md` is the lesson's standard from CS's long FORMAT 1.4.0, condensed, with UP-61 and the 5 chapters.

   The rules shared with the short (voice follows the interpreter, exact text on screen, measured pauses, the shared source) are written once in the channel's `brand/` and referred to, not copied: the "family rules" idea from CS.
4. **The spec is a list of blocks, each with its guide take.**

   Every block has:
   - `id`;
   - `kind`;
   - `take` (the guide's take id in this episode's unit `lesson`), or a source take for recitals;
   - `title`;
   - optional `lower` (kicker, title, info for `block-title`);
   - optional `chapterAfter` (number, title, sub);
   - optional `gapAfter`;
   - optional `gestures` (cue, pose, expression).

   The kinds:

   | Kind | What it draws (kits) | Its data |
   |---|---|---|
   | `opening` | the atrio (`room` atrio), the cover on the first frame (`cover`), the guide entering, teleport into the hall at a cue (`warp`) | `cover {kicker, title, hook}`, `enter` cue |
   | `announcement` | the hall, the title said by the source's title take, its name on the glass (`panel` with title text) | source take |
   | `recital` | the source's recital over the panel's pictures, one per verse group, and the verse bar word by word (`verse-bar`); `annotated: true` for the second recital, with each verse's figure (`figure-title`) | source take, `pictures: {asset, verses}[]`, `annotated?` |
   | `story` | panel phases (`panel@1.1.0` layers), text stacks (`text-stack`), effects (`story-fx`), timelines (`timeline`) | `phases: {at, layers, texts?, fx?, timeline?}[]` |
   | `note` | word tracks (`word-tracks`) with counts (`text-stack`), then a quote with its translation (`interlinear`) over a picture | `tracks {read, point, merge?}`, `counts`, `quote {picture, words, strike?}` |
   | `specimen` | one painting, its verse bar, the progress bar (`progress`) and its figure tool (`merge`, `cards`, `stack`, `oxymoron`, `simile`), its headline at a cue (`figure-title`) | `picture`, `verses`, `figure {kind, …tool data with cues}`, `headline` |
   | `meter` | the syllables (`syllables`), then the rhymes (`rhymes`) | the tools' data with cues |
   | `invite` | the monitor wall (`monitor-wall`) | `caption`, `cells?` (default: the source's paintings) |
   | `summary` | the summary rows (`summary`) | `rows: {keyword, figure, picture}[]`, `closing` |
   | `end` | back to the atrio, the guide teleports out, the last frame equals the first (`loop: true`) | `minDuration` |

   The science bridge stays out (spec of `avg-dcf.4.2`).
5. **Cues name words.** A time in a block is:
   - a number (seconds from the block's start);
   - `{word, n?, offset?}`: the n-th occurrence of `word` in the block's guide take, plus offset;
   - `"end"`: the take's end.

   Words are matched case-insensitively without punctuation, against the take's `WordTiming`. A cue that finds no word stops compilation with `cue-not-found` at its JSON path. CreativeStudio's golden rule applies: no hidden fallback, fix the data.
6. **Timing.**
   - Blocks follow each other. Each lasts its take, plus `gapAfter` (default 1 s), plus 4 s after a chapter card.
   - The second recital replays the first's take. The opening's cover holds the first frame.
   - `loop: true`: the end returns to the opening's first frame, the atrio with the cover.
7. **The guide.** `interprete@1.1.0` with the theme's character `guida`:
   - the mouth comes from the take's energy;
   - gestures come from cues;
   - teleport in at the opening and out at the end;
   - present in every block except recitals, where the source's actor (`attore-illuminato`) recites, with the second costume at the second recital.
8. **The stage everywhere.**
   - `room` (atrio for the opening and the end, sala otherwise) with its storm;
   - `brand-mark` throughout;
   - `block-title` from `lower`;
   - `chapter-opener` between chapters;
   - `verse-bar` where verses are discussed.
9. **Sound.** Optional sound slots (`music.theme` at the opening and the end, `sfx` keyed by cue) take assets from `assets/sounds/`. A missing optional sound is a warning, not an error, because the goal is testing, and 6.4 provides them.
10. **The validator** (`dentro-i-versi-long@1.0.0`):
    - errors: overlays inside the safe zone and the theme; teleports; `loop: true`; guide takes and recitals present; duration 240–600 s.
    - warnings: chapter count (5); specimens without a figure tool; sounds missing; a hand edit that moves a block.
11. **Channel specifics.** The template and spec are library data. The compiler is code, as the short's is. Like the short (accepted, `avg-d1x`), it keeps layout constants of this format in code: block order rules, stage positions. Everything poem-specific is data.

## Il lampo's spec and the golden fixture

- **`studio/series/fixtures/dentro-i-versi-long/1.0.0/`:**
  - `release/` (the template);
  - `input.json` (spec, narration, timings, assets, sources), Il lampo's lesson translated from CS's `lezione.json`, with guide take texts;
  - `expected-timeline.json`, the golden output.

  Timings in the fixture are synthetic but valid (words spread over each take). Assets are placeholder entries, as in the short's fixture.
- **The library copy:** the release goes into `library/dentro-i-versi/series/long/templates/`, and the Il lampo long episode is created when 6.4 makes its guide takes (Qwen) and 6.5 runs it.

## Testing

- **Loader:**
  - a pinned episode's pictures and takes are offered with their ids;
  - a changed file is `pin-mismatch`;
  - a pin out of the channel, or into a source's runtime folders, is refused;
  - the shared roots include the source.
- **Compiler:**
  - the golden: Il lampo compiles to `expected-timeline.json`;
  - every block kind compiles alone;
  - cue errors (`cue-not-found`) are located;
  - a missing optional sound is a warning;
  - the timeline validates against the contract and the composer (kits and props), and `loop` is set.
- **Validator:** each rule's error and warning.
- **Real render (e2e, `REMOTION_E2E=1`):** the golden's layout sheet, then the full render audited. This is the 6.5 dry run with placeholder media.

## Out of scope

- The guide takes, sounds and period images (6.4).
- The production run, review and side-by-side with CS (6.5).
- The science bridge.
- Voice quality.
- CS runtimes v13 and v15's newer effects (`fx12`: ladder, rings), noted for a later kit release.
