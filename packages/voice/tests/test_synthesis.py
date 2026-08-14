"""Synthesis routing, validation, and compatibility API tests."""

from __future__ import annotations

import json
import logging
import math
import wave
from array import array
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from qwen_tts_worker.app import create_app
from qwen_tts_worker.routes import synthesis as synthesis_route
from qwen_tts_worker.routes.synthesis import (
    CustomVoiceModel,
    SynthesizeRequest,
    _generate_silent_wav,
    chunk_text,
    hash_text,
    inspect_customvoice_model,
    resolve_speaker,
    synthesize_with_qwen,
    validate_live_wav,
)


def write_tone(path: Path, *, seconds: float = 0.25, amplitude: int = 5000) -> None:
    sample_rate = 24_000
    samples = array(
        "h",
        (
            round(amplitude * math.sin(2 * math.pi * 440 * index / sample_rate))
            for index in range(round(sample_rate * seconds))
        ),
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(samples.tobytes())


def make_model_dir(path: Path, *, profile: str = "custom_voice") -> Path:
    path.mkdir(parents=True)
    (path / "model.safetensors").write_bytes(b"test-weights")
    (path / "config.json").write_text(
        json.dumps(
            {
                "model_type": "qwen3_tts",
                "tts_model_type": profile,
                "talker_config": {
                    "spk_id": {"serena": 1, "vivian": 2},
                    "codec_language_id": {"english": 3, "french": 4},
                },
            }
        ),
        encoding="utf-8",
    )
    return path


@pytest.fixture
def fake_client(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> TestClient:
    monkeypatch.setenv("QTW_TTS_MODE", "fake")
    monkeypatch.setenv("TTS_VOICES_DIR", str(tmp_path / "voices"))
    return TestClient(create_app())


class TestChunkText:
    def test_short_text_returns_single_chunk(self) -> None:
        assert chunk_text("Hello world.", max_chars=500) == ["Hello world."]

    def test_long_text_is_chunked_at_sentences(self) -> None:
        text = (
            "First sentence. Second sentence. Third sentence. "
            "Fourth sentence. Fifth sentence. Sixth sentence."
        )
        chunks = chunk_text(text, max_chars=30)
        assert len(chunks) > 1
        assert all(chunk.strip() for chunk in chunks)

    def test_never_splits_at_a_word_boundary_when_one_is_available(self) -> None:
        text = "Thisisaverylongwordwithoutspaces followed by short."
        chunks = chunk_text(text, max_chars=40)
        assert chunks[0] == "Thisisaverylongwordwithoutspaces"


class TestHashText:
    def test_hash_is_stable_distinct_and_short(self) -> None:
        assert hash_text("Hello") == hash_text("Hello")
        assert hash_text("Hello") != hash_text("World")
        assert len(hash_text("test")) == 16


class TestRequestValidation:
    @pytest.mark.parametrize("speed", [0.5, 0.9, 1.1, 2.0, 5.0])
    def test_rejects_unsupported_speed(self, fake_client: TestClient, speed: float) -> None:
        response = fake_client.post("/synthesize", json={"text": "Hello", "speed": speed})
        assert response.status_code == 422
        assert "speed must be 1.0" in response.text

    def test_rejects_empty_text(self, fake_client: TestClient) -> None:
        assert fake_client.post("/synthesize", json={"text": ""}).status_code == 422

    def test_rejects_unknown_language_before_generation(self, fake_client: TestClient) -> None:
        response = fake_client.post(
            "/synthesize", json={"text": "Hello", "language": "en-US"}
        )
        assert response.status_code == 422

    @pytest.mark.parametrize(
        ("field", "value", "message"),
        [
            ("voice_description", "A warm voice", "VoiceDesign"),
            ("ref_audio", "/tmp/reference.wav", "voice-cloning"),
        ],
    )
    def test_rejects_controls_for_other_model_profiles(
        self,
        fake_client: TestClient,
        field: str,
        value: str,
        message: str,
    ) -> None:
        response = fake_client.post("/synthesize", json={"text": "Hello", field: value})
        assert response.status_code == 422
        assert message in response.text


class TestModelInspection:
    def test_discovers_speakers_and_languages_from_config(self, tmp_path: Path) -> None:
        model = inspect_customvoice_model(make_model_dir(tmp_path / "model"))
        assert model.speakers == {"serena", "vivian"}
        assert model.languages == {"auto", "english", "french"}
        assert resolve_speaker("narrator", model) == "serena"
        assert resolve_speaker("VIVIAN", model) == "vivian"

    def test_rejects_wrong_model_profile(self, tmp_path: Path) -> None:
        path = make_model_dir(tmp_path / "model", profile="voice_design")
        with pytest.raises(RuntimeError, match="custom_voice"):
            inspect_customvoice_model(path)

    def test_rejects_missing_model_before_importing_mlx(self, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError, match="model directory not found"):
            inspect_customvoice_model(tmp_path / "missing")

    def test_rejects_unknown_speaker(self, tmp_path: Path) -> None:
        model = inspect_customvoice_model(make_model_dir(tmp_path / "model"))
        with pytest.raises(ValueError, match="Unknown CustomVoice speaker"):
            resolve_speaker("invented", model)


class TestLiveOutputValidation:
    def test_accepts_canonical_non_silent_pcm(self, tmp_path: Path) -> None:
        path = tmp_path / "tone.wav"
        write_tone(path)
        info = validate_live_wav(path.read_bytes())
        assert info.sample_rate == 24_000
        assert info.channels == 1
        assert info.rms_dbfs > -50

    def test_rejects_silent_wav(self) -> None:
        with pytest.raises(RuntimeError, match="silent or near-silent"):
            validate_live_wav(_generate_silent_wav(0.5))

    def test_rejects_invalid_bytes(self) -> None:
        with pytest.raises(RuntimeError, match="too small"):
            validate_live_wav(b"not a wav")


class TestMlxArgumentMapping:
    def test_maps_every_generation_argument_exactly(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        captured: dict[str, Any] = {}
        seeded: list[int] = []

        def fake_generate_audio(**kwargs: Any) -> None:
            captured.update(kwargs)
            write_tone(Path(kwargs["output_path"]) / "audio_000.wav")

        monkeypatch.setattr(synthesis_route, "_load_generate_audio", lambda: fake_generate_audio)
        monkeypatch.setattr(synthesis_route, "_seed_mlx", seeded.append)
        request = SynthesizeRequest(
            text="Exact spoken text.",
            voice="serena",
            instruct="Speak warmly.",
            language="english",
            temperature=0.8,
            top_k=37,
            top_p=0.92,
            repetition_penalty=1.1,
            max_tokens=777,
            seed=1234,
        )
        model = CustomVoiceModel(
            path=tmp_path / "model",
            speakers=frozenset({"serena"}),
            languages=frozenset({"auto", "english"}),
        )

        backend_model = object()
        data, info = synthesize_with_qwen(
            request, model, "serena", backend_model
        )

        assert data[:4] == b"RIFF"
        assert info.rms_dbfs > -50
        assert seeded == [1234]
        assert captured == {
            "text": "Exact spoken text.",
            "model": backend_model,
            "voice": "serena",
            "instruct": "Speak warmly.",
            "speed": 1.0,
            "lang_code": "english",
            "temperature": 0.8,
            "top_k": 37,
            "top_p": 0.92,
            "repetition_penalty": 1.1,
            "max_tokens": 777,
            "split_pattern": None,
            "output_path": captured["output_path"],
            "file_prefix": "audio",
            "audio_format": "wav",
            "join_audio": False,
            "play": False,
            "verbose": False,
            "stream": False,
        }

    def test_generation_exception_is_not_replaced_with_silence(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        monkeypatch.setattr(synthesis_route, "_seed_mlx", lambda seed: None)

        def fail(**kwargs: Any) -> None:
            raise RuntimeError("backend exploded")

        monkeypatch.setattr(synthesis_route, "_load_generate_audio", lambda: fail)
        request = SynthesizeRequest(text="Hello", voice="serena")
        model = CustomVoiceModel(
            path=tmp_path / "model",
            speakers=frozenset({"serena"}),
            languages=frozenset({"auto", "english"}),
        )
        with pytest.raises(RuntimeError, match="backend exploded"):
            synthesize_with_qwen(request, model, "serena", object())


class TestSynthesisAPI:
    def test_fake_mode_logs_prominent_startup_warning(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        monkeypatch.setenv("QTW_TTS_MODE", "fake")
        with caplog.at_level(logging.WARNING, logger="qwen-tts-worker"):
            with TestClient(create_app()):
                pass
        assert "FAKE TTS MODE ENABLED" in caplog.text
        assert "must not be published" in caplog.text

    def test_explicit_fake_mode_is_labeled(self, fake_client: TestClient) -> None:
        response = fake_client.post("/synthesize", json={"text": "Hello world."})
        assert response.status_code == 202
        body = response.json()
        assert body["ok"] is True
        assert body["result"]["status"] == "completed"
        assert body["result"]["provider_mode"] == "fake"
        assert body["result"]["model_path"] is None
        assert body["result"]["wav_path"].endswith(".wav")

    def test_live_model_failure_returns_failed_attempt_without_wav(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        monkeypatch.setenv("QTW_TTS_MODE", "live")
        monkeypatch.setenv("QTW_MODEL_PATH", str(tmp_path / "missing"))
        monkeypatch.setenv("TTS_VOICES_DIR", str(tmp_path / "voices"))
        client = TestClient(create_app())

        response = client.post("/synthesize", json={"text": "Hello world."})

        assert response.status_code == 202
        result = response.json()["result"]
        assert response.json()["ok"] is False
        assert result["status"] == "failed"
        assert result["provider_mode"] == "live"
        assert result["wav_path"] is None
        assert "FileNotFoundError" in result["error"]
        assert not list((tmp_path / "voices").rglob("*.wav"))

    def test_unknown_speaker_fails_before_generation(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        model_path = make_model_dir(tmp_path / "model")
        monkeypatch.setenv("QTW_TTS_MODE", "live")
        monkeypatch.setenv("QTW_MODEL_PATH", str(model_path))
        monkeypatch.setenv("TTS_VOICES_DIR", str(tmp_path / "voices"))
        called = False

        def must_not_generate(*args: Any, **kwargs: Any) -> Any:
            nonlocal called
            called = True
            raise AssertionError("generation must not run")

        monkeypatch.setattr(synthesis_route, "synthesize_with_qwen", must_not_generate)
        client = TestClient(create_app())

        response = client.post(
            "/synthesize", json={"text": "Hello", "voice": "not-a-speaker"}
        )

        assert response.status_code == 202
        assert response.json()["result"]["status"] == "failed"
        assert "Unknown CustomVoice speaker" in response.json()["result"]["error"]
        assert called is False

    def test_silent_live_output_is_a_failed_attempt(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        model_path = make_model_dir(tmp_path / "model")
        monkeypatch.setenv("QTW_TTS_MODE", "live")
        monkeypatch.setenv("QTW_MODEL_PATH", str(model_path))
        monkeypatch.setenv("TTS_VOICES_DIR", str(tmp_path / "voices"))

        def silent(*args: Any, **kwargs: Any) -> Any:
            data = _generate_silent_wav(0.5)
            return data, validate_live_wav(data)

        @contextmanager
        def acquire_without_loading(path: Path):
            yield SimpleNamespace(instance=object(), identity_sha256="a" * 64)

        monkeypatch.setattr(synthesis_route.model_lifecycle, "acquire", acquire_without_loading)
        monkeypatch.setattr(synthesis_route, "synthesize_with_qwen", silent)
        response = TestClient(create_app()).post(
            "/synthesize", json={"text": "Hello", "voice": "serena"}
        )
        assert response.json()["ok"] is False
        assert response.json()["result"]["status"] == "failed"
        assert "silent or near-silent" in response.json()["result"]["error"]
        assert not list((tmp_path / "voices").rglob("*.wav"))

    def test_failed_job_remains_observable(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        monkeypatch.setenv("QTW_TTS_MODE", "live")
        monkeypatch.setenv("QTW_MODEL_PATH", str(tmp_path / "missing"))
        client = TestClient(create_app())
        created = client.post("/synthesize", json={"text": "Failure status."}).json()
        job_id = created["result"]["job_id"]

        status_response = client.get(f"/synthesize/{job_id}")

        assert status_response.status_code == 200
        assert status_response.json()["status"] == "failed"
        assert status_response.json()["progress"] == 1.0
        assert status_response.json()["result"]["error"]

    def test_completed_job_status(self, fake_client: TestClient) -> None:
        created = fake_client.post(
            "/synthesize", json={"text": "Test status endpoint."}
        ).json()
        status_response = fake_client.get(
            f"/synthesize/{created['result']['job_id']}"
        )
        assert status_response.status_code == 200
        assert status_response.json()["status"] == "completed"
        assert status_response.json()["progress"] == 1.0

    def test_unknown_job_returns_404(self, fake_client: TestClient) -> None:
        assert fake_client.get("/synthesize/nonexistent-id").status_code == 404
