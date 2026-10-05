# Narration takes: one model for segments, block takes and whole takes

**Issue:** `avg-7zp.4` — narration modes: whole take and per-block takes
**Epic:** `avg-7zp` — contracts for word-anchored, layered production (the `cs-port` plan)
**Depends on:** [word timing](2026-10-05-word-timing-design.md) (`avg-7zp.1`), [cues](2026-10-05-cues-design.md) (`avg-7zp.2`)
**Blocks:** `avg-jao.4` (data-driven pipeline manifests), `avg-8hs.1` (ElevenLabs adapter)
**Date:** 2026-10-05

## Problem

video-studio narrates through the local Qwen3-TTS worker: text is segmented,
each segment synthesised and quality-checked, and `narration-manifest.json`
lists the accepted segment WAVs in order with `pauseAfterMs`. That manifest is
already "a sequence of takes with pauses", but it is Qwen-shaped: entries
require a synthesis attempt id, a quality report id and mastering facts.

The productions ported from CreativeStudio need more:

1. **Takes from other tools.** An ElevenLabs take has no Qwen attempt, quality
   report or mastering.
2. **Grouping and reuse.** A block of the spec plays one take (a whole recital,
   one take per block) or several sentence takes in order (one wrong sentence is
   regenerated alone). The same recital take plays twice, identical.
3. **Scene pauses** (CreativeStudio "holds", UP-50): a declared silence of
   0.5–4 s inside a take, only after a sentence end, with a reason. The voice
   is never cut or stretched; it plays in two pieces around the silence, and
   the words after the cut move later.
4. **Evidence per take:** written text, what was sent to the tool, role, audio
   hash, and the take's `WordTiming`.

## Decisions taken with the user

1. **A new provider-neutral contract, Qwen mapped into it.** The Qwen
   manifest, worker, segmentation, quality reports and mastering stay as they
   are; a mapping turns a manifest into takes and one unit. The three "modes"
   (segments, one take per block, whole take) are shapes of one structure.
2. **Text preparation follows the tool.** ElevenLabs gets one paragraph, short
   inline tags and pronunciations written into the text; Qwen gets the
   worker's segmentation and a separate direction. That preparation is the
   provider adapter's job. The contract records the result verbatim and never
   imposes a preparation.

## Design

### Document — `NarrationTakes`, `artifacts/narration/takes.json`

```jsonc
{
  "apiVersion": "studio.video/v1alpha1",
  "kind": "NarrationTakes",
  "takes": [
    {
      "id": "recitazione",
      "audio": { "path": "assets/takes/recitazione.mp3", "hash": "sha256:…", "durationSeconds": 32.233 },
      "text": "La nebbia agli irti colli …",
      "spokenText": "[warm, unhurried legato recitation in native Italian] La nebbia agli irti colli …",
      "role": "recitante",
      "language": "it",
      "voice": {
        "provider": "elevenlabs", "model": "eleven_v3", "voiceId": "ts9siqBZkKbGEMralWeB",
        "settings": { "stability": 0.5 },
        "direction": "…"
      },
      "timing": { "path": "artifacts/timing/recitazione.json", "hash": "sha256:…" },
      "source": { "segmentId": "s3", "attemptId": "…" }
    }
  ],
  "units": [
    { "id": "ascolto1", "source": "blocks[2]", "sequence": [ { "take": "recitazione" } ] },
    { "id": "ascolto2", "source": "blocks[14]", "sequence": [ { "take": "recitazione" } ] },
    { "id": "epoca", "source": "blocks[3]", "sequence": [
      { "take": "epoca-1" },
      { "take": "epoca-2", "pauseBefore": 0.32,
        "holds": [ { "afterWord": "temporale.", "seconds": 2.5, "reason": "togliamo il suono: silenzio vero" } ] }
    ] }
  ],
  "metadata": { }
}
```

**Takes** (the registry):

