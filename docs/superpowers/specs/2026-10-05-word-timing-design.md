# Word timing per take

**Issue:** `avg-7zp.1` — word-timing contract per take
**Epic:** `avg-7zp` — contracts for word-anchored, layered production (the `cs-port` plan)
**Blocks:** `avg-7zp.2` (cue grammar and resolver), `avg-8hs.2` (`speech.align`), `avg-7zp.4` (narration modes)
**Related:** [edit timeline v2](2026-10-05-edit-timeline-v2-design.md) (timing files are `$asset`s of kit props); `narration.schema.json` (`displayText` / `spokenText`)
**Date:** 2026-10-05

## Problem

Nothing in video-studio knows when a word is spoken. Narration is a list of
segments with durations; captions use segment timing (ADR-0019). The
productions ported from CreativeStudio anchor everything to words: a
lightning bolt on "lampo", a verse bar that lights each word as it is said, a
guide whose mouth follows the voice. CreativeStudio keeps, per take,
`words.json` (`[{text, start, end}]` in seconds), `energy.json` (one 0–1 value
per frame at 30 fps for lip-sync), `input.json` (audio sha256 and text) and,
for recitals, `lines.json` (one entry per verse) and `speech.json` (spans
where someone speaks).

## Decisions taken with the user

1. **Written text, plus the spoken form where it differs.** Words carry what is
   on screen ("Myricae."), and `spoken` ("Mirìce") only where the pronunciation
   differs. Cues, verse bars and captions work with the written text; the
   spoken form serves pronunciation checks (UP-46).
2. **Provider-neutral.** A take may come from the local Qwen3-TTS worker (one
   accepted narration segment) or from ElevenLabs (a whole take, or one per
   block); each pipeline chooses its provider and prepares the TTS text its own
   way. The contract describes any audio, whatever produced it, and records the
   aligner as provenance. Qwen produces no timing; `speech.align` (local
   whisper.cpp, or ElevenLabs forced alignment) does, for any provider's audio.

## Design

### Document

```jsonc
{
  "apiVersion": "studio.video/v1alpha1",
  "kind": "WordTiming",
  "take": {
    "id": "epoca",
    "source": { "segmentId": "s3", "attemptId": "a2" }
  },
  "audio": { "path": "assets/takes/epoca.wav", "hash": "sha256:…", "durationSeconds": 47.8 },
  "text": "Prima di entrare … terza edizione di Myricae. …",
  "spokenText": "Prima di entrare … terza edizione di Mirìce. …",
  "language": "it",
  "alignment": { "provider": "elevenlabs", "model": "forced-alignment", "method": "forced", "createdAt": "2026-10-04T18:22:00Z" },
  "words": [
    { "text": "Prima", "start": 0.0, "end": 0.195 },
    { "text": "Myricae.", "spoken": "Mirìce.", "start": 8.106, "end": 8.628, "confidence": 0.93 }
  ],
  "lines": [ { "id": "c1", "firstWord": 0, "lastWord": 7, "speaker": "recitante" } ],
  "speech": [[0.37, 1.19], [1.87, 3.06]],
  "energy": { "rate": 30, "values": [0.019, 0.02, 0.105] },
  "metadata": { }
}
```

- **New kind in `v1alpha1`.** `apiVersion` stays `studio.video/v1alpha1`; the
  compatibility policy classes a new kind as additive (minor package bump).
- **`take`**: `id` (local identifier, `^[A-Za-z0-9][A-Za-z0-9._-]*$`) and an
  optional `source` naming the narration segment and attempt it belongs to
  (`segmentId`, `attemptId`, both optional strings). A take outside the
  narration manifest (an ElevenLabs block take) has no `source`.
- **`audio`**: `path`, `hash` (`ContentHash`, `sha256:<64 hex>`) and
  `durationSeconds` (> 0). The hash binds the timing to one exact file.
- **`text`** is the written text the words reproduce. **`spokenText`**
  (optional) is the text sent to the TTS when it differs.
- **`language`**: BCP-47 tag, e.g. `it`.
- **`alignment`**: `provider` (open string: `elevenlabs`, `whisper-cpp`, …),
  optional `model`, `method` (`forced` when aligned against known text,
  `asr` when transcribed and snapped to the text), `createdAt` (date-time).
- **`words`** (at least one): `text` (written token), optional `spoken`,
  `start` and `end` in **seconds of this audio**, optional `confidence` (0–1).
- **`lines`** (optional): `id`, `firstWord`, `lastWord` (word indices,
  inclusive), optional `speaker`. A line's text and times are derived from its
  words, never repeated.
- **`speech`** (optional): `[start, end]` spans in seconds where someone is
  speaking. Spans may cover speech the words do not (a title announced by
  another voice before a recital whose text is only the poem).
