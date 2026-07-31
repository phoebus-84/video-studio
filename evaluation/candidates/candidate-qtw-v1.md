# Candidate `candidate-qtw-v1`

Status: **objective run complete; quality claim blocked on blinded human listening**.

## Frozen inputs

- Fixture: `quality-v1`, 18 segments, 9 cases.
- Repeats: 3 per segment (54 total).
- Predeclared seeds: 42001, 42002, 42003.
- Acceptance thresholds: `evaluation/acceptance-v1.json`, committed before generation.
- Model: `mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit`.
- Model weights SHA-256: `b696f4bf45f54497b6de758981e76f1410bd68af05a657477dee466b0202df1a`.
- Runtime: mlx-audio 0.4.6, MLX 0.32.0.
- Narrator: Serena; Mira dialogue: Vivian.
- Raw run: `evaluation/runs/candidate-qtw-v1/` (local, Git-ignored).
- Compact machine evidence: `candidate-qtw-v1.json`.

## Reliability and objective results

- Generation: 54/54 completed; no replacement attempts.
- Signal decisions: 54 accept, 0 review, 0 reject.
- Mean generation time: 6.057 s; total 327.079 s.
- Peak MLX memory: 7,463,066,425 bytes.
- Invalid WAVs: 0; clipped attempts: 0.
- Mean duration: candidate 5.855 s, baseline 5.687 s.
- Mean RMS: candidate -24.444 dBFS, baseline -24.163 dBFS.
- Mean peak: candidate -7.612 dBFS, baseline -7.708 dBFS.
- Mean speech rate: candidate 139.49 WPM, baseline 138.74 WPM.

The advisory tiny-English ASR mean WER decreased from 0.2744 on baseline repeat 1 to 0.1738 on candidate repeat 1, with 6/18 candidate segments at or above 0.15. This remains advisory and is not a quality threshold.

## Assembly and mastering

Repeat 1 of all 18 segments passed transform and assembly gates:

- Manifest order: exact fixture order.
- Final duration: 106.475125 s.
- Integrated loudness: -16.14 LUFS.
- True peak: -1.46 dBTP.
- Loudness range: 3.5 LU.
- Boundary failures: 0.
- Final WAV SHA-256: `e28ac43d4fd1c8030e2f66e93ec672a555ca803321e3faae3457023c102b8148`.

## Blinded review blocker

The local run contains a deterministic 54-item randomized A/B package and withheld key under `results/`. No scores have been entered. The predeclared acceptance policy requires three independent listeners and complete item coverage. Therefore:

- no naturalness, pronunciation, emotional-fit, identity-continuity, or publication-quality claim is authorized;
- `qtw-48r.6.1` remains open;
- all generated attempts and limitations are retained.
