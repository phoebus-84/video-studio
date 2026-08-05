"""Consent, private reference ownership, clone synthesis, and revocation tests."""

from __future__ import annotations

import hashlib
import math
import os
import wave
from pathlib import Path

from fastapi.testclient import TestClient


def reference_wav(path: Path, seconds: float = 4.0) -> None:
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1); output.setsampwidth(2); output.setframerate(24_000)
        frames = bytearray()
        for index in range(round(seconds * 24_000)):
            value = round(math.sin(index * 2 * math.pi * 220 / 24_000) * 4000)
            frames.extend(value.to_bytes(2, "little", signed=True))
        output.writeframes(frames)


def enrollment(path: Path) -> dict:
    return {
        "name": "My consented test voice",
        "reference_audio_path": str(path),
        "reference_text": "This recording is mine and is used to test local speech synthesis.",
        "language": "en-US",
        "consent": {
            "confirmed": True,
            "source": "self_recorded",
            "statement": "I recorded this voice and consent to local cloning for this profile.",
            "license_or_terms": "Owner consent",
        },
    }


def test_enroll_copy_fake_synthesize_and_revoke(
    client: TestClient, tmp_path: Path, monkeypatch
) -> None:
    source = tmp_path / "source.wav"; reference_wav(source)
    created_response = client.post("/voices/enroll", json=enrollment(source))
    assert created_response.status_code == 201, created_response.text
    created = created_response.json(); voice_id = created["id"]
    assert created["mode"] == "clone"
    assert created["reference_duration_seconds"] == 4.0
    stored = Path(os.environ["QTW_VOICES_DIR"]) / created["reference_audio_path"]
    assert stored.is_file() and stored != source
    assert hashlib.sha256(stored.read_bytes()).hexdigest() == created["reference_audio_sha256"]
    assert oct(stored.stat().st_mode & 0o777) == "0o600"
    source.unlink()

    monkeypatch.setenv("QTW_TTS_MODE", "fake")
    synthesized = client.post(
        f"/voices/{voice_id}/synthesize",
        json={"text": "A local fake synthesis fixture.", "seed": 71},
    )
    assert synthesized.status_code == 200, synthesized.text
    result = synthesized.json()
    assert result["provider_mode"] == "fake"
    assert result["model_profile"] == "base"
    assert "must not be published" in result["warning"]
    assert Path(result["wav_path"]).is_file()

    profile_dir = stored.parent
    deleted = client.delete(f"/voices/{voice_id}")
    assert deleted.status_code == 204
    assert not profile_dir.exists()
    assert client.get(f"/voices/{voice_id}").status_code == 404


def test_consent_and_exact_clone_contract_are_mandatory(client: TestClient, tmp_path: Path) -> None:
    source = tmp_path / "source.wav"; reference_wav(source)
    payload = enrollment(source); payload["consent"]["confirmed"] = False
    assert client.post("/voices/enroll", json=payload).status_code == 422
    assert client.post("/voices", json={
        "name": "unsafe shortcut", "mode": "clone", "reference_audio_path": str(source),
    }).status_code == 422
    missing_text = enrollment(source); missing_text["reference_text"] = ""
    assert client.post("/voices/enroll", json=missing_text).status_code == 422


def test_reference_duration_and_integrity_fail_closed(
    client: TestClient, tmp_path: Path, monkeypatch
) -> None:
    short = tmp_path / "short.wav"; reference_wav(short, 1.0)
    response = client.post("/voices/enroll", json=enrollment(short))
    assert response.status_code == 422 and "3-30 seconds" in response.text

    source = tmp_path / "valid.wav"; reference_wav(source)
    profile = client.post("/voices/enroll", json=enrollment(source)).json()
    stored = Path(os.environ["QTW_VOICES_DIR"]) / profile["reference_audio_path"]
    stored.write_bytes(stored.read_bytes() + b"tamper")
    monkeypatch.setenv("QTW_TTS_MODE", "fake")
    synthesis = client.post(f"/voices/{profile['id']}/synthesize", json={"text": "Should fail."})
    assert synthesis.status_code == 409
    assert "integrity mismatch" in synthesis.text
