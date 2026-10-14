---
name: audio-editing
version: "0.1.0"
description: Edit and mix audio for any project with pva_edit_audio — join the good parts of several takes on words, reshape pauses with the take's room tone, layer and duck beds and effects, set levels and master the mix — and check what you made before anyone listens
inputs:
  - name: need
    type: string
    description: What the audio must become (a take assembled from two, pauses like a reference, a sound bed under a voice), and the workspace it lives in
outputs:
  - assets/:
      kind: directory
      description: The edited file with <file>.edit.json (recipe, inputs, report, carried words) and <file>.peaks.json
capabilities:
  - audio-edit
---

# Audio Editing

`pva_edit_audio` makes one audio file from others, from a recipe. The recipe
is saved beside the file (`<file>.edit.json`), so an edit can always be read,
changed and made again. It works in an episode or a channel source (`source`
in place of `series` and `episode`).

## Before editing: measure

- `pva_analyze_audio` gives a file's loudness (LUFS), true peak, clipping and
  silences. Use it to choose between takes and to set gains.
- `pva_verify_take` gives a take's words, its pauses at verse and stanza ends,
  and the words it lacks. It tells you which take is good where.

## The recipe

```jsonc
{
  "output": { "path": "assets/takes/recita-montata.wav" },        // assets/takes, assets/sounds or artifacts/audio
  "tracks": [
    { "id": "voice", "clips": [
      { "id": "a", "source": { "take": "recita-s11" }, "out": { "word": "cuore", "edge": "end" }, "at": 0 },
      { "id": "b", "source": { "take": "recita-s23" }, "in": { "word": "Ma", "edge": "start" }, "at": "after", "crossfade": 0.02 }
    ] },
    { "id": "bed", "gain": -20, "duck": { "under": "voice", "gain": -6 }, "clips": [
      { "id": "air", "source": { "path": "assets/sounds/fs-autunno.ogg" }, "in": 4, "out": 40, "at": 0, "fadeIn": 2, "fadeOut": 3,
        "automation": [[0, -4], [8, 0], [30, 0], [36, -8]] }
    ] }
  ],
  "pauses": [ { "take": "recita-s23", "after": "piante", "seconds": 0.8 } ],
  "master": { "loudness": -16, "truePeak": -1, "trim": { "head": 0.15, "tail": 0.5 }, "fadeOut": 0.4 }
}
```

- **Cuts on words.**
  - `{ word, edge }` names a word by its text or its index, as the take's
    timing writes it. When a word is said more than once, add `occurrence`
    (1, 2…).
  - The cut falls at the quietest point of the pause beside the word, never
    inside it.
  - Join takes with a `crossfade` of 0.01–0.03 s. Longer smears the words.
- **Pauses.** `pauses` sets the pause after a word to so many seconds.
  - Longer adds the take's own room tone, never digital silence.
  - Shorter never comes closer than 40 ms to a word.
  - No time-stretching, ever.
- **Seconds.** `in` and `out` can also be seconds, for files without words.
  `at` is seconds on the output, or `"after"` the previous clip of the track.
- **Gains are in dB.**
  - The clip's `gain`, then the track's, then the master's.
  - `automation` is a curve of `[seconds from the clip's start, dB]`.
  - `duck` lowers a track while another plays: a bed under a voice, about
    −6 to −10 dB.
- **The master.**
  - `trim` keeps at most so much silence at the head and the tail.
  - `loudness` reaches a target with a measured gain.
  - `truePeak` holds the peaks.

## Levels that work

- **Voice for video:** about −16 LUFS integrated, true peak −1 dBTP.
- **Beds and ambiences:** 15–20 dB under the voice. Effects sit where they
  belong, rarely louder than the voice.
- **Pauses in verse** (Dentro i versi, UP-60):
  - about 0.8–0.9 s at a verse end or after a comma or colon;
  - about 1.3 s at a stanza end;
  - about 0.5 s across an enjambment.

  A channel's skill says its own.

## After editing: check

- **Read the report** `pva_edit_audio` returns:
  - every `concern`: a click at a join, a level jump, clipping, a limiter
    that was needed, a loudness not reached;
  - fix what you can, and say what remains.
- **A take made by an edit:**
  - register it with `pva_register_take`;
  - give it its timing with `pva_align_take` and `provider: "derived"`,
    which carries the words through the edit with no new alignment;
  - then `pva_verify_take`.
- **Say what you did not hear.** You cannot listen: the person does. Name the
  joins and the reshaped pauses with their times, so they know where to
  listen.

## Never

- Never cut inside a word, or reshape a pause by time-stretching.
- Never edit a source's file in place: write a new file, and keep the takes
  it was cut from.
- Never raise a gain until it clips: lower the others, or let the master's
  loudness do it.
