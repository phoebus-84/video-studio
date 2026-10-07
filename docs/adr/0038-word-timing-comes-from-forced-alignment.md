# ADR-0038: Word timing comes from forced alignment against the text

## Status

Accepted (`avg-8hs.2`). `speech.align` is implemented: the local voice
worker's `POST /align` (Qwen3-ForcedAligner through mlx-audio), the
`@av/elevenlabs` client's forced alignment, the provider-neutral
post-processing and `alignTake` in `@studio/episode`, and the agent's
`pva_align_take`.

## Context

A series episode's narration takes each need a `WordTiming` (`avg-7zp.1`):
every word of the written text with its start and end in the take's audio.
Captions, cues and the series compilers are built on it. Nothing measured
one: a person had to supply the files. CreativeStudio transcribes with
whisper.cpp and reconciles the transcription with the script. The studio's
standing rule for audio: Qwen stays the local speech engine, ElevenLabs is
an option a person chooses, never a replacement.

## Decision

**Word timing is measured by forced alignment against the written text** —
the aligner is told what is said and finds when — not by transcribing and
reconciling. `speech.align` is one capability with two providers:

- `qwen-local`, the default: Qwen3-ForcedAligner-0.6B (MLX, 8-bit) in the
  voice worker, loaded on first use and kept, like the speech model. Free,
  offline after the first download (about 1.3 GB).
- `elevenlabs`, when a person asks for it: `POST /v1/forced-alignment`,
  paid, through the episode's spend ledger at an estimated price per
  minute (ElevenLabs returns none).

Nothing switches from one to the other on its own: an unreachable worker is
an error that says to start it.

Whatever the provider, its words go through the same post-processing in the
studio: they are mapped letter by letter onto the written text's own tokens
(a provider drops punctuation, splits or merges words, mishears one), kept
out of the silences ffmpeg measures (−35 dB, 0.10 s: a silence inside a
word leaves it the side with more speech), and made at least 80 ms long.
More than one token in ten without a word fails the alignment. The result is
a `WordTiming` (`method: "forced"`, provider and model recorded) written
beside the take, and `takes.json` names it.

One pass aligns at most 300 s of audio; longer takes are aligned in parts.

### The measurement behind it (2026-10-07)

On CreativeStudio's San Martino recital (Italian, 30.8 s, 62 words):
Qwen kept the exact text, 62 of 62 words; mlx-whisper small misheard
several ("ghierti", "più viginando", "come soli") and only 51 of its words
mapped back. Raw, the two agreed within 40 ms (median); Qwen's faults —
words running over the following pause, three of zero length — are what
the post-processing corrects, after which the ends agree within 80 ms
(p90), and where starts still differ the silences show Qwen right.
Alignment took 2.2 s once the model was loaded. CreativeStudio's recitals
run 19–43 s.

## Consequences

- Takes get their timing from their audio; a person no longer writes it.
- The voice worker gains a second model and a route; it stays one process.
- The ElevenLabs client (`@av/elevenlabs`) follows CreativeStudio's rate
  rules: one call at a time; two retries, only for 429 and 503 (answers
  that say nothing was processed), waiting `Retry-After` up to 30 s; never
  for auth, quota or another 5xx, after which the work may have been done
  and billed; a connection lost after sending is `uncertain` and not
  retried. Speech synthesis with ElevenLabs (`avg-8hs.1`) joins it.
- A token with no letters (a dash, an ellipsis, a guillemet) is not said:
  it takes no time, in the gap where it is written, and never counts as
  unmatched.
- Verifying a take against its text (missing words, long pauses) is
  `avg-8hs.3`; this only reports the pauses over 0.35 s.
- Added with `avg-dcf.3`: the timing also carries the take's energy — RMS
  per 1/30 s, divided by the 95th percentile of the frames above −50 dBFS
  and capped at 1, so one click does not flatten the voice and a silent
  take stays at 0 — measured with ffmpeg, whatever the provider; what moves
  with the voice (the interprete's mouth) reads it.
