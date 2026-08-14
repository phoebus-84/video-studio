# Manifest-driven narration mastering

`qwen_tts_worker.narration_mastering` assembles accepted transformed speech and exact pause artifacts in explicit manifest order, then performs deterministic two-pass FFmpeg loudness mastering.

## Input invariants

Every `AssemblyEntry` names a unique segment and accepted attempt, quality report, transform, speech WAV, pause intent, and exact pause WAV when nonzero. Before assembly the masterer verifies:

- file size and SHA-256 against each immutable artifact;
- mono PCM16 at 24 kHz;
- pause samples are all zero and frame count matches requested milliseconds;
- no duplicate segment or accepted-attempt IDs;
- every speech→pause, pause→speech, or direct speech→speech sample step is at most 0.25 full scale.

Order comes only from the manifest tuple. Filenames are never sorted to infer narration order.

## Mastering profile

Profile `narration-web-v1` uses FFmpeg two-pass `loudnorm`:

- integrated loudness target: -16 LUFS;
- true-peak target: -1.5 dBTP;
- loudness range target: 11 LU;
- post-probe tolerance: ±0.6 LU and +0.2 dB true peak;
- final format: mono PCM16 at 24 kHz.

The final frame count must equal the sum of speech and pause frames within one sample. Failure of integrity, format, pause, boundary, duration, loudness, or peak checks removes partial output and blocks publication.

## Outputs

Under `attempt-store/mastered/<assembly-id>/`:

- `premaster.wav` — exact manifest-order speech+pause stream;
- `narration-full.wav` — mastered canonical output;
- `mastering-report.json` — immutable profile/FFmpeg identity, order, duration, boundaries, hashes, metrics, and canonical `NarrationManifest`.

The assembly ID hashes source revision, ordered accepted attempts, reports, transforms, artifact hashes, pause intent, and complete mastering profile. Repeating the same assembly cannot overwrite output. Clean roots produce byte-identical premaster and final WAV hashes under the pinned FFmpeg implementation.

## API

- `POST /narrations/master` accepts `AssemblyPlan` plus an optional validated profile.
- `GET /narrations/{assembly_id}` retrieves the persisted report and narration manifest.

Final video timing and captions must consume manifest order and measured artifact durations rather than stale sidecars or lexical filenames.
