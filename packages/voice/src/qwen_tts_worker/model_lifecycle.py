"""Thread-safe single-model lifecycle for the local MLX TTS runtime."""

from __future__ import annotations

import gc
import hashlib
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Iterator

from qwen_tts_worker.model_state import set_model_status
from qwen_tts_worker.models.health import ModelStatus


class LifecycleState(str, Enum):
    UNLOADED = "unloaded"
    LOADING = "loading"
    READY = "ready"
    UNLOADING = "unloading"
    ERROR = "error"


@dataclass(frozen=True)
class LoadedModel:
    instance: Any
    path: Path
    identity_sha256: str


@dataclass(frozen=True)
class LifecycleSnapshot:
    state: LifecycleState
    model_path: str | None
    identity_sha256: str | None
    active_references: int
    load_attempt_count: int
    load_count: int
    unload_count: int
    synthesis_count: int
    load_latency_seconds: float | None
    last_synthesis_seconds: float | None
    total_synthesis_seconds: float
    active_memory_bytes: int | None
    peak_memory_bytes: int | None
    loaded_at_monotonic: float | None
    last_used_monotonic: float | None
    last_error: str | None


Loader = Callable[[str], Any]
Unloader = Callable[[Any], None]
StatusSetter = Callable[[ModelStatus], None]


def _default_loader(path: str) -> Any:
    from mlx_audio.tts.utils import load_model

    return load_model(model_path=path)


def _default_unloader(model: Any) -> None:
    del model
    gc.collect()
    try:
        import mlx.core as mx

        mx.clear_cache()
    except ImportError:
        pass


def _memory() -> tuple[int | None, int | None]:
    try:
        import mlx.core as mx

        return int(mx.get_active_memory()), int(mx.get_peak_memory())
    except (ImportError, AttributeError, RuntimeError):
        return None, None


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


