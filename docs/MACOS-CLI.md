# macOS installation and CLI

This is the supported single-user workflow for a local Apple-Silicon Mac. It installs no root daemon, opens no remote listener, and keeps model, voice, and output data under the current user's Library.

## Prerequisites

- Apple Silicon (`arm64`) macOS 14 or later;
- Python 3.10-3.12 (3.12 is the release-test target);
- FFmpeg available on `PATH` (`brew install ffmpeg`);
- enough free disk: about 4.3 GiB for each 1.7B 8-bit profile plus temporary download headroom.

## Install the tool and models

```bash
cd qwen-tts-worker
python3.12 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/pip install --require-hashes -r requirements.txt
.venv/bin/pip install --no-deps -e .

# Preset speakers:
.venv/bin/qwen-tts install 1.7B --profile custom_voice
# Reference-audio cloning:
.venv/bin/qwen-tts install 1.7B --profile base
```

On macOS the unified CLI defaults to:

```text
~/Library/Application Support/QwenTTSWorker/models
```

Each install is pinned, verified, restart-safe, and atomic. Rerunning an installed command is idempotent. A conflicting snapshot is preserved until the operator explicitly passes `--replace`.

## Foreground service

```bash
QTW_MODELS_DIR="$HOME/Library/Application Support/QwenTTSWorker/models" \
QTW_VOICES_DIR="$HOME/Library/Application Support/QwenTTSWorker/voices" \
QTW_OUTPUTS_DIR="$HOME/Library/Application Support/QwenTTSWorker/outputs" \
.venv/bin/qwen-tts serve
```

The default endpoint is `http://127.0.0.1:8000`; models load lazily and remain warm. Ctrl+C triggers graceful draining.

## Per-user LaunchAgent

```bash
.venv/bin/qwen-tts service install
.venv/bin/qwen-tts service start
.venv/bin/qwen-tts service status
.venv/bin/qwen-tts doctor
```

The generated private plist is:

```text
~/Library/LaunchAgents/org.agenticvideo.qwen-tts-worker.plist
```

It records the exact active virtual-environment Python, binds `127.0.0.1`, runs one MLX worker, sets `QTW_TTS_MODE=live`, uses a process umask of `077`, and writes logs under `~/Library/Logs/QwenTTSWorker`. It does not silently restart after a clean operator shutdown; crashes are restartable.

Stop or uninstall without deleting models, voices, or outputs:

```bash
.venv/bin/qwen-tts service stop
.venv/bin/qwen-tts service uninstall
```

## Diagnostics

```bash
.venv/bin/qwen-tts doctor
.venv/bin/qwen-tts doctor --json
```

`doctor` returns nonzero unless macOS/arm64, supported Python, FFmpeg, MLX packages, disk headroom, at least one verified model, and the worker health endpoint all pass. JSON mode is appropriate for scripts and support bundles.

## Preset synthesis

```bash
.venv/bin/qwen-tts synthesize \
  --text 'Morning light crossed the wooden floor.' \
  --voice serena --language english --seed 42 \
  --output ~/Desktop/narration.wav
```

`--file script.txt` replaces `--text`; when neither is supplied, UTF-8 text is read from stdin. The CLI fails if the API result is terminally failed or the worker's immutable local WAV is unavailable. Destination publication uses a temporary sibling and atomic rename.

## Clone workflow

```bash
.venv/bin/qwen-tts clone enroll \
  --name 'My narrator' \
  --reference ~/recordings/reference.wav \
  --transcript 'The exact words spoken in the reference recording.' \
  --source self_recorded \
  --consent-statement 'I recorded this and consent to local voice cloning.' \
  --license-or-terms 'Recording owner consent'

.venv/bin/qwen-tts clone synthesize <VOICE_UUID> \
  --text 'This line uses the enrolled local voice.' \
  --language english --model-size 1.7B --seed 42 \
  --output ~/Desktop/cloned.wav

.venv/bin/qwen-tts voices list
.venv/bin/qwen-tts voices show <VOICE_UUID>
.venv/bin/qwen-tts voices delete <VOICE_UUID>
```

Read [VOICE-CLONING.md](VOICE-CLONING.md) before enrollment. The CLI deliberately has no flag that bypasses consent or substitutes an inferred transcript.

## Recovery

1. `qwen-tts doctor --json` for exact failing checks.
2. `qwen-tts service status` and the two files under `~/Library/Logs/QwenTTSWorker`.
3. `qwen-tts models` (or `curl -sS http://127.0.0.1:8000/models`) for JSON per-profile integrity status.
4. Rerun `qwen-tts install SIZE --profile PROFILE`; add `--replace` only after reviewing an integrity mismatch.
5. `curl -X DELETE http://127.0.0.1:8000/models/runtime` to unload a warm idle model. A leased model returns 409 instead of interrupting synthesis.

Never set `QTW_TTS_MODE=fake` for this service. Fake mode exists only for tests and emits labeled silent fixtures that are not publishable.
