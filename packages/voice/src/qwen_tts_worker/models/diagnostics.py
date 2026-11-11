"""Dependency diagnostics for required external tools.

Probes ``mlx-audio`` (the MLX TTS runtime) and ``FFmpeg``
without importing them or shelling out during normal operation —
the probes are idempotent and side-effect-free beyond inspecting
the environment.
"""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from enum import Enum


class DepStatus(str, Enum):
    """Status of a single dependency."""

    OK = "ok"
    MISSING = "missing"
    ERROR = "error"


@dataclass(frozen=True)
class DepProbe:
    """Result of probing one external dependency."""

    name: str
    status: DepStatus
    version: str | None = None
    detail: str | None = None


# ---------------------------------------------------------------------------
# Individual probes
# ---------------------------------------------------------------------------


def probe_ffmpeg() -> DepProbe:
    """Check whether FFmpeg is available on PATH and report its version.

    FFmpeg is required for audio transcoding and WAV validation in
    downstream compositing steps.  The probe runs ``ffmpeg -version``
    and parses the first line.
    """
    path = shutil.which("ffmpeg")
    if path is None:
        return DepProbe(
            name="ffmpeg",
            status=DepStatus.MISSING,
            detail="ffmpeg not found on PATH. Install FFmpeg for your OS and add its bin directory to PATH",
        )

    try:
        result = subprocess.run(
            [path, "-version"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            return DepProbe(
                name="ffmpeg",
                status=DepStatus.ERROR,
                detail=f"ffmpeg exited with code {result.returncode}: {result.stderr[:200]}",
            )
        # First line is typically: "ffmpeg version 6.1.1 Copyright ..."
        first_line = result.stdout.splitlines()[0] if result.stdout else ""
        version = first_line.replace("ffmpeg version ", "").split(" Copyright")[0].strip()
        return DepProbe(
            name="ffmpeg",
            status=DepStatus.OK,
            version=version or None,
            detail=f"Found at {path}",
        )
    except subprocess.TimeoutExpired:
        return DepProbe(
            name="ffmpeg",
            status=DepStatus.ERROR,
            detail="ffmpeg --version timed out after 10s",
        )
    except OSError as exc:
        return DepProbe(
            name="ffmpeg",
            status=DepStatus.ERROR,
            detail=f"Cannot execute ffmpeg: {exc}",
        )


def probe_mlx_audio() -> DepProbe:
    """Check whether ``mlx-audio`` is importable and report its version.

    mlx-audio provides the Qwen3-TTS MLX runtime.  The probe attempts
    to import ``mlx_audio`` without loading any model weights.
    """
    try:
        import mlx_audio  # type: ignore[import-untyped]
    except ImportError:
        return DepProbe(
            name="mlx-audio",
            status=DepStatus.MISSING,
            detail="mlx-audio not installed. Install via: pip install mlx-audio",
        )

    version = getattr(mlx_audio, "__version__", None)
    return DepProbe(
        name="mlx-audio",
        status=DepStatus.OK,
        version=version,
        detail="Importable; no model loaded.",
    )


# ---------------------------------------------------------------------------
# Aggregate probe
# ---------------------------------------------------------------------------


def probe_torch() -> DepProbe:
    try:
        from qwen_tts_worker.backends import resolve_runtime
        plan = resolve_runtime()
        if plan.engine_version == "not-installed":
            return DepProbe("qwen-torch", DepStatus.MISSING, detail="Install qwen-tts-worker[torch]")
        return DepProbe("qwen-torch", DepStatus.OK, version=plan.engine_version,
                        detail=f"PyTorch {plan.runtime_version}, {plan.device}, {plan.dtype}, {plan.attention}; no model loaded")
    except Exception as exc:
        return DepProbe("qwen-torch", DepStatus.ERROR, detail=str(exc))


def probe_all() -> tuple[DepProbe, ...]:
    """Run all external dependency probes and return results.

    Each probe is self-contained — a failure in one does not prevent
    the others from running.
    """
    from qwen_tts_worker.backends import backend_name
    engine_probe = probe_mlx_audio if backend_name() == "mlx" else probe_torch
    _PROBE_NAMES = {probe_ffmpeg: "ffmpeg", engine_probe: "inference-runtime"}

    results: list[DepProbe] = []
    for probe_fn in (probe_ffmpeg, engine_probe):
        try:
            results.append(probe_fn())
        except Exception as exc:
            results.append(
                DepProbe(
                    name=_PROBE_NAMES.get(probe_fn, "unknown"),
                    status=DepStatus.ERROR,
                    detail=f"Probe raised {type(exc).__name__}: {exc}",
                )
            )
    return tuple(results)