class ModelLifecycleManager:
    """Serialize model transitions and lease active model references safely."""

    def __init__(
        self,
        *,
        loader: Loader = _default_loader,
        unloader: Unloader = _default_unloader,
        status_setter: StatusSetter = lambda status: None,
    ) -> None:
        self._loader = loader
        self._unloader = unloader
        self._status_setter = status_setter
        self._condition = threading.Condition(threading.RLock())
        self._state = LifecycleState.UNLOADED
        self._model: Any = None
        self._path: Path | None = None
        self._identity: str | None = None
        self._identity_cache: dict[tuple[str, int, int, int, int], str] = {}
        self._active = 0
        self._load_attempts = 0
        self._loads = 0
        self._unloads = 0
        self._syntheses = 0
        self._load_latency: float | None = None
        self._last_synthesis: float | None = None
        self._total_synthesis = 0.0
        self._loaded_at: float | None = None
        self._last_used: float | None = None
        self._last_error: str | None = None

    def _model_identity(self, path: Path) -> str:
        config = path / "config.json"
        weights = path / "model.safetensors"
        config_stat = config.stat()
        weights_stat = weights.stat()
        key = (
            str(path),
            config_stat.st_size,
            config_stat.st_mtime_ns,
            weights_stat.st_size,
            weights_stat.st_mtime_ns,
        )
        cached = self._identity_cache.get(key)
        if cached:
            return cached
        digest = hashlib.sha256()
        digest.update(b"qwen-model-identity-v1\0")
        digest.update(_hash_file(config).encode())
        digest.update(b"\0")
        digest.update(_hash_file(weights).encode())
        identity = digest.hexdigest()
        self._identity_cache = {key: identity}
        return identity

    @contextmanager
    def acquire(self, model_path: str | Path) -> Iterator[LoadedModel]:
        """Load once and lease a reference that blocks unload until release."""

        path = Path(model_path).expanduser().resolve()
        identity = self._model_identity(path)
        while True:
            old_model: Any = None
            with self._condition:
                if self._state in {LifecycleState.LOADING, LifecycleState.UNLOADING}:
                    self._condition.wait()
                    continue
                if (
                    self._state == LifecycleState.READY
                    and self._path == path
                    and self._identity == identity
                ):
                    self._active += 1
                    lease = LoadedModel(self._model, path, identity)
                    break
                if self._state == LifecycleState.READY:
                    if self._active:
                        self._condition.wait()
                        continue
                    old_model = self._model
                    self._model = None
                    self._state = LifecycleState.UNLOADING
                else:
                    self._state = LifecycleState.LOADING
                    self._load_attempts += 1
                    self._last_error = None
                    self._status_setter(ModelStatus.LOADING)
                    should_load = True
                    break
            if old_model is not None:
                try:
                    self._unloader(old_model)
                finally:
                    with self._condition:
                        self._unloads += 1
                        self._path = None
                        self._identity = None
                        self._loaded_at = None
                        self._state = LifecycleState.UNLOADED
                        self._status_setter(ModelStatus.NONE)
                        self._condition.notify_all()

        if "should_load" in locals():
            started = time.monotonic()
            try:
                instance = self._loader(str(path))
            except Exception as exc:
                with self._condition:
                    self._load_latency = time.monotonic() - started
                    self._state = LifecycleState.ERROR
                    self._last_error = f"{type(exc).__name__}: {exc}"
                    self._status_setter(ModelStatus.ERROR)
                    self._condition.notify_all()
                raise
            with self._condition:
                now = time.monotonic()
                self._model = instance
                self._path = path
                self._identity = identity
                self._loads += 1
                self._load_latency = now - started
                self._loaded_at = now
                self._last_used = now
                self._state = LifecycleState.READY
                self._active += 1
                self._last_error = None
                self._status_setter(ModelStatus.READY)
                self._condition.notify_all()
                lease = LoadedModel(instance, path, identity)

        try:
            yield lease
        finally:
            with self._condition:
                self._active -= 1
                self._last_used = time.monotonic()
                self._condition.notify_all()

    def record_synthesis(self, elapsed_seconds: float) -> None:
        with self._condition:
            self._syntheses += 1
            self._last_synthesis = elapsed_seconds
            self._total_synthesis += elapsed_seconds
            self._last_used = time.monotonic()

    def unload(self, *, wait: bool = False) -> bool:
        """Unload if idle; optionally wait for active leases to finish."""

        with self._condition:
            while self._active:
                if not wait:
                    return False
                self._condition.wait()
            while self._state in {LifecycleState.LOADING, LifecycleState.UNLOADING}:
                if not wait:
                    return False
                self._condition.wait()
            if self._state not in {LifecycleState.READY, LifecycleState.ERROR}:
                return True
            model = self._model
            self._model = None
            self._state = LifecycleState.UNLOADING
        try:
            if model is not None:
                self._unloader(model)
        finally:
            with self._condition:
                if model is not None:
                    self._unloads += 1
                self._path = None
                self._identity = None
                self._loaded_at = None
                self._state = LifecycleState.UNLOADED
                self._last_error = None
                self._status_setter(ModelStatus.NONE)
                self._condition.notify_all()
        return True

    def unload_if_idle(self, idle_seconds: float) -> bool:
        if idle_seconds < 0:
            raise ValueError("idle_seconds cannot be negative")
        with self._condition:
            if self._active or self._state != LifecycleState.READY:
                return False
            if self._last_used is None or time.monotonic() - self._last_used < idle_seconds:
                return False
        return self.unload(wait=False)

    def snapshot(self) -> LifecycleSnapshot:
        active_memory, peak_memory = _memory()
        with self._condition:
            return LifecycleSnapshot(
                state=self._state,
                model_path=str(self._path) if self._path else None,
                identity_sha256=self._identity,
                active_references=self._active,
                load_attempt_count=self._load_attempts,
                load_count=self._loads,
                unload_count=self._unloads,
                synthesis_count=self._syntheses,
                load_latency_seconds=self._load_latency,
                last_synthesis_seconds=self._last_synthesis,
                total_synthesis_seconds=self._total_synthesis,
                active_memory_bytes=active_memory,
                peak_memory_bytes=peak_memory,
                loaded_at_monotonic=self._loaded_at,
                last_used_monotonic=self._last_used,
                last_error=self._last_error,
            )


model_lifecycle = ModelLifecycleManager(status_setter=set_model_status)
