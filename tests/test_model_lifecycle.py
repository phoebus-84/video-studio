"""Warm model lifecycle state, safety, recovery, and telemetry tests."""

from __future__ import annotations

import threading
import time
from pathlib import Path

import pytest

from qwen_tts_worker.model_lifecycle import LifecycleState, ModelLifecycleManager


def model_dir(root: Path, name: str = "model") -> Path:
    path = root / name
    path.mkdir()
    (path / "config.json").write_text('{"model_type":"qwen3_tts"}', encoding="utf-8")
    (path / "model.safetensors").write_bytes(b"exact-test-weights")
    return path


def test_repeated_leases_load_the_same_model_once(tmp_path: Path) -> None:
    loaded: list[str] = []
    instance = object()
    manager = ModelLifecycleManager(loader=lambda path: loaded.append(path) or instance)
    path = model_dir(tmp_path)

    with manager.acquire(path) as first:
        assert first.instance is instance
        assert manager.snapshot().active_references == 1
    with manager.acquire(path) as second:
        assert second.instance is instance
        assert first.identity_sha256 == second.identity_sha256

    snapshot = manager.snapshot()
    assert loaded == [str(path.resolve())]
    assert snapshot.state == LifecycleState.READY
    assert snapshot.load_attempt_count == 1
    assert snapshot.load_count == 1


def test_active_lease_cannot_be_unloaded(tmp_path: Path) -> None:
    unloaded: list[object] = []
    instance = object()
    manager = ModelLifecycleManager(
        loader=lambda path: instance,
        unloader=unloaded.append,
    )
    path = model_dir(tmp_path)

    with manager.acquire(path):
        assert manager.unload(wait=False) is False
        assert unloaded == []
        assert manager.snapshot().state == LifecycleState.READY

    assert manager.unload(wait=False) is True
    assert unloaded == [instance]
    assert manager.snapshot().state == LifecycleState.UNLOADED


def test_waiting_unload_finishes_only_after_release(tmp_path: Path) -> None:
    manager = ModelLifecycleManager(loader=lambda path: object())
    path = model_dir(tmp_path)
    finished = threading.Event()

    with manager.acquire(path):
        thread = threading.Thread(
            target=lambda: (manager.unload(wait=True), finished.set()), daemon=True
        )
        thread.start()
        time.sleep(0.02)
        assert not finished.is_set()
    thread.join(timeout=1)

    assert finished.is_set()
    assert manager.snapshot().state == LifecycleState.UNLOADED


def test_failed_load_reports_error_and_recovers(tmp_path: Path) -> None:
    attempts = 0
    instance = object()

    def loader(path: str) -> object:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("allocation failed")
        return instance

    manager = ModelLifecycleManager(loader=loader)
    path = model_dir(tmp_path)

    with pytest.raises(RuntimeError, match="allocation failed"):
        with manager.acquire(path):
            pass
    failed = manager.snapshot()
    assert failed.state == LifecycleState.ERROR
    assert failed.load_count == 0
    assert failed.load_attempt_count == 1
    assert failed.last_error == "RuntimeError: allocation failed"

    with manager.acquire(path) as recovered:
        assert recovered.instance is instance
    snapshot = manager.snapshot()
    assert snapshot.state == LifecycleState.READY
    assert snapshot.load_attempt_count == 2
    assert snapshot.load_count == 1
    assert snapshot.last_error is None


def test_concurrent_acquires_share_one_load(tmp_path: Path) -> None:
    loads = 0
    load_started = threading.Event()
    allow_load = threading.Event()
    manager: ModelLifecycleManager

    def loader(path: str) -> object:
        nonlocal loads
        loads += 1
        load_started.set()
        allow_load.wait(timeout=1)
        return object()

    manager = ModelLifecycleManager(loader=loader)
    path = model_dir(tmp_path)
    identities: list[int] = []

    def use_model() -> None:
        with manager.acquire(path) as loaded:
            identities.append(id(loaded.instance))

    first = threading.Thread(target=use_model)
    second = threading.Thread(target=use_model)
    first.start()
    assert load_started.wait(timeout=1)
    second.start()
    allow_load.set()
    first.join(timeout=1)
    second.join(timeout=1)

    assert loads == 1
    assert len(set(identities)) == 1
    assert manager.snapshot().active_references == 0


def test_idle_policy_and_synthesis_telemetry(tmp_path: Path) -> None:
    manager = ModelLifecycleManager(loader=lambda path: object())
    path = model_dir(tmp_path)
    with manager.acquire(path):
        manager.record_synthesis(1.25)
    before = manager.snapshot()
    assert before.synthesis_count == 1
    assert before.last_synthesis_seconds == 1.25
    assert before.total_synthesis_seconds == 1.25
    assert before.load_latency_seconds is not None

    assert manager.unload_if_idle(0) is True
    assert manager.snapshot().unload_count == 1
