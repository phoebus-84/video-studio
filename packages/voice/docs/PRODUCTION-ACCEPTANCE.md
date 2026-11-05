# Production narration acceptance

## Evidence status

The deterministic pipeline, the controlled candidate, and two production runs (a technical explainer and a multi-character fairy tale) have completed objective acceptance. Publication-quality improvement remains **unclaimed** until the predeclared three-listener blinded panel is complete and merged with objective gates.

## Controlled candidate

`candidate-qtw-v1` contains 18 fixture segments × 3 seeds. All 54 generations completed and passed signal checks. Repeat 1 mastered to 106.475125 seconds at -16.14 LUFS / -1.46 dBTP with no failed boundaries. Candidate tiny-English ASR WER was lower than the legacy baseline but remains advisory.

Prepare the complete listening panel:

```bash
cd packages/voice
PYTHONPATH=src .venv/bin/python evaluation/create_listening_review.py
open evaluation/runs/candidate-qtw-v1/results/listening-review.html
```

Each of three independent listeners must complete 54 isolated A/B items and one full-assembly continuity/boundary item. The page exports system-blind CSVs with side-specific issue flags. Do not share either withheld key until all CSVs are final.

After receiving exactly three files:

```bash
PYTHONPATH=src .venv/bin/python evaluation/analyze_listening_scores.py \
  path/to/listener-1.csv path/to/listener-2.csv path/to/listener-3.csv
```

The analyzer fails on missing/duplicate items, duplicate listener pseudonyms, invalid scores, absent playback evidence, or the wrong item schema. It reports unblinded aggregates, preference agreement, relative pronunciation flags, every predeclared listening threshold, and limitations. It deliberately does not authorize the final claim until objective and listening reports are reviewed together.

## Production runs

Two objective acceptance runs were made on real episodes, through runners
written for those two episodes: a technical explainer (7 scenes, 9 semantic
segments, all 9 attempts accepted, a 189.5 s master at -16.1 LUFS / -1.46
dBTP) and a multi-character fairy tale (8 scenes, 41 segments, 16 reviewed
quotes across six continuity profiles, one rejected attempt rerun alone, a
292.3 s master at -16.09 LUFS / -1.43 dBTP). Both had zero failed boundaries,
a valid canonical manifest and an exact scene-PCM reconstruction.

The runners named those episodes and their library paths, so they are not part
of this package: a voice tool knows nothing of a library. A run like them is a
studio procedure, made with the studio's narration tools.

## Known limitations

- Signal validity, ASR diagnostics, mastering targets, and successful composition do not prove naturalness or pronunciation quality.
- The listener panel minimum is three, so uncertainty remains wide even if thresholds pass.
- CustomVoice preset identity does not implement VoiceDesign or reference cloning.
- Native MLX batching, generated personas, Base cloning, and constrained LLM spoken-language adaptation remain optional and evidence-gated.
- The prototype's missing `preprocessor.md` and `qwen3-voice-director.md` were never treated as available requirements.
