# ASR pronunciation and continuity diagnostics

Issue `qtw-48r.5.2` evaluated two optional local diagnostics. Neither is authorized as an automatic acceptance gate.

## Reproducible environment

```bash
pip install -e '.[diagnostics]'
PYTHONPATH=src python evaluation/evaluate_advisory_diagnostics.py
```

Pinned tool: `mlx-whisper==0.4.3` with `mlx-community/whisper-tiny.en-mlx`, downloaded to the local Hugging Face cache. The frozen report records Python, MLX, NumPy, tool, model, source run, and per-segment output:

`evaluation/diagnostics/legacy-advisory-v1.json`

## Results

The English tiny model ran over repeat 1 of all 18 controlled-baseline segments:

- mean word error rate: **0.2744**;
- maximum WER: **1.5** on a short expressive line;
- 7/18 segments at or above 0.15 WER;
- only 4/16 lexicon target spellings observed as written;
- all 9 adjacent within-case boundaries measured locally.

Examples show why ASR is not a pronunciation oracle: uncommon names, phonetic spelling, amounts, issue IDs, acronyms, and command syntax were heavily substituted even when signal-valid. ASR disagreement cannot distinguish a TTS error from a recognizer error.

## Labeled calibration

Deterministic exact/case/punctuation positives and 25% omission/repetition/substitution negatives were generated over all fixture transcripts. At WER ≥ 0.15, edit accounting produced:

- 90 labeled text pairs;
- precision 1.0;
- recall 1.0;
- false-reject rate 0.0.

This validates the edit-distance implementation only. It is **not** end-to-end audio precision/recall and is explicitly labeled as such in evidence. A human-labeled accented/name/code audio corpus would be required before automatic gating.

## Continuity metrics

The local boundary diagnostic reports edge RMS jump, raw waveform step, and spectral-centroid jump. Four of nine baseline boundaries produced a note beyond the mandatory disclaimer. These measures can prioritize review and guide pause/fade experiments, but they are not speaker embeddings and cannot establish identity continuity.

A speaker-embedding gate was not adopted: no validated local speaker model or representative labeled same/different-speaker corpus is pinned, and false identity rejections would be costly. Blinded adjacent listening remains authoritative.

## Decision and limitations

- ASR text fidelity: **advisory**.
- Lexicon target observation: **advisory**.
- RMS/spectral boundary continuity: **advisory**.
- Automatic gate: **not authorized**.

Known limitations include English-only bias, accent/dialect/name/code-token errors, normalization behavior, short-utterance instability, and lack of a speaker-identity model. Diagnostics must never reject or remap a voice automatically in version 0.1.0.
