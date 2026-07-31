"""Public durable-attempt API contract tests in explicit fake mode."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from qwen_tts_worker.app import create_app
from qwen_tts_worker.routes.attempts import _store_at
from test_attempt_store import profile, segment


def client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("QTW_TTS_MODE", "fake")
    monkeypatch.setenv("QTW_ATTEMPT_STORE_DIR", str(tmp_path / "attempt-store"))
    monkeypatch.setenv("QTW_OUTPUTS_DIR", str(tmp_path / "outputs"))
    monkeypatch.setenv("QTW_VOICES_DIR", str(tmp_path / "voices"))
    monkeypatch.setenv("QTW_MODELS_DIR", str(tmp_path / "models"))
    _store_at.cache_clear()
    return TestClient(create_app())


def payload(segment_id: str = "api-segment") -> dict:
    return {
        "segment": segment(segment_id).model_dump(mode="json"),
        "profile": profile().model_dump(mode="json"),
        "use_cache": True,
    }


def test_submit_execute_poll_and_attempt_are_durable_and_fake_labeled(
    tmp_path: Path, monkeypatch
) -> None:
    with client(tmp_path, monkeypatch) as api:
        submitted = api.post("/attempt-jobs", json=payload())
        assert submitted.status_code == 202
        job = submitted.json()
        assert job["phase"] == "queued"
        assert job["provider_mode"] == "fake"

        executed = api.post(f"/attempt-jobs/{job['job_id']}/execute")
        assert executed.status_code == 200
        terminal = executed.json()
        assert terminal["phase"] == "completed"
        assert terminal["provider_mode"] == "fake"

        polled = api.get(f"/attempt-jobs/{job['job_id']}")
        assert polled.json() == terminal
        attempt = api.get(f"/attempt-jobs/{job['job_id']}/attempt")
        assert attempt.status_code == 200
        assert attempt.json()["segment_id"] == "api-segment"
        assert attempt.json()["raw_wav"]["sample_rate"] == 24000

        listed = api.get("/attempt-jobs")
        assert listed.status_code == 200
        assert [item["job_id"] for item in listed.json()] == [job["job_id"]]


def test_api_cache_and_cancel_paths(tmp_path: Path, monkeypatch) -> None:
    with client(tmp_path, monkeypatch) as api:
        first = api.post("/attempt-jobs", json=payload("cached")).json()
        complete = api.post(f"/attempt-jobs/{first['job_id']}/execute").json()
        cached = api.post("/attempt-jobs", json=payload("cached")).json()
        assert cached["phase"] == "completed"
        assert cached["cache_hit"] is True
        assert cached["attempt_id"] == complete["attempt_id"]

        queued = api.post("/attempt-jobs", json=payload("cancelled")).json()
        cancelled = api.post(f"/attempt-jobs/{queued['job_id']}/cancel")
        assert cancelled.status_code == 200
        assert cancelled.json()["phase"] == "cancelled"
        attempt = api.get(f"/attempt-jobs/{queued['job_id']}/attempt").json()
        assert attempt["failure"]["code"] == "cancelled"


def test_unknown_and_nonterminal_attempt_errors_are_machine_visible(
    tmp_path: Path, monkeypatch
) -> None:
    with client(tmp_path, monkeypatch) as api:
        unknown = api.get("/attempt-jobs/00000000-0000-0000-0000-000000000001")
        assert unknown.status_code == 404
        queued = api.post("/attempt-jobs", json=payload()).json()
        no_attempt = api.get(f"/attempt-jobs/{queued['job_id']}/attempt")
        assert no_attempt.status_code == 409