- `id`: `^[A-Za-z0-9][A-Za-z0-9._-]*$`, unique.
- `audio`: `path`, `hash` (`ContentHash`), `durationSeconds` > 0.
- `text`: the written text — on screen, matched by cues, reproduced by the
  take's `WordTiming`.
- `spokenText` (optional): **exactly** what was sent to the tool, in that
  tool's own format (inline tags, pronunciation spellings, no line breaks…).
  Two takes of one text may have very different `spokenText`. Nothing on screen
  and no cue ever reads it.
- `role` (optional, open string): `guide`, `recitante`, `titolo`, `narrator`…
- `language` (optional): BCP-47, as in `WordTiming`.
- `voice`: `provider` (open string: `elevenlabs`, `qwen3-tts-local`, …),
  optional `model`, `voiceId`, `settings` (open object, recorded as sent),
  `direction` (string sent separately, e.g. Qwen's composed instruction).
  Provenance only: the contract interprets none of it.
- `timing` (optional): `{ path, hash }` of the take's `WordTiming`. Qwen takes
  have none until `speech.align` runs.
- `source` (optional): `{ segmentId, attemptId }` when the take came from the
  Qwen narration manifest.

**Units** (what each block of the spec plays):

- `id` unique; `source` (optional) a JSON path into the spec.
- `sequence` (at least one entry): `{ take, pauseBefore?, holds? }`.
  - `pauseBefore`: seconds of silence before this take, 0–10. **Required from
    the second entry on, forbidden on the first** — no hidden default; the
    series compiler writes the value it wants (CreativeStudio uses 0.32).
  - `holds` (optional): scene pauses inside this playing of the take
    `{ afterWord, n?, seconds, reason }`. `afterWord` uses the cue word rules
    (whole word, normalised; `n` counts from 1); the matched word must end a
    sentence (its written text ends with `.`, `!`, `?` or `:`) and must not be
    the take's last word; `seconds` 0.5–4; `reason` non-empty.
- A take may appear in many units; holds belong to the entry, so one playing
  of a recital can pause and another not.

New kind in `v1alpha1` (additive): `schemas/v1alpha1/narration-takes.schema.json`,
`$id` `https://video.studio/schemas/v1alpha1/narration-takes.schema.json`.
`@studio/contracts` 0.4.0 → 0.5.0.

### Validation — `validateNarrationTakes(doc)`

In `studio/contracts/src/narration-takes.mjs`; every problem as
`{ code, message, path }`, schema first, as for the other contracts.

| Code | When |
|---|---|
| `schema` | Shapes and types; hold `seconds` 0.5–4 with `reason`; `pauseBefore` 0–10 |
| `duplicate-id` | Two takes or two units with one id |
| `unknown-take` | A sequence entry names a take not in `takes` |
| `bad-pause` | `pauseBefore` missing from a non-first entry, or present on the first |

### Layout — `layoutUnit(doc, unitId, timings)`

`timings` maps take id → that take's `WordTiming` (already valid). Returns
`{ layout }` or `{ problems }` (with JSON paths into `doc`):

```js
{
  durationSeconds,                       // sum of take durations, pauses and holds
  pieces: [{ take, at, from, duration }],// audio pieces, seconds from the start of the unit
  timing: { take: { id: unitId }, words, lines },   // the unit's words, shifted; what cues resolve against
  energy: { rate, values }               // only when every take has energy at one rate; zeros in silences
}
```

- Takes play in order; each starts after the previous one plus its
  `pauseBefore`.
- A hold splits its take at the midpoint between the matched word's `end` and
  the next word's `start`: one piece up to the split, silence of `seconds`,
  one piece from the split (`from` = split, `duration` = rest). Words starting
  after the split move later by `seconds`.
- `timing.words` are the takes' words shifted to unit time; `timing.lines` are
  each take's lines with word indices shifted by the words before them. A unit
  played by several sentence takes is one sequence of words, so a cue on the
  block finds its word in whichever take says it.
- Problems:

| Code | When |
|---|---|
| `unknown-unit` | No unit with `unitId` (thrown as `RangeError`: a caller bug) |
| `missing-timing` | A take used by the unit has no entry in `timings` (needed for its words) |
| `timing-mismatch` | The take's `WordTiming` has another `audio.hash` or another `text` |
| `bad-hold` | `afterWord` not found (or fewer than `n`), not a sentence end, or the last word |

`layoutUnit` also requires `validateNarrationTakes(doc)` to have passed; it
does not re-validate the document.

The cue scope type (`studio/contracts/src/cues.d.mts`) changes from
`timing: WordTiming` to a structural `CueTiming { take: { id }, words, lines? }`,
which `WordTiming` and a layout's `timing` both satisfy. Types only; the
resolver already reads nothing else.

### Qwen mapping — `takesFromNarrationManifest(manifest, { segments })`

Accepts both manifest shapes in the repository: the canonical
`NarrationManifest` and the lighter one `studio/agent/src/narration-manifest.ts`
writes (entries `{ segmentId, wav, pauseAfterMs, acceptedAttemptId? }`,
optional `captions`, optional `leadInSilenceSeconds`).

- One take per entry, in order: `id` = `segmentId`; `audio` from `wav`
  (`path`, `contentHash`, `durationSeconds`); `voice.provider`
  `"qwen3-tts-local"`; `source` = `{ segmentId, attemptId: acceptedAttemptId }`
  when present.
- Text: from `segments` (`NarrationSegment[]`: `displayText` → `text`,
  `spokenText` when different, `role`, `language`) when given, else from the
  manifest's caption for that segment; neither → `Error` naming the segments.
- One unit, `narration`, the entries in order; `pauseBefore` of entry k is
  entry k−1's `pauseAfterMs / 1000`.
- Returns `{ takes, leadInSeconds }`: the unit starts after the lead-in.
- **Positions are identical to today's**: `leadInSeconds + piece.at` equals
  the agent's cursor (lead-in, then duration + pause per segment) for every
  entry.

## Fixtures and testing

`studio/contracts/fixtures/narration-takes/`:

- `valid/il-lampo.json` — real takes: the "epoca" guide take (with its real
  hash, its word-timing fixture as `timing`) and the San Martino recital (the
  word-timing fixture's synthetic hash); units: `ascolto1` and `ascolto2`
  reusing the recital, `epoca` with a hold after "temporale." (word 104), and
  a two-take unit (epoca then the recital, `pauseBefore` 0.32). The `timing`
  hashes are the hashes of the word-timing fixture files.
- `invalid/*.json` — base + patch, one per `validateNarrationTakes` code.

Tests (`node:test`), on those fixtures:

- validation: valid fixture clean; each invalid fixture exactly its code;
  all problems collected with paths.
- layout: single take; reused take (identical layouts); `pauseBefore`; the
  hold after "temporale." (two pieces, the split point, later words moved by
  2.5 s, earlier words unchanged); a two-take unit (word count, offsets, line
  indices shifted); energy concatenated with zeros, and omitted when one take
  has none; `missing-timing`, `timing-mismatch` (other hash, other text),
  `bad-hold` (word absent, not a sentence end, last word); `RangeError` for an
  unknown unit.
- a cue (`"temporale"`, `{ line: … }`) resolved against a layout's `timing`.
- Qwen mapping: the canonical fixture (`fixtures/narration/valid.json`), and
  a lighter agent-shaped manifest with lead-in and three entries: takes,
  `source`, text from segments and from captions, the `Error` when neither,
  and positions equal to the agent's cursor.
- schema check in `check:schemas`; bindings up to date; `npm run check` in
  `studio/contracts` and at the root.

## Out of scope

- Producing takes and preparing their text (ElevenLabs adapter `avg-8hs.1`,
  the Qwen worker as it is).
- Local pause lengthening inside a take (`audio.edit`, `avg-8hs.5`).
- Mixing the final audio (the composer); grouping a Qwen manifest into several
  units by `sourceBlockIds` (the series compiler can do it with this model).
