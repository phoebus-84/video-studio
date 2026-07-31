"""Public manifest-driven mastering endpoint tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from qwen_tts_worker.routes.attempts import attempt_store
from test_attempt_endpoints import client
from test_narration_mastering import plan


def test_master_and_fetch_narration(tmp_path: Path, monkeypatch) -> None:
    with client(tmp_path, monkeypatch) as api:
        store = attempt_store()
        selected = plan(store.root)
        response = api.post(
            "/narrations/master",
            json={"plan": selected.model_dump(mode="json")},
        )
        assert response.status_code == 200, response.text
        report = response.json()
        assert report["ordered_segment_ids"] == [
            "segment-1", "segment-2", "segment-3"
        ]
        assert report["measured"]["integrated_lufs"] == pytest.approx(-16.0, abs=0.6)
        assert report["measured"]["true_peak_dbtp"] <= -1.3
        assert (store.root / report["final_wav"]["path"]).is_file()

        fetched = api.get(f"/narrations/{report['assembly_id']}")
        assert fetched.status_code == 200
        assert fetched.json() == report

        duplicate = api.post(
            "/narrations/master",
            json={"plan": selected.model_dump(mode="json")},
        )
        assert duplicate.status_code == 409
        assert "already exists" in duplicate.json()["error"]


def test_unknown_mastered_narration_is_404(tmp_path: Path, monkeypatch) -> None:
    with client(tmp_path, monkeypatch) as api:
        response = api.get("/narrations/assembly-does-not-exist")
        assert response.status_code == 404
