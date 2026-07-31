# TTS quality evaluation

This directory owns the versioned evidence protocol for `qtw-48r`. It prevents quality decisions from being based on one favorable clip.

## Fixture

`fixtures/quality-v1.json` contains nine source cases and eighteen expected semantic segments across the project's two production domains: children's storytelling and technical explainers.

The expected spoken text is a reviewed target for deterministic preprocessing. It is not permission to rewrite source meaning. Each normalization decision and pronunciation override must remain source-mapped in the eventual segment plan.

Coverage includes:

- neutral and expressive narration;
- dialogue, attribution, questions, and exclamations;
- short fragments and long nested sentences;
- names and foreign words;
- numbers, dates, time, currency, abbreviations, symbols, and units;
- punctuation-heavy delivery;
- project names, versions, command flags, and identifiers;
- emotional transitions and three-segment continuity groups.

## Required run layout

Generated audio and machine-specific run data are not committed by default. A run tool should create:

```text
evaluation/runs/<run-id>/
├── run.json                  # immutable environment and profile manifest
├── segment-plan.json         # exact inputs generated from the fixture
├── attempts/
│   └── <segment-id>/<repeat>/
│       ├── request.json
│       ├── response.json
│       ├── raw.wav
│       └── signal-report.json
├── assembly/
│   ├── narration-manifest.json
│   ├── narration-full.wav
│   └── mastering-report.json
└── results/
    ├── objective.json
    ├── listening-key.json    # withheld until scoring closes
    ├── listening-scores.csv
    └── summary.md
```

Every run manifest must record:

- fixture file SHA-256 and version;
- repository revision and dirty status;
- exact model identity/hash and quantization;
- Python, mlx-audio, MLX, and worker versions;
- host OS, hardware, memory, and available disk;
- speaker, language, base/delta direction, and composed instruction;
- temperature, top-k, top-p, repetition penalty, max tokens, and seed;
- preprocessing, validator, post-processing, and mastering versions;
- per-attempt wall time, peak memory, status, and retry lineage.

The baseline and candidate must use the same fixture revision, host class, speaker assignment, repeat count, and listening protocol. Any unavoidable difference is declared before scoring.

## Repetition and seed protocol

- Generate at least **three attempts per expected segment** for stochastic profiles.
- Use a predeclared seed schedule shared by baseline and candidate when both support seeds.
- If the legacy path cannot set a seed, record that limitation and generate the same number of uncontrolled repeats.
- Never regenerate a missing or poor attempt merely to replace it. Retain the failed attempt and apply the bounded retry policy as additional evidence.
- Report attempt-level and segment-level regeneration rates.

## Optional advisory diagnostics

Install `.[diagnostics]` and run `PYTHONPATH=src python evaluation/evaluate_advisory_diagnostics.py` to reproduce pinned local tiny-English ASR and adjacent boundary metrics over baseline repeat 1. Frozen results live in `evaluation/diagnostics/legacy-advisory-v1.json`; high measured ASR error and documented bias explicitly prohibit automatic gating.

## Objective measurements

Required per attempt:

- decodable WAV, sample rate, channels, width, duration, and SHA-256;
- finite-sample and speech-presence checks;
- sample peak, clipped-sample ratio, RMS, and DC offset;
- leading and trailing silence;
- spoken words per minute;
- generation wall time and peak memory.

Required per assembled continuity group/final output:

- exact duration agreement with segment durations and intended pauses;
- integrated loudness, loudness range, and true peak;
- boundary silence and energy discontinuity;
- omission/repetition/substitution counts when an ASR diagnostic is enabled;
- pronunciation-error counts from the fixture notes;
- deterministic replay hash or measured output variance.

Objective metrics diagnose failures; they do not replace listening judgments.

## Blinded listening protocol

1. Include all completed baseline/candidate pairs. Do not select the best seed.
2. Loudness-match comparison playback without overwriting raw artifacts.
3. Randomize system labels independently per item (for example `A` and `B`).
4. Withhold `listening-key.json` from listeners until scoring closes.
5. Ask listeners to use headphones in a quiet environment and score each item once before optional replay.
6. Include isolated segments and assembled continuity groups.
7. Record listener identity pseudonym, playback setup, timestamp, scores, preference, and notes.
8. Report listener count, missing ratings, median/mean, confidence intervals where practical, and inter-rater agreement. A minimum panel size is an open project decision; never imply a panel when only one author listened.

### Segment rubric (1–5)

| Dimension | 1 | 3 | 5 |
|---|---|---|---|
| Text fidelity | omissions/repetitions or changed facts | intelligible with a minor error | exact intended content |
| Pronunciation | frequent or severe errors | one noticeable error | all target terms natural/correct |
| Naturalness | robotic, broken, or artifact-heavy | generally natural with awkward phrasing | convincingly human-like |
| Pacing | rushed, dragging, or erratic | acceptable but imperfect | intentional and effortless |
| Emotional fit | wrong or distracting | broadly appropriate | precise without overacting |
| Voice identity | wrong/unstable preset impression | mostly stable | unmistakably stable |
| Overall | unusable | usable with edits | publication-ready |

### Continuity/boundary rubric (1–5)

| Dimension | 1 | 3 | 5 |
|---|---|---|---|
| Identity continuity | sounds like different speakers | small timbre shift | stable performer throughout |
| Prosody continuity | every segment audibly resets | occasional reset | one continuous performance |
| Level continuity | disruptive loudness jumps | minor mismatch | matched natural level |
| Boundary quality | clicks, clipping, truncation, duplication | boundary noticeable | boundary not distracting |
| Pause intent | gaps absent or arbitrary | mostly plausible | semantically natural |
| Transition fit | emotional change is abrupt/wrong | understandable | deliberate and convincing |

For every item, listeners also choose `A`, `B`, or `no preference`, and may flag pronunciation, omission, repetition, clipping, breath, pause, or identity problems.

## Current candidate

`candidate-qtw-v1` completed 54/54 seeded live generations and all objective gates. Compact evidence is under `evaluation/candidates/`; raw audio and the randomized 54-item A/B package remain under ignored `evaluation/runs/candidate-qtw-v1/`. No listener scores exist, so `evaluation/acceptance-v1.json` blocks a quality claim.

## Acceptance and reporting

Before baseline capture, the project must set numeric thresholds for signal validity. Before claiming a candidate improvement, it must set aggregate listening acceptance thresholds without seeing candidate labels.

At minimum, a candidate report must include:

- every fixture and repeat, including failures;
- aggregate and per-category scores;
- pronunciation errors and continuity/boundary flags;
- objective signal/mastering results;
- regeneration rate, wall time, and peak memory;
- statistically or practically meaningful improvements;
- all regressions and unresolved limitations.

A single impressive sample is never evidence of completion.
