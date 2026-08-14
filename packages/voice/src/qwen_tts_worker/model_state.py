"""Process-local model readiness shared by lifecycle and health routes."""

from __future__ import annotations

import threading

from qwen_tts_worker.models.health import ModelStatus


_lock = threading.Lock()
_status = ModelStatus.NONE


def set_model_status(status: ModelStatus) -> None:
    global _status
    with _lock:
        _status = status


def get_model_status() -> ModelStatus:
    with _lock:
        return _status
