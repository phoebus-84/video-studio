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
def client() -> TestClient:
    """Return a TestClient for the fully configured application.

    Each test gets a fresh application instance with no shared state.
    """
    app = create_app()
    return TestClient(app)
