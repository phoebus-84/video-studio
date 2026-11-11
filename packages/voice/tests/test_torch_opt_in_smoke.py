"""Real local inference. Explicit opt-in; never downloads or uses a production voice."""
from __future__ import annotations
import hashlib
import json
import os
import platform
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from qwen_tts_worker.app import create_app
from qwen_tts_worker.model_lifecycle import model_lifecycle
from qwen_tts_worker.routes.synthesis import validate_live_wav

pytestmark = pytest.mark.skipif(os.environ.get("QTW_RUN_TORCH_SMOKE") != "1",
                               reason="opt in with QTW_RUN_TORCH_SMOKE=1 and QTW_TORCH_SMOKE_MODEL")


def test_two_real_segments_share_one_warm_model(tmp_path, monkeypatch):
    configured = os.environ.get("QTW_TORCH_SMOKE_MODEL")
    if not configured:
        pytest.fail("QTW_TORCH_SMOKE_MODEL must name an installed official CustomVoice checkpoint")
    model = Path(configured).expanduser().resolve()
    monkeypatch.setenv("QTW_BACKEND", "torch")
    monkeypatch.setenv("QTW_DEVICE", os.environ.get("QTW_TORCH_SMOKE_DEVICE", "cpu"))
    monkeypatch.setenv("QTW_CPU_THREADS", "2")
    if os.environ["QTW_DEVICE"] != "cpu":
        monkeypatch.delenv("QTW_CPU_THREADS")
    monkeypatch.setenv("QTW_TTS_MODE", "live")
    monkeypatch.setenv("QTW_MODEL_PATH", str(model))
    for name in ("VOICES", "OUTPUTS", "MODELS"):
        monkeypatch.setenv("QTW_"+name+"_DIR", str(tmp_path/name.lower()))
    model_lifecycle.unload(wait=True)
    before = model_lifecycle.snapshot()
    results = []
    with TestClient(create_app()) as client:
        for language, text in (("english", "This voice runs locally."), ("italian", "Questa voce funziona in locale.")):
            start = time.monotonic()
            response = client.post("/synthesize", json={"text":text,"voice":"ryan",
                                    "language":language,"seed":42001,"max_tokens":128})
            assert response.status_code == 202 and response.json()["ok"], response.text
            result = response.json()["result"]
            data = Path(result["wav_path"]).read_bytes()
            info = validate_live_wav(data)
            assert result["provider_mode"] == "live" and result["runtime"]["backend"] == "torch"
            elapsed = time.monotonic()-start
            results.append({"language":language,"duration_seconds":info.duration_seconds,
                            "wall_seconds":elapsed,"rtf":elapsed/info.duration_seconds,
                            "wav_sha256":hashlib.sha256(data).hexdigest()})
        snapshot = client.get("/models/runtime").json()
        assert snapshot["load_count"]-before.load_count == 1
        assert snapshot["synthesis_count"]-before.synthesis_count == 2
        report = {"hardware":{"system":platform.system(),"machine":platform.machine()},
                  "model_identity_sha256":snapshot["identity_sha256"],"runtime":snapshot["runtime"],
                  "load_seconds":snapshot["load_latency_seconds"],"segments":results,
                  "scope":"Technical signal/warm-cache smoke only, not a listening-quality approval."}
        print(json.dumps(report, indent=2))
        if output := os.environ.get("QTW_SMOKE_REPORT"):
            Path(output).write_text(json.dumps(report, indent=2)+"\n")
