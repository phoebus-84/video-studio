# Audio editing: montage, mix and sound design for every project

Bead: `avg-8hs.5`. It grows from "pause lengthening" into a general audio
editing capability.

## What the person asked

Audio editing is not a side feature. It serves many situations:
- two takes, the first good at the start and the second at the end, cut
  together;
- volumes adjusted;
- several audio files assembled;
- the sound design of any project that needs it.

The person also wants a small UI module to see it.

## What exists

The edit timeline already mixes at render:
- `gain`, `fadeIn`/`fadeOut` and `trimStart` per audio item;
- ducking (`duck: {under, gain}`);
- the output profile's loudness, measured and corrected once.

What is missing is **producing a new audio file** by cutting, joining and
shaping others, reproducibly, with its provenance. That is what a recital
assembled from two takes, a lengthened pause or a sound bed is.

## Design

### 1. `AudioEdit`, a declarative recipe (contract `studio.video/v1alpha1`)

```jsonc
{
  "apiVersion": "studio.video/v1alpha1", "kind": "AudioEdit",
  "output": { "path": "assets/takes/recita-montata.wav", "sampleRate": 48000, "channels": 1 },
  "tracks": [
    { "id": "voice", "gain": 0, "clips": [
      { "id": "a", "source": { "take": "recita-a" }, "in": { "word": 0, "edge": "start" }, "out": { "word": "cuore", "edge": "end" }, "at": 0 },
      { "id": "b", "source": { "take": "recita-b" }, "in": { "word": "Ma", "edge": "start" }, "crossfade": 0.02, "at": "after" }
    ]},
    { "id": "bed", "gain": -18, "clips": [
      { "id": "wind", "source": { "path": "assets/sounds/fs-vento.ogg" }, "in": 3.2, "out": 41.0, "at": 0, "fadeIn": 2, "fadeOut": 3,
        "automation": [[0, -24], [10, -16], [30, -16], [38, -30]] }
    ], "duck": { "under": "voice", "gain": -8 } }
  ],
  "pauses": [ { "take": "recita-a", "after": "chiaro", "seconds": 0.8 } ],
  "master": { "gain": 0, "loudness": -16, "truePeak": -1, "trim": { "head": 0.1, "tail": 0.3 }, "fadeIn": 0.02, "fadeOut": 0.3 }
}
```

- **A clip** is a stretch of a source:
  - the source is a take of the workspace, any audio file in it, or one
    pinned from a source;
  - `in` and `out` are seconds, or word anchors;
  - `at` is its place on the output: seconds, or `"after"` the previous clip;
  - each clip has its own gain in dB, `fadeIn` and `fadeOut`, `crossfade`
    with the previous clip, and an `automation` curve of `[seconds, dB]`
    points.
- **A track** is a layer: its clips, a gain, and optionally a duck under
  another track.
- **The master** has a gain, an integrated loudness target in LUFS (two
  passes), a true-peak ceiling (a limiter), a trim of the head and tail
  silences, and edge fades.
- **Determinism:** the same recipe and the same input hashes give the same
  file. The recipe is saved beside the output as `<output>.edit.json`, with
  the hashes of its inputs and of the output.

### 2. Word-anchored cuts and pauses (takes with a WordTiming)

- **Cutting on a word** (`{word, edge}`): the cut falls at the quietest point
  of the gap next to that word. It is the minimum short-term RMS between the
  previous word's end and the next word's start, never inside a word, with
  a crossfade of 10–30 ms. A word is named by its index, or by its text plus
  an occurrence when the text repeats.
- **Pauses** lengthen or shorten a pause after a word to a target.
  - The time is inserted or removed at the pause's quietest point.
  - Lengthening fills with the take's own room tone: its quietest 50–200 ms,
    looped with crossfades. Digital silence is never used. Neither is
    `atempo`.
  - Shortening never cuts closer than 40 ms to a word.
