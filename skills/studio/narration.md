---
name: narration
version: "0.1.0"
description: Synthesize narration audio from script using Qwen3-TTS CustomVoice with multi-character support
inputs:
  - name: script
    type: text/markdown
    description: The narration script with character annotations
outputs:
  - narration-manifest.json:
      kind: application/json
      description: Canonical ordered accepted-attempt and mastering provenance
  - narration-full.wav:
      kind: audio/wav
      description: Manifest-driven mastered mono PCM16/24k narration
capabilities:
  - speech.synthesize
---

# Narration

Synthesize narration audio from the script using the Qwen3-TTS CustomVoice 8-bit model
running on the local TTS worker (`http://127.0.0.1:5197`).

## Process

1. Ingest `artifacts/narration-script.json` into source-mapped spoken blocks.
2. Normalize reviewed English forms and resolve narration/dialogue turns; attribution stays narrator.
3. Segment only at safe semantic boundaries and bind each character to a stable CustomVoice profile/direction.
4. Submit each complete segment/profile to `/attempt-jobs`, execute, validate signal, and retry only reason-coded eligible rejection within bounds.
5. Process accepted attempts into linked speech/pause artifacts without changing raw WAVs.
6. Submit explicit manifest order to `/narrations/master` and write the returned canonical `narration-manifest.json` plus `narration-full.wav`.
7. Generate captions/timing from manifest order and measured WAV durations, never filename order.

## Writing the manifest

`artifacts/narration/narration-manifest.json` is how every reader downstream —
the studio's episode view, the scene spine, the timing and caption stages —
learns that this episode has narration at all. They look for an `entries` array
whose members carry a `segmentId` and a measured `wav`, and a manifest without
one is skipped in silence, as though no narration had been produced.

Two ways to write it, and never a third:

- Through `/narrations/master`, as step 6 describes. The worker returns the
  canonical document; write it unchanged.
- **`pva_write_narration_manifest`**, when narration came from the legacy
  `/synthesize` path (`pva_synthesize_speech`) and there are WAVs on disk but no
  mastering run. It measures every WAV from its own header, orders the segments,
  carries the caption text across, and validates the document before writing.

**Never hand-write this file.** A manifest assembled by eye once used
`segments`/`sceneId`/`audioPath` where the contract says
`entries`/`segmentId`/`wav`. It named a correct `finalWav`, so composition
worked and nothing complained, while the studio showed an eleven-segment
episode as having no narration whatsoever. If a manifest already exists in that
older shape, `pva_write_narration_manifest` reads it and rewrites it in place,
keeping the spoken text and recovering each pause from the gap that follows it.

Record lead-in and lead-out silence when the mastered WAV has any. Speech plus
pauses must account for the measured final, and a quarter-second of quiet at
each end is otherwise half a second the manifest cannot explain.

## Model

The selected profile pins the exact 1.7B CustomVoice checkpoint hash, preset, backend language, base direction, and sampling controls. `instruct` controls bounded delivery only; it never selects a different model. Neutral delivery is valid. Speed is exactly 1.0 because mlx-audio 0.4.6 exposes no Qwen speed control.

Primary API: `POST /attempt-jobs` followed by execute/validate/process and `POST /narrations/master`. `POST /synthesize` is legacy compatibility only.

## CustomVoice Preset Speakers

| Speaker | Use for | Notes |
|---------|---------|-------|
| `serena` | Narrator, warm female | Warm, gentle female voice. Default narrator. |
| `vivian` | Young female character | Young, innocent, sweet voice. |
| `uncle_fu` | Villain, gruff characters | Male voice. Can go from smooth-charming to deep-growling via instruct. |
| `ryan` | Male hero | Strong, kind male voice. |
| `ono_anna` | Older female | Elderly female voice. |
| `aiden` | Young male | Boy/young man voice. |
| `sohee` | Female (alt) | Alternative female voice. |
| `eric` | Male (alt) | Alternative male voice. |
| `dylan` | Male (alt) | Alternative male voice. |

**Important**: Supported names are discovered from checkpoint config. Unknown speakers and languages fail before generation; there is no silent remap.

## Multi-Character Scenes

Use source-conserving dialogue analysis followed by one immutable attempt per semantic turn. Attribution remains a narrator turn. Assemble only from the ordered accepted-attempt manifest; never concatenate lexically sorted filenames.

**Attribution text** ("she said", "he whispered") belongs to the narrator,
not the character. Split accordingly.

### Anti-pattern: Inline Character Tags

Do NOT use `Name: dialogue` inline format — the model reads character names aloud.
The `mlx_audio` `generate_audio` function does not expose multi-character tagging.

## Delivery direction

Preset speaker is identity. Base instructions describe only stable performance, for example:

```
Speak clearly and naturally while maintaining consistent delivery across adjacent narration.
```

Per-segment deltas use only the bounded pace, articulation, energy, emotion, intensity, intent, and distance taxonomy. Do not restate age, gender, timbre, pitch, accent, or character identity in instructions. Contradictory or over-length direction fails review.

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Short line takes 20s+ with breaths | Signal/rate validation rejection | Retain rejected attempt and create a bounded quality retry |
| Character names read aloud | Inline tag format used | Resolve explicit dialogue turns before synthesis |
| All voices sound the same | Wrong stable profile assignment | Validate exact checkpoint-discovered preset per character |
| Fake silence present | Explicit CI provider was used | Never publish fake mode; speech-presence validation rejects it |
| Legacy scene sidecars used | Canonical manifest absent | Read during transition only; new writers emit `narration-manifest.json` |
| Studio shows the episode as having no narration | Manifest has `segments`, not `entries` | Run `pva_write_narration_manifest`; it rewrites the older shape in place |

## Quality Checks

- Character voices are audibly distinct between speakers
- Attribution text ("she said") is in narrator voice, not character voice
- No unnecessary pauses or breathing artifacts
- All WAV files exist and have reasonable durations for their text length
- Duration roughly matches 2.5–3 words per second for natural speech
