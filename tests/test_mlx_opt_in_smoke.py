"""Apple-Silicon live smoke; opt in explicitly because it requires local weights."""

from __future__ import annotations

import os
import platform
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from qwen_tts_worker.app import create_app
from qwen_tts_worker.model_lifecycle import model_lifecycle


pytestmark = pytest.mark.skipif(
    os.environ.get("QTW_RUN_MLX_SMOKE") != "1",
    reason="set QTW_RUN_MLX_SMOKE=1 with QTW_MLX_SMOKE_MODEL to run local MLX smoke",
)


def test_two_live_segments_produce_valid_wav_with_one_model_load(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        pytest.fail("opt-in MLX smoke requires Apple Silicon")
    configured = os.environ.get("QTW_MLX_SMOKE_MODEL")
    if not configured:
        pytest.fail("QTW_MLX_SMOKE_MODEL must name an installed CustomVoice checkpoint")
    model = Path(configured).expanduser().resolve()
    if not (model / "model.safetensors").is_file():
        pytest.fail(f"configured smoke checkpoint is incomplete: {model}")
    monkeypatch.setenv("QTW_TTS_MODE", "live")
    monkeypatch.setenv("QTW_MODEL_PATH", str(model))
    monkeypatch.setenv("QTW_VOICES_DIR", str(tmp_path / "voices"))
    model_lifecycle.unload(wait=True)
    with TestClient(create_app()) as client:
        payload = {
            "text": "The archive belongs to you.",
            "voice": "serena",
            "language": "english",
            "seed": 42001,
        }
        first = client.post("/synthesize", json=payload)
        second = client.post("/synthesize", json={**payload, "text": "The message remains readable."})
        assert first.status_code == 202 and first.json()["ok"] is True
        assert second.status_code == 202 and second.json()["ok"] is True
        for response in (first, second):
            result = response.json()["result"]
            assert result["provider_mode"] == "live"
            assert result["sample_rate"] == 24000
            assert result["num_channels"] == 1
            assert result["duration_sec"] > 0
            assert Path(result["wav_path"]).stat().st_size > 44
        runtime = client.get("/models/runtime").json()
        assert runtime["load_count"] == 1
        assert runtime["synthesis_count"] == 2
        assert runtime["last_synthesis_seconds"] > 0
