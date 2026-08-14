# Production narration acceptance

## Evidence status

The deterministic pipeline, controlled candidate, technical explainer, and multi-character fairy-tale paths have completed objective acceptance. Publication-quality improvement remains **unclaimed** until the predeclared three-listener blinded panel is complete and merged with objective gates.

## Controlled candidate

`candidate-qtw-v1` contains 18 fixture segments × 3 seeds. All 54 generations completed and passed signal checks. Repeat 1 mastered to 106.475125 seconds at -16.14 LUFS / -1.46 dBTP with no failed boundaries. Candidate tiny-English ASR WER was lower than the legacy baseline but remains advisory.

Prepare the complete listening panel:

```bash
cd qwen-tts-worker
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

## Technical explainer: JaroMail

Immutable run: `jaromail-20260731T215920Z`.

- Source: `library/dyne/software/jaromail/artifacts/narration-script.json`
- 7 scenes / 9 semantic segments
- 9/9 live attempts signal-accepted
- one warm 1.7B CustomVoice model load
- 189.524542-second final master
- -16.1 LUFS, -1.46 dBTP, LRA 3.3
- zero failed PCM boundaries
- exact scene-WAV reconstruction of the mastered PCM
- canonical narration manifest validated against `video-workspace-contracts` v1alpha1
- mixed image/VHS video recomposed at 1920×1080 H.264/AAC and fully decoded

Reproduce as a new immutable run:

```bash
cd qwen-tts-worker
PYTHONPATH=src .venv/bin/python evaluation/regenerate_jaromail.py
```

If synthesis and mastering completed but publication/composition failed, reuse the immutable run rather than regenerating speech:

```bash
PYTHONPATH=src .venv/bin/python evaluation/regenerate_jaromail.py \
  --resume-run <run-id>
```

## Multi-character fairy tale

Immutable run: `wolf-fairy-20260803T093134Z`.

- Source: `library/childrens/fairy-tales/the-wolf-and-the-seven-little-kids/artifacts/script.md`
- 8 scenes / 41 semantic segments
- reviewed mapping for all 16 quoted utterances
- narrator, mother, wolf, disguised-wolf, children, and youngest-child continuity profiles
- attribution text remained narrator speech
- 42 attempts: 41 accepted and 1 rejected
- only the rejected `No, no!` segment was rerun; seed 48015 was replaced by 49015
- manifest excludes the rejected attempt, includes its accepted retry, and preserves 40 unrelated accepted attempt IDs
- 292.310625-second final master
- -16.09 LUFS, -1.43 dBTP, LRA 5.7
- zero failed boundaries
- canonical manifest schema, exact scene PCM reconstruction, full video decode, and all eight midpoint visuals passed

Reproduce as a new immutable run:

```bash
cd qwen-tts-worker/evaluation
PYTHONPATH=../src ../.venv/bin/python accept_fairy_tale.py
```

Resume after a rejected attempt or pre-publication failure:

```bash
PYTHONPATH=../src ../.venv/bin/python accept_fairy_tale.py \
  --resume-run <run-id>
```

The command refuses unreviewed speaker attribution and keeps rejected attempts outside the accepted manifest.

## Published episode artifacts

Both acceptance runners atomically publish:

- per-scene canonical WAVs and measured sidecars;
- `artifacts/narration/narration-full.wav`;
- `artifacts/narration/narration-manifest.json`;
- mastering and regeneration reports;
- measured scene timing and retimed SRT captions;
- a recomposed H.264/AAC video.

Captions remain retimed SRT sidecars and are not burned into these renders, per user direction.

## Known limitations

- Signal validity, ASR diagnostics, mastering targets, and successful composition do not prove naturalness or pronunciation quality.
- The listener panel minimum is three, so uncertainty remains wide even if thresholds pass.
- CustomVoice preset identity does not implement VoiceDesign or reference cloning.
- Native MLX batching, generated personas, Base cloning, and constrained LLM spoken-language adaptation remain optional and evidence-gated.
- The prototype's missing `preprocessor.md` and `qwen3-voice-director.md` were never treated as available requirements.
