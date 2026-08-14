"""Test fixtures for the qwen-tts-worker test suite.

Provides:
- A FastAPI TestClient backed by the real application factory.
- All tests run without MLX hardware — models are never loaded.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from qwen_tts_worker.app import create_app


@pytest.fixture
def client(tmp_path, monkeypatch) -> TestClient:
    """Return a TestClient for the fully configured application.

    Each test gets a fresh application instance with no shared state.
    """
    monkeypatch.setenv("QTW_MODELS_DIR", str(tmp_path / "models"))
    monkeypatch.setenv("QTW_VOICES_DIR", str(tmp_path / "voices"))
    monkeypatch.setenv("QTW_OUTPUTS_DIR", str(tmp_path / "outputs"))
    monkeypatch.setenv("QTW_ATTEMPT_STORE_DIR", str(tmp_path / "attempt-store"))
    app = create_app()
    return TestClient(app)
