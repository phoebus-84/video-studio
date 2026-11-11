# Portable local inference

The HTTP/CLI worker, consent checks, warm model lifecycle, durable jobs, quality
gate and canonical mono PCM16/24 kHz output are shared. Only inference changes.

## Selected backends

| Hardware | Backend | Default execution |
|---|---|---|
| Apple Silicon/macOS | MLX | Existing quantized MLX checkpoints, Metal |
| Intel/AMD CPU, including x64 Linux/Windows and Intel Mac | Official Qwen/PyTorch | CPU, float32, SDPA |
| Supported NVIDIA GPU | Official Qwen/PyTorch | CUDA, BF16 when supported, otherwise FP16, SDPA |
| Supported AMD GPU/Linux | Official Qwen/PyTorch with ROCm wheels | PyTorch's `cuda:N` device API, BF16/FP16 |

`QTW_BACKEND=auto` selects MLX on Apple Silicon and Torch elsewhere. Torch's
`QTW_DEVICE=auto` chooses an available CUDA/ROCm GPU, otherwise CPU.
An **explicit** backend/device/precision/attention request is never silently
changed after a missing dependency, allocation error or generation failure.
Install only the runtime you intend to use; auto does not download/install one.

CPU is the portable correctness baseline, not a claim of real-time speech or
the fastest implementation on every processor. There is no universal “best”
thread count, precision or attention kernel: benchmark the deployment hardware.

## Install

Python 3.12 is the tested baseline. From the repository root:

```sh
python3.12 -m venv .venv-voice
# POSIX; Windows PowerShell: .venv-voice\Scripts\Activate.ps1
. .venv-voice/bin/activate
```

For CPU, install CPU-only Torch wheels first (Linux/Windows):

```sh
python -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
python -m pip install -e 'packages/voice[torch]'
```

