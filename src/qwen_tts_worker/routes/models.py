"""Model registry endpoints.

Provides ``GET /models`` to list all known model size/proﬁle
combinations and their installation readiness, and
``GET /models/{size}/{profile}`` for a single entry.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, status

from qwen_tts_worker.models.registry import (
    InstallStatus,
    ModelEntry,
    ModelProfile,
    ModelRegistry,
    ModelSize,
    ModelStatusReport,
    _SUPPORTED_COMBINATIONS,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Registry resolution
# ---------------------------------------------------------------------------

def _get_registry() -> ModelRegistry:
    """Resolve the models directory from settings and return a registry."""
    from qwen_tts_worker.config import Settings

    try:
        settings = Settings()
        root = settings.models_dir
    except Exception:
        root = Path("models")
    return ModelRegistry(models_root=root)


# ---------------------------------------------------------------------------
# Response shapes (re-exporting from registry where possible)
# ---------------------------------------------------------------------------

@router.get("/models", response_model=list[ModelStatusReport])
async def list_models() -> list[ModelStatusReport]:
    """List every known Qwen3-TTS MLX model and its installation status.

    Returns one entry per supported size/proﬁle combination.
    Combinations that are **not** supported are never listed — the
    registry is the authoritative catalogue.
    """
    registry = _get_registry()
    return list(registry.scan())


@router.get("/models/{size}/{profile}", response_model=ModelStatusReport)
async def get_model(size: str, profile: str) -> ModelStatusReport:
    """Get installation status for a single model size/proﬁle combination.

    Returns 404 if the combination is not in the registry.
    """
    # Parse inputs
    try:
        ms = ModelSize(size)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown model size: '{size}'. Known sizes: {_known_sizes()}",
        )

    try:
        mp = ModelProfile(profile)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown model profile: '{profile}'. Known profiles: {_known_profiles()}",
        )

    registry = _get_registry()
    if not registry.is_supported(ms, mp):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unsupported combination: {size}/{profile}.",
        )

    entry = ModelEntry(size=ms, profile=mp)
    return registry.validate_directory(entry)


# ---------------------------------------------------------------------------
# Diagnostics endpoint — model-level dependency probes
# ---------------------------------------------------------------------------

@router.get("/models/diagnostics")
async def model_diagnostics() -> dict:
    """Run mlx-audio and FFmpeg dependency probes and return results.

    Returns a dict with probe statuses — useful for human operators
    and automated health checks.  Does **not** load any model.
    """
    from qwen_tts_worker.models.diagnostics import probe_all

    probes = probe_all()
    return {
        "dependencies": [
            {
                "name": p.name,
                "status": p.status.value,
                "version": p.version,
                "detail": p.detail,
            }
            for p in probes
        ]
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _known_sizes() -> str:
    return ", ".join(s.value for s in ModelSize)


def _known_profiles() -> str:
    return ", ".join(p.value for p in ModelProfile)
