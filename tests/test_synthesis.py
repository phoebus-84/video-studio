"""Synthesis route tests."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from qwen_tts_worker.app import create_app
from qwen_tts_worker.routes.synthesis import chunk_text, hash_text, generate_silent_wav


@pytest.fixture
def client() -> TestClient:
    app = create_app()
    return TestClient(app)


class TestChunkText:
    def test_short_text_returns_single_chunk(self) -> None:
        text = "Hello world."
        chunks = chunk_text(text, max_chars=500)
        assert chunks == ["Hello world."]

    def test_long_text_is_chunked_at_sentences(self) -> None:
        text = (
            "First sentence. Second sentence. Third sentence. "
            "Fourth sentence. Fifth sentence. Sixth sentence."
        )
        chunks = chunk_text(text, max_chars=30)
        assert len(chunks) > 1
        # Chunks should be non-empty
        for chunk in chunks:
            assert len(chunk.strip()) > 0

    def test_never_splits_mid_word(self) -> None:
        text = "Thisisaverylongwordwithoutspaces followed by short."
        chunks = chunk_text(text, max_chars=20)
        # Should split at space, not mid-word
        for chunk in chunks:
            assert not chunk.endswith(("T", "h"))  # No mid-word split


class TestHashText:
    def test_same_text_produces_same_hash(self) -> None:
        h1 = hash_text("Hello world")
        h2 = hash_text("Hello world")
        assert h1 == h2

    def test_different_text_produces_different_hash(self) -> None:
        h1 = hash_text("Hello")
        h2 = hash_text("World")
        assert h1 != h2

    def test_hash_is_16_chars(self) -> None:
        h = hash_text("test")
        assert len(h) == 16


class TestSilentWav:
    def test_generates_valid_wav(self) -> None:
        data = generate_silent_wav(0.5, sample_rate=24000)
        assert len(data) > 0
        # WAV magic bytes
        assert data[:4] == b"RIFF"
        assert data[8:12] == b"WAVE"


class TestSynthesisAPI:
    def test_synthesize_endpoint_accepts_text(self, client: TestClient) -> None:
        response = client.post(
            "/synthesize",
            json={"text": "Hello world, this is a test."},
        )
        assert response.status_code == 202
        body = response.json()
        assert body["ok"] is True
        assert "result" in body
        assert body["result"]["status"] == "completed"

    def test_synthesize_rejects_empty_text(self, client: TestClient) -> None:
        response = client.post(
            "/synthesize",
            json={"text": ""},
        )
        assert response.status_code == 422

    def test_synthesize_rejects_invalid_speed(self, client: TestClient) -> None:
        response = client.post(
            "/synthesize",
            json={"text": "Hello", "speed": 5.0},
        )
        assert response.status_code == 422

    def test_synthesis_status_endpoint(self, client: TestClient) -> None:
        # First submit a job
        create = client.post(
            "/synthesize",
            json={"text": "Test status endpoint."},
        )
        assert create.status_code == 202
        job_id = create.json()["result"]["job_id"]

        # Check status
        status_resp = client.get(f"/synthesize/{job_id}")
        assert status_resp.status_code == 200
        body = status_resp.json()
        assert body["status"] == "completed"
        assert body["progress"] > 0.9

    def test_unknown_job_returns_404(self, client: TestClient) -> None:
        response = client.get("/synthesize/nonexistent-id")
        assert response.status_code == 404

    def test_synthesis_produces_wav_path(self, client: TestClient) -> None:
        response = client.post(
            "/synthesize",
            json={"text": "A sentence.", "voice": "test-voice"},
        )
        body = response.json()
        assert body["result"]["wav_path"] is not None
        assert ".wav" in body["result"]["wav_path"]
        assert body["result"]["wav_size_bytes"] > 0
