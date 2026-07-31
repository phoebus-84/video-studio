# Conservative edge processing and pauses

`qwen_tts_worker.audio_processing` transforms only immutable attempts with an accepted quality report. Raw WAVs are never modified.

## Enabled policy

Policy `conservative-edges-v1`:

1. verifies mono PCM16 at 24 kHz;
2. locates samples above -45 dBFS;
3. retains an 80 ms margin before the first and after the last active sample;
4. removes no more than 1500 ms from either edge;
5. refuses transforms leaving under 100 ms of speech;
6. preserves the complete threshold-active sample sequence byte-for-byte;
7. emits an exact separate zero-valued pause WAV from manifest intent;
8. applies no fade or in-place format conversion.

Every report links attempt, quality report, raw hash, complete policy fingerprint, transformed speech/pause hashes, trim counts, active positions/hash, and exact requested/realized pause.

## Baseline A/B evidence

Reproduce with:

```bash
PYTHONPATH=src python evaluation/evaluate_edge_processing.py
```

Frozen evidence: `evaluation/diagnostics/legacy-edge-ab-v1.json`.

Across repeat 1 of all 18 controlled baseline segments:

- all active sample sequences remained byte-identical;
- all 18 files had a small edge-only change;
- total removed duration was 0.2146 seconds;
- median removed duration was 0.0126 seconds;
- maximum removed duration was 0.0330 seconds;
- median implicit adjacent edge gap changed from 105.9 to 96.2 ms before explicit pause intent;
- all 9 adjacent fixture boundaries were reported.

This supports the transform's conservative mechanics, not a perceptual quality claim.

## Why micro-fades are disabled

A fade necessarily changes active samples and can soften plosives or low-amplitude onsets. The current representative evidence does not include a blinded boundary result proving benefit. Separate zero-valued pauses prevent direct nonzero joins when a pause is requested, so micro-fades remain disabled until listening evidence justifies a new policy version.

## Fail-closed behavior

Rejected/review-only attempts, mismatched reports, changed raw bytes, noncanonical WAVs, silence, duplicate transform paths, and transforms that would leave too little speech all fail. A manual quality override remains visible through its actor/reason in the linked report.