- **`energy`** (optional): `rate` (samples per second, > 0, independent of any
  timeline fps) and `values` (each 0–1).
- Raw ASR or provider output is **not** part of the contract: it is evidence
  kept with the aligner's attempt.

### Time

Seconds of the take's own audio. The same take serves a 30 fps and a 24 fps
timeline; the series compiler converts to frames and adds the take's offset in
the episode. Times are numbers ≥ 0 (aligners report milliseconds or finer).

### Validation

`studio/contracts/src/word-timing.mjs` exports
`validateWordTiming(doc, { audioHash } = {})`, returning **every** problem as
`{ code, message, path }` with JSON paths (`$.words[12].start`), like
`validateEditTimeline`. The JSON Schema runs first; if it fails, only
`schema` problems are returned.

| Code | Rule |
|---|---|
| `schema` | Shapes and types; times ≥ 0; `durationSeconds` and `rate` > 0; `confidence` and energy values within 0–1 |
| `audio-mismatch` | `audioHash` was given and differs from `audio.hash` |
| `word-order` | A word with `end < start`, or starting more than 1 ms before the previous word ends |
| `out-of-range` | A word or speech span ending more than 50 ms after `durationSeconds` |
| `text-mismatch` | The words' `text`, joined with single spaces, differs from `text` with whitespace runs collapsed |
| `bad-line` | `firstWord > lastWord`, an index outside `words`, or a line starting at or before the previous line's `lastWord` |
| `speech-order` | A span with `start >= end`, or starting before the previous span ends |
| `energy-length` | `values.length` differs from `round(durationSeconds × rate)` by more than 1 |

The 1 ms and 50 ms tolerances absorb aligner rounding; they are named
constants in the module.

### Helper

`lineSpan(doc, index)` returns `{ id, start, end, text, speaker }` for
`lines[index]`: `start` of its first word, `end` of its last, words' `text`
joined with spaces. It throws `RangeError` for an index outside `lines`. The
cue resolver and the series compiler use it to anchor whole verses.

### Types and bindings

`schemas/v1alpha1/word-timing.schema.json` (`$id`
`https://video.studio/schemas/v1alpha1/word-timing.schema.json`, defining
`WordTiming` and its parts) is picked up by the existing bindings generator
into `bindings/ts/word-timing.ts`. `src/word-timing.d.mts` declares
`validateWordTiming`, `lineSpan` and the problem codes. `@studio/contracts`
goes from 0.2.0 to 0.3.0.

## Fixtures

From real CreativeStudio data (`../CreativeStudio`, read-only), converted once
by hand into `studio/contracts/fixtures/word-timing/`:

- `valid/epoca-take.json` — the guide's "epoca" block take of
  `poesie-museo-long/il-lampo-long`: 118 words, energy at 30 fps, the take's
  real sha256 from its `input.json`; `text` = the block's written text,
  `spokenText` = its `tts_text`; the word "Myricae." carries
  `spoken: "Mirìce."`. Aligner: ElevenLabs forced alignment.
- `valid/san-martino-recital.json` — `poesie-fonti/02-san-martino`: 62 words,
  8 lines (one per verse, speaker `recitante`), 16 speech spans (including the
  title read by another voice, not in `text`), energy at 30 fps. Its audio is
  not in the CreativeStudio repository and no hash of it was recorded, so the
  fixture's `audio.hash` is synthetic, and `metadata.note` says so.
- `invalid/*.json` — the edit-timeline style: `{ "expect", "base", "patch" }`,
  a valid base plus one RFC 6902 change, one file per code except
  `audio-mismatch` (which needs an argument, so it is a unit test).

`scripts/check-word-timing-fixtures.mjs` validates them and joins
`check:schemas`.

## Testing

- Every valid fixture: no problem. Every invalid fixture: exactly its code.
- `audio-mismatch`: the epoca take against a different hash; and no problem
  when `audioHash` is omitted or equal.
- Schema-first: a negative `start` yields only `schema` problems.
- All problems collected (two different codes at once), with JSON paths.
- Tolerances: a word starting 0.5 ms before the previous one ends is valid;
  2 ms is `word-order`. A word ending 40 ms past the duration is valid; 60 ms
  is `out-of-range`.
- `text-mismatch` ignores whitespace runs in `text` but not punctuation.
- `lineSpan`: start, end, text and speaker of a San Martino verse; `RangeError`
  for a bad index.
- Bindings regenerate cleanly; `npm run check` in `studio/contracts` and at the
  root pass.

## Out of scope

- Producing timing (`speech.align`, `avg-8hs.2`) and verifying a take against
  its text with pause measurement (`avg-8hs.3`).
- Cue grammar and resolution (`avg-7zp.2`); narration modes (`avg-7zp.4`).
- Converting CreativeStudio productions in general: the two fixtures are a
  one-off hand conversion.
