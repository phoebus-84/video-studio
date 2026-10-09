"""POST /transcribe (avg-8hs.3): what a take actually says, with word times.

The live transcriber is Whisper large-v3-turbo through mlx-whisper; these
tests inject the model's call, so nothing is downloaded. A real transcription
is opt-in: QTW_TRANSCRIBE_LIVE=1 (macOS ``say`` makes the speech).
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from qwen_tts_worker.transcription import TranscribeError, Transcriber, language_code


def _tone(path: Path, seconds: float) -> Path:
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
         f"sine=frequency=220:duration={seconds}", "-ar", "16000", str(path)],
        check=True,
    )
    return path


def _whisper_result(words):
    return {"text": " ".join(w[0] for w in words), "segments": [{"words": [
        {"word": f" {w}", "start": s, "end": e, "probability": p} for (w, s, e, p) in words
    ]}]}


@pytest.fixture
def fake_client(tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setenv("QTW_TTS_MODE", "fake")
    for name in ("MODELS", "VOICES", "OUTPUTS", "ATTEMPT_STORE"):
        monkeypatch.setenv(f"QTW_{name}_DIR", str(tmp_path / name.lower()))
    from qwen_tts_worker.app import create_app
    from qwen_tts_worker.routes import transcription
    transcription.reset()
    return TestClient(create_app())


class TestTranscriber:
    def test_returns_the_words_heard_with_their_times(self, tmp_path):
        audio = _tone(tmp_path / "take.wav", 2.0)
        calls = []

        def run(path, **kwargs):
            calls.append((path, kwargs))
            return _whisper_result([("La", 0.1, 0.3, 0.99), ("nebbia", 0.3, 0.8, 0.95)])

        result = Transcriber("some/model", run=run).transcribe(str(audio), "it")
        assert result["text"] == "La nebbia"
        assert result["words"] == [
            {"text": "La", "start": 0.1, "end": 0.3, "probability": 0.99},
            {"text": "nebbia", "start": 0.3, "end": 0.8, "probability": 0.95},
        ]
        assert result["model"] == "some/model"
        assert result["language"] == "it"
        assert calls[0][1] == {"path_or_hf_repo": "some/model", "language": "it", "word_timestamps": True, "condition_on_previous_text": False}

    def test_language_by_code_region_or_name(self):
        assert language_code("it-IT") == "it"
        assert language_code("Italian") == "it"
        assert language_code("xx") is None

    def test_refuses_what_it_cannot_transcribe(self, tmp_path):
        t = Transcriber("m", run=lambda *a, **k: _whisper_result([]))
        with pytest.raises(TranscribeError) as missing:
            t.transcribe(str(tmp_path / "nothing.wav"), "it")
        assert missing.value.code == "bad-audio"
        with pytest.raises(TranscribeError) as language:
            t.transcribe(str(_tone(tmp_path / "a.wav", 1.0)), "klingon")
        assert language.value.code == "unsupported-language"

    def test_a_model_that_cannot_load_says_so(self, tmp_path):
        def broken(*_a, **_k):
            raise OSError("no network")

        with pytest.raises(TranscribeError) as error:
            Transcriber("m", run=broken).transcribe(str(_tone(tmp_path / "a.wav", 1.0)), "it")
        assert error.value.code == "transcriber-failed"


class TestTranscribeRoute:
    def test_fake_mode_hears_nothing_and_says_so(self, fake_client, tmp_path):
        audio = _tone(tmp_path / "take.wav", 1.0)
        response = fake_client.post("/transcribe", json={"audio_path": str(audio), "language": "it"})
        assert response.status_code == 200, response.text
        assert response.json() == {"text": "", "words": [], "model": "fake-transcriber", "language": "it"}

    def test_reports_the_transcriber(self, fake_client):
        body = fake_client.get("/transcribe").json()
        assert body["model"] == "fake-transcriber"
        assert body["loaded"] is False

    def test_bad_requests_name_their_reason(self, fake_client, tmp_path):
        response = fake_client.post("/transcribe", json={"audio_path": "relative.wav", "language": "it"})
        assert response.status_code == 422
        assert response.json()["detail"][0]["type"] == "bad-audio"


@pytest.mark.skipif(os.environ.get("QTW_TRANSCRIBE_LIVE") != "1" or shutil.which("say") is None, reason="live transcription is opt-in")
def test_live_transcription_hears_italian(tmp_path):
    audio = tmp_path / "say.aiff"
    subprocess.run(["say", "-v", "Alice", "-o", str(audio), "La nebbia agli irti colli piovigginando sale"], check=True)
    result = Transcriber("mlx-community/whisper-large-v3-turbo").transcribe(str(audio), "it")
    assert "nebbia" in result["text"].lower()
    assert all(w["end"] >= w["start"] for w in result["words"])
