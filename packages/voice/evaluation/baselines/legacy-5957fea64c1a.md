# Controlled legacy baseline: `legacy-5957fea64c1a`

Status: **capture complete; listening evaluation not yet performed**

This baseline freezes the observable legacy `/synthesize` behavior before the P0 routing and fail-closed correction. It is evidence, not an assertion that the legacy clips are good.

## Identity

| Item | Value |
|---|---|
| Worker revision | `5957fea64c1a` (dirty worktree; exact relevant source hashes are in the manifest) |
| Fixture | `qtw-quality-core` v1.0.0 |
| Fixture SHA-256 | `55ebc47e3df8fc06911ffdcd3ce1882e853e408ae0c8362f0145ec17578af74e` |
| Model | Qwen3-TTS 1.7B CustomVoice, local MLX 8-bit |
| Model weights SHA-256 | `b696f4bf45f54497b6de758981e76f1410bd68af05a657477dee466b0202df1a` |
| mlx-audio / MLX | 0.4.6 / 0.32.0 |
| Host | Apple Silicon macOS, 64 GiB physical memory |
| Repeats | 3 uncontrolled stochastic attempts per segment |
| Voices | `serena` for narrator, `vivian` for Mira |
| Input policy | Expected segment `display_text`; expected `spoken_text` retained as candidate normalization target |

The current API cannot set a seed, top-k, top-p, repetition penalty, or max tokens. It accepts `language` but does not forward it as Qwen `lang_code`. Those limitations are part of this baseline rather than silently normalized away.

## Completeness

- 9/9 fixture cases captured.
- 18/18 expected segments captured.
- 54/54 required attempts retained.
- 54/54 WAVs passed the cheap PCM/speech-presence checks.
- 0 attempts were replaced or discarded.
- 9 first-repeat case assemblies reproduce the legacy direct-concatenation policy, with no inserted pause or mastering stage.

## Objective snapshot

| Metric | Result |
|---|---:|
| Total generation wall time | 491.294 s |
| Per-attempt wall time, median (range) | 7.809 s (1.343–25.491) |
| Audio duration, median (range) | 4.760 s (0.560–14.720) |
| RMS, median (range) | -24.505 dBFS (-27.591 to -16.562) |
| Peak, median (range) | -7.830 dBFS (-11.355 to -3.180) |
| Leading silence, median | 89.646 ms |
| Trailing silence, median | 35.084 ms |
| Estimated pace, median | 142.125 spoken words/minute |
| Maximum clipped-sample ratio | 0 |
| Maximum observed server RSS after a request | 3,315,171,328 bytes |
| Local evidence size | 19,730,757 bytes |

“Signal-valid” only means a WAV is decodable, non-silent, canonical mono PCM, and below the cheap clipping threshold. It does **not** establish text fidelity, correct pronunciation, naturalness, voice continuity, or publication readiness. Those require the blinded listening protocol in `evaluation/README.md`.

## Evidence locations

Tracked compact evidence:

- `evaluation/baselines/legacy-5957fea64c1a.manifest.json`
- `evaluation/baselines/legacy-5957fea64c1a.objective.json`

Local raw evidence (intentionally ignored to avoid silently adding generated media to Git):

- `evaluation/runs/legacy-5957fea64c1a/`
- 54 request/response/raw-WAV/signal-report attempt bundles
- 9 direct-concatenated case WAVs and assembly manifest

Recreate or resume on the original machine with:

```bash
.venv/bin/python evaluation/capture_legacy_baseline.py \
  --output evaluation/runs/legacy-5957fea64c1a \
  --repeats 3 \
  --server-pid <worker-pid>
```

The capture tool resumes existing attempt bundles and never overwrites a completed attempt.

## Historical episode audio classification

All pre-existing episode and worker-output audio outside this run is classified **legacy-uncontrolled**. It remains useful for migration checks and defect discovery, but it is not a controlled baseline because source/profile/seed/runtime provenance is incomplete. The previously inspected 29 worker-output WAVs were silent; this controlled CustomVoice run was not silent. Both observations are retained rather than conflated.
