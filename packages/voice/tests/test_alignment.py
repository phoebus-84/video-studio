"""POST /align (avg-8hs.2): word timing by forced alignment against known text.

The live aligner is Qwen3-ForcedAligner through mlx-audio; these tests use the
worker's explicit fake mode and an injected model, so nothing is downloaded.
A real alignment is opt-in: QTW_ALIGN_LIVE=1 (macOS ``say`` makes the speech).
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from qwen_tts_worker.alignment import AlignError, Aligner, language_name


def _tone(path: Path, seconds: float) -> Path:
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
         f"sine=frequency=220:duration={seconds}", "-ar", "16000", str(path)],
        check=True,
    )
    return path


@pytest.fixture
def fake_client(tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setenv("QTW_TTS_MODE", "fake")
    for name in ("MODELS", "VOICES", "OUTPUTS", "ATTEMPT_STORE"):
        monkeypatch.setenv(f"QTW_{name}_DIR", str(tmp_path / name.lower()))
    from qwen_tts_worker.app import create_app
    from qwen_tts_worker.routes import alignment
    alignment.reset()
    return TestClient(create_app())


def _code(response) -> str:
    return response.json()["detail"][0]["type"]


class TestAlignRoute:
    def test_fake_mode_spreads_the_words_over_the_audio(self, fake_client, tmp_path):
        audio = _tone(tmp_path / "take.wav", 2.0)
        response = fake_client.post("/align", json={"audio_path": str(audio), "text": "La nebbia sale", "language": "it"})
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["model"] == "fake-aligner"
        assert body["language"] == "Italian"
        assert [w["text"] for w in body["words"]] == ["La", "nebbia", "sale"]
        assert body["words"][0]["start"] == 0
        assert abs(body["words"][-1]["end"] - 2.0) < 0.05
        starts = [w["start"] for w in body["words"]]
        assert starts == sorted(starts)

    def test_reports_the_aligner(self, fake_client):
        body = fake_client.get("/align").json()
        assert body == {"model": "fake-aligner", "loaded": False, "maxSeconds": 300}

    def test_refuses_audio_over_five_minutes(self, fake_client, tmp_path):
        audio = _tone(tmp_path / "long.wav", 301)
        response = fake_client.post("/align", json={"audio_path": str(audio), "text": "parole", "language": "it"})
        assert response.status_code == 422
        assert _code(response) == "too-long"

    def test_refuses_what_it_cannot_read_or_align(self, fake_client, tmp_path):
        audio = _tone(tmp_path / "take.wav", 1.0)
        cases = [
            ({"audio_path": str(tmp_path / "missing.wav"), "text": "parole", "language": "it"}, "bad-audio"),
            ({"audio_path": str(tmp_path), "text": "parole", "language": "it"}, "bad-audio"),
            ({"audio_path": str(audio), "text": "   ", "language": "it"}, "empty-text"),
            ({"audio_path": str(audio), "text": "parole", "language": "klingon"}, "unsupported-language"),
            ({"audio_path": "relative.wav", "text": "parole", "language": "it"}, "bad-audio"),
        ]
        for body, code in cases:
            response = fake_client.post("/align", json=body)
            assert response.status_code == 422, (body, response.text)
            assert _code(response) == code, body


class _FakeItem(SimpleNamespace):
    pass


class TestAligner:
    def _model(self, calls: list[str]):
        def generate(audio, text, language):
            calls.append(language)
            return [_FakeItem(text=t, start_time=i * 0.5, end_time=i * 0.5 + 0.4) for i, t in enumerate(text.split())]
        return SimpleNamespace(generate=generate, get_supported_languages=lambda: ["english", "italian"])

    def test_loads_the_model_once_and_keeps_it(self, tmp_path):
        loads: list[str] = []
        calls: list[str] = []
        model = self._model(calls)
        aligner = Aligner("some/aligner", loader=lambda repo: loads.append(repo) or model)
        audio = _tone(tmp_path / "take.wav", 2.0)
        assert not aligner.loaded
        first = aligner.align(str(audio), "uno due", "Italian")
        aligner.align(str(audio), "tre", "en")
        assert loads == ["some/aligner"]
        assert aligner.loaded
        assert calls == ["Italian", "English"]
        assert first["words"] == [{"text": "uno", "start": 0.0, "end": 0.4}, {"text": "due", "start": 0.5, "end": 0.9}]
        assert first["model"] == "some/aligner"

    def test_refuses_a_language_the_model_does_not_list(self, tmp_path):
        aligner = Aligner("some/aligner", loader=lambda repo: self._model([]))
        with pytest.raises(AlignError) as raised:
            aligner.align(str(_tone(tmp_path / "take.wav", 1.0)), "bonjour", "fr")
        assert raised.value.code == "unsupported-language"

    def test_names_languages_from_codes_and_names(self):
        assert language_name("it") == "Italian"
        assert language_name("IT") == "Italian"
        assert language_name("italian") == "Italian"
        assert language_name("Portuguese") == "Portuguese"
        assert language_name("xx") is None


@pytest.mark.skipif(os.environ.get("QTW_ALIGN_LIVE") != "1" or shutil.which("say") is None,
                    reason="set QTW_ALIGN_LIVE=1 on macOS to align with the real model")
def test_live_alignment_of_italian_speech(tmp_path):
    aiff = tmp_path / "take.aiff"
    subprocess.run(["say", "-v", "Alice", "-o", str(aiff), "La nebbia agli irti colli piovigginando sale"], check=True)
    wav = tmp_path / "take.wav"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(aiff), "-ar", "16000", str(wav)], check=True)
    result = Aligner("mlx-community/Qwen3-ForcedAligner-0.6B-8bit").align(str(wav), "La nebbia agli irti colli piovigginando sale", "it")
    assert [w["text"] for w in result["words"]] == ["La", "nebbia", "agli", "irti", "colli", "piovigginando", "sale"]
    ends = [w["end"] for w in result["words"]]
    assert ends == sorted(ends) and ends[-1] > 1.0