- **The output's word timing is derived.** Each word's times map through the
  edit, so an assembled or reshaped take keeps its timing without a new
  alignment. A take made by an edit registers like any take
  (`pva_register_take`), with the edit as its voice provenance.

### 3. Analysis

`analyzeAudio(file)` returns:
- the duration, integrated loudness (LUFS), loudness range, true peak and
  clipped samples;
- the silences and quiet points;
- **peaks** for display: min/max per 10 ms, saved as `<file>.peaks.json`.

The render report of an edit compares the output with its inputs. It
reports:
- clicks at each join, as a sample discontinuity above a threshold;
- level jumps across a join, in short-term LUFS before and after;
- clipping and the loudness reached.

### 4. Where it lives

- **`packages/audio-edit` (`@av/audio-edit`)** knows nothing of the studio.
  It resolves a recipe with time-only clips into one ffmpeg filter graph
  (`atrim`, `adelay`, `afade`, `acrossfade`, `volume` with expressions for
  automation, `sidechaincompress` for the duck, `amix`, a two-pass
  `loudnorm`, `alimiter`), renders it, and analyses the result.
- **`@studio/episode`:**
  - resolves word anchors and pauses against the workspace's takes and
    timings into time-only clips;
  - derives the output's WordTiming;
  - writes `<output>.edit.json`, the report and the peaks.

  It works in any workspace: an episode or a channel source.
- **Pi:**
  - `pva_edit_audio {workspace, recipe}` renders the recipe and returns the
    file, report and concerns;
  - `pva_analyze_audio {workspace, path}` analyses one file;
  - `pva_register_take` accepts an edit's output, and its derived timing.
- **Skill `audio-editing`** (shared) covers:
  - montage of takes;
  - pauses and breath;
  - a sound bed under a voice;
  - levels: a voice around −16 LUFS for video, beds 15–20 dB under it;
  - what to listen for, and what not to do.

### 5. A UI module: "Audio" in an episode or source

A read-only view, in the web studio, of the workspace's audio edits.
Editing stays the recipe's, made by Pi.

- **One row per track:**
  - its clips as blocks on a time ruler, drawn over the source's waveform
    (from the peaks);
  - each clip names its source and its in/out;
  - crossfades are marked at the joins;
  - the automation is a gain line over the clip;
  - a duck is shaded where it acts.
- **The voice track's words** are labelled under the waveform. Cut points and
  reshaped pauses are marked, the latter with "0,32 s → 0,80 s".
- **The master** shows the output's waveform, its LUFS and true peak, and the
  report's concerns (clicks, jumps, clipping) as marks on the ruler.
- **Playback:**
  - play the output with a playhead;
  - play one clip's stretch of its source;
  - A/B a take before and after the edit.
- **Implementation:** the gateway lists the workspace's `*.edit.json` with
  their reports and peaks (`GET …/audio-edits`). The web app adds an "Audio"
  tab beside Storyboard and Narration (Svelte, drawn on a canvas), reusing
  the episode media URLs for playback.

## Phases, one PR each

1. **The package:** clips, tracks, gains, fades, crossfades, automation,
   duck, mix, master (loudness, limiter, trim), analysis and peaks, the
   report, with tests on generated signals.
2. **The studio and Pi:** word anchors, pauses with room tone, derived
   timing, `pva_edit_audio`, `pva_analyze_audio`, edited takes registered,
   the `AudioEdit` contract.
3. **The skill, and a real trial:** Pi reshapes «Novembre»'s recital to the
   reference pauses (about 0.8 s at verse ends, 1.3 s at stanza ends) and
   assembles a bed. The person listens.
4. **The UI module:** the "Audio" tab.

## Not in scope

- Time-stretching or pitch.
- Noise reduction or EQ beyond a gain. They are possible later as clip
  filters.
- Editing in the browser: the UI shows and plays; recipes are written by Pi
  or by hand.