For NVIDIA or AMD, first choose the **matching PyTorch/Torchaudio wheels** from
[PyTorch's installer](https://pytorch.org/get-started/locally/) for the GPU,
driver and OS; then install `packages/voice[torch]`. A normal CPU pip install
does not promise GPU support. ROCm support is constrained by AMD's hardware/OS
matrix; Vulkan/DirectML are not provided by this backend.

On Apple Silicon retain the existing hash-locked MLX installation in
[the README](../README.md). On macOS, Torch can also be selected explicitly
for CPU testing; install the macOS Torch wheels, not the Linux CPU index.

Install the checkpoint **for the same backend used to serve**:

```sh
qwen-tts --backend torch install 0.6B
qwen-tts --backend torch --device cpu serve
# For a CUDA/ROCm installation:
qwen-tts --backend torch --device cuda:0 serve
```

PowerShell uses the same CLI commands. Configuration variables are set with
`$env:QTW_DTYPE = "float32"`, rather than POSIX `export`.

Torch checkpoints come from Qwen's official repositories, pinned to commit
revisions and critical SHA-256 hashes in `models/torch-catalog.json`. They live
in distinct `*-torch` directories. MLX `*-8bit` checkpoints are **not**
PyTorch weights, are never overwritten, and cannot be renamed to convert them.
The same five size/profile combinations are catalogued for each backend.
CustomVoice synthesis and consent-gated Base cloning are routed end to end;
VoiceDesign remains catalogue/install-only, as before this change.

FFmpeg/ffprobe remain required for reference preparation and mastering.
Upstream Qwen may warn about a missing SoX binary; install SoX when using an
upstream feature that needs it. The preset CPU smoke works without it.

## Execution and optimization controls

| Variable | Values / behavior |
|---|---|
| `QTW_BACKEND` | `auto` (default), `mlx`, `torch` |
| `QTW_DEVICE` | `auto`, `cpu`, `cuda`, `cuda:N`; ROCm uses the CUDA API too |
| `QTW_DTYPE` | `auto`, `float32`, `float16`, `bfloat16` |
| `QTW_ATTENTION` | `sdpa` (default), `eager`, `flash_attention_2` |
| `QTW_CPU_THREADS` | Optional 1–1024; only CPU; otherwise Torch's existing thread count |

SDPA uses PyTorch's supported optimized kernels rather than requiring
FlashAttention to install on every machine. FlashAttention 2 is explicit:
install a compatible `flash-attn` build, select a supported NVIDIA GPU and
FP16/BF16, then opt in. Missing FA2 fails rather than pretending it was used.
The project's FA2 policy does not enable ROCm builds automatically.

CPU FP16 is rejected. CPU BF16 is opt-in: measure instruction support,
numerical behavior, quality and latency on the actual CPU before choosing it.
MLX owns its existing quantization/attention; Torch tuning flags with MLX fail.

Models stay warm between calls. Inference mode disables gradient bookkeeping;
CPU thread tuning is applied once at load. Seeding and inference are serialized
to avoid concurrent requests racing RNG state. Torch restores CPU and selected
GPU RNG state, maps sampling to both Talker and Predictor, and records the
resolved runtime. Seeds are **not** promises of bit-identical speech across
backends, devices, dependency versions or quantizations.

## Readiness and provenance

`GET /models/backend` reports resolved runtime options and feature scope.
`GET /models/runtime` reports the warm model, counters, timings and selected
Torch runtime; `qwen-tts --backend torch doctor` checks the selected dependencies.
A probe is not a synthesis-quality approval or evidence that weights are ready.

Successful compatibility and clone responses record `runtime`. Portable
durable profiles must include `model.runtime`, exactly matching the worker's
resolved runtime (from `/models/backend`), and the installed weight SHA-256.
Legacy `mlx_audio_version` / `mlx_version` fields remain for compatibility;
set them to `"not-applicable"` in Torch profiles. The canonical narration
contract optionally preserves runtime identity too. Runtime changes affect
fingerprints; old MLX fingerprints without this field retain their exact
historical calculation. Backend, device, precision, attention, thread count,
runtime/engine versions and decoder identity are not silently shared in cache.

**Separate features:** forced alignment, transcription and the optional ASR
quality diagnostics still use MLX. They are not made portable by installing
Torch, are declared unavailable on the portable backend, and fail explicitly.
This PR expands local **TTS and cloning**, not every speech-analysis provider.
The official Qwen ASR package also currently pins a different Transformers
version from Qwen TTS; forcing both into one environment is not a safe solution.

On Windows, LaunchAgent service management is not applicable. Run the worker
in the foreground or configure an OS service separately, and keep voice stores
under a private user directory with appropriate Windows ACLs. POSIX chmod
fixtures do not prove Windows reference-store permissions.

## Validation

```sh
python -m pip install -e 'packages/voice[dev]'
python -m pytest packages/voice/tests -q
```

The CPU/CUDA/ROCm selection and adapters are tested with controlled doubles
without a GPU or model download. The CI matrix runs the complete POSIX suite
on Linux/macOS and portable tests on Windows. It does not imply GPU validation.

To run actual synthesis, explicitly install the public 0.6B CustomVoice
checkpoint first, then set the following environment variables (PowerShell:
use `$env:NAME = "value"`):

```sh
export QTW_RUN_TORCH_SMOKE=1
export QTW_TORCH_SMOKE_MODEL="$PWD/packages/voice/models/qwen3-tts-0.6b-customvoice-torch"
export QTW_TORCH_SMOKE_DEVICE=cpu
export QTW_SMOKE_REPORT="$PWD/packages/voice/tmp/cpu-report.json"
python -m pytest packages/voice/tests/test_torch_opt_in_smoke.py -q -s
```

The smoke synthesizes English and Italian offline, checks non-silent canonical
WAVs, one model load for two requests and records cold/warm timing. It does
not enroll a human voice or publish audio. The opt-in **Voice CPU live smoke** workflow (manual dispatch, or the
`voice-live-smoke` label on a pull request) runs the same check on a Linux x64 runner and publishes only JSON
measurements, not model weights or audio. For a GPU run set the smoke device
to the installed device; GPU performance remains unverified until measured.

## Why not make GGUF the default?

GGUF is a container, not a complete speech inference engine. The Talker,
Predictor, text tokenizer, reference encoder and audio decoder must all work,
and parameter mapping, consent, language support, cancellation/output
validation and provenance must remain intact.

The inspected [Qwen3-TTS-GGUF](https://github.com/HaujetZhao/Qwen3-TTS-GGUF)
implementation combines llama.cpp and ONNX Runtime and is a promising
quantized/Vulkan path, but currently requires Python 3.14 and additional
native/runtime artifacts, with Windows-specific distribution assumptions.
[qwen3-tts.cpp](https://github.com/predict-woo/qwen3-tts.cpp) advertises a
complete C++/GGML pipeline, but does not establish parity with this worker's
five checkpoint profiles and preset endpoint.

These are candidates for an independently pinned, benchmarked adapter, not
dependencies to smuggle into the existing production environment. This change
chooses official Qwen compatibility and explicit tuning over an unsupported
claim of universal fastest inference. No GGUF backend is advertised as working.
