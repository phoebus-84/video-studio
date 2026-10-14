# ADR-0047: Audio edits are recipes: cut on words, mixed, mastered, reproducible

## Status

Accepted (`avg-8hs.5`). Implemented:
- `@av/audio-edit`;
- the `AudioEdit` record;
- `pva_edit_audio`, `pva_analyze_audio`;
- `pva_align_take` with the `derived` provider.

## Context

Productions need audio editing, and not only to lengthen a recital's pauses:
- joining the good start of one take to the good end of another;
- setting volumes;
- assembling ambiences and effects into a bed under a voice.

The edit timeline already mixes at render (gains, fades, ducking, loudness),
but nothing made a new audio file from others with its provenance. A take
assembled by hand, or by a one-off ffmpeg command, loses where its parts came
from and its word timing.

## Decision

- **An audio file made by an edit is a recipe and its result.**
  - **The recipe:**
    - tracks of clips, each with in/out/at, crossfades, gains in dB,
      quarter-sine fades and gain curves;
    - a duck per track;
    - a master: loudness, true peak, trims, fades.
  - It becomes one ffmpeg graph. The same recipe and inputs give the same
    file, written bit-exact, with clips placed to the sample.
- **Takes and words are the studio's.** A recipe in a workspace names takes as
  sources and cuts on words. The studio resolves them to seconds:
  - **Cuts** fall at the quietest point of the pause beside the word, never
    in a word.
  - **Pauses** are reshaped there. Longer adds the take's own quietest
    stretch (room tone), repeated with crossfades. Shorter stays 40 ms clear
    of the words. Nothing is ever time-stretched.
- **`<file>.edit.json`** records:
  - the recipe and what it resolved to;
  - every input and the output by hash;
  - where each clip went;
  - the report;
  - the words carried from the takes' timings.

  A take made by an edit registers like any other, and its timing comes from
  the record (`alignment.method: "derived"`), with no new alignment.
- **Loudness is reached with a measured gain** (EBU R128). A limiter is used
  only when that gain would pass the true-peak ceiling, and the report says
  so. ffmpeg's `loudnorm` was not used: even with two passes it fell back to
  compressing the dynamics.
- **The report measures each track's joins on that track alone,** inside its
  clips:
  - clicks: a sample step far above the signal's motion;
  - level jumps: RMS before against RMS after.

  It also names clipping, a limiter that was needed, and a loudness that was
  not reached.

## Consequences

- **Reproducible.** An edit can be read, changed and made again. Its parts
  are traceable to the takes and sounds they came from.
- **No new alignment.** Reshaping a recital's pauses changes its words'
  times, and the derived timing follows them.
- **One process per join.** The report reads each join with its own ffmpeg
  run: thousands of joins are slow but correct. The graph goes to ffmpeg as a
  file, so it has no command-line length limit. This needs ffmpeg 7 or later
  (`-/filter_complex`).
