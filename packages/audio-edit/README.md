# @av/audio-edit

Audio editing for every project (avg-8hs.5):
- clips of other files, cut and joined with crossfades;
- tracks layered, with gains, automation curves and ducking;
- a mastered mix: loudness, true peak, head and tail trims, fades;
- analysis: loudness, silences, clipping, quiet points, waveform peaks.

A recipe becomes one ffmpeg graph, and the same recipe and inputs give the
same file. The package knows nothing of the studio. Anchoring a cut on a word
is the caller's work: it resolves words to seconds first.

```ts
import { renderRecipe } from "@av/audio-edit";

const result = await renderRecipe({
  output: { sampleRate: 48000, channels: 1 },
  tracks: [
    { id: "voice", clips: [
      { id: "a", source: "takes/recita-a.wav", out: 12.48, at: 0 },
      { id: "b", source: "takes/recita-b.wav", in: 12.31, at: "after", crossfade: 0.02 },
    ] },
    { id: "bed", gain: -18, duck: { under: "voice", gain: -8 }, clips: [
      { id: "wind", source: "sounds/wind.ogg", in: 3, out: 40, at: 0, fadeIn: 2, fadeOut: 3, automation: [[0, -6], [10, 0]] },
    ] },
  ],
  master: { loudness: -16, truePeak: -1, trim: { head: 0.1, tail: 0.4 }, fadeOut: 0.3 },
}, { root: episodeDir, output: `${episodeDir}/assets/takes/recita.wav` });
// result.placements, result.joins (clicks, level jumps), result.loudness, result.concerns
```

## The recipe

- **A clip** is a stretch of a source file:
  - `in` and `out` are seconds in the source;
  - `at` is seconds on the output, or `"after"` the previous clip of its
    track, overlapped by its `crossfade`;
  - its `gain` is in dB;
  - `fadeIn` and `fadeOut` are quarter-sine, so a crossfade keeps the power
    constant;
  - `automation` is a gain curve of `[seconds from the clip's start, dB]`
    points.
- **A track** sums its clips (never normalized: a gain is what it says) and
  has its own `gain`. A `duck` lowers it by `gain` dB while another track's
  clips play, with `attack` and `release` ramps. The duck follows the clips'
  placement, not the signal, so it is exact and the same every time.
- **The master** sums the tracks and applies, in this order:
  1. a `gain`;
  2. a `trim`: at most `head`/`tail` seconds of silence kept;
  3. `loudness`: integrated LUFS, measured (EBU R128) and reached with exactly
     that gain;
  4. `truePeak`: a limiter only when the gain would pass the ceiling, and the
     result says so;
  5. edge fades.
- **Clips are placed to the sample.**
- **Outputs:** `.wav` (24-bit), `.flac`, `.m4a`, `.mp3` and `.ogg`, written
  bit-exact.

## The report

- `placements`: where every clip went on the output.
- `headTrim`: seconds removed from the head; shift times by it.
- `loudness`: integrated, range and true peak.
- `normalization`: `gain` or `gain+limiter`.
- `clipped`: clipped samples.
- `joins`: each join between consecutive clips, with a **click** (a sample
  step far above the signal's motion there) and a **level jump** (short-term
  RMS just before against just after, the crossfade excluded).
- `concerns`: what a person should listen to, in plain words.

## Analysis

`analyzeAudio(file)` measures:
- the duration, the loudness (integrated, range, true peak) and the
  silences;
- the clipped samples;
- per 10 ms, the min/max `peaks` (to draw a waveform) and the `rms`.

`quietestPoint(rms, from, to)` gives where a cut or an insert hurts least. The
PCM is read once, as a stream.

Requires `ffmpeg` and `ffprobe` (`FFMPEG_PATH`, `FFPROBE_PATH`).
