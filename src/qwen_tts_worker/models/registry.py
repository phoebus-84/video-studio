"""Model registry — defines known Qwen3-TTS MLX models and validates installations.

Every model/proﬁle combination the worker can serve is declared here.
The registry never claims an unsupported combination exists. It validates
model directories by checking for expected safetensors files and metadata.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import FrozenSet


# ---------------------------------------------------------------------------
# Model sizes known to Qwen3-TTS MLX
# ---------------------------------------------------------------------------

class ModelSize(str, Enum):
    """Known Qwen3-TTS model parameter counts."""

    S_0_6B = "0.6B"
    S_1_7B = "1.7B"


# ---------------------------------------------------------------------------
# Synthesis profiles each model can serve
# ---------------------------------------------------------------------------

class ModelProfile(str, Enum):
    """Synthesis profiles that a model can operate in.

    Each profile unlocks a different VoiceProfile SynthesisMode:
    - custom_voice → clone (speaker adaptation from reference audio)
    - voice_design → design (text-to-speech from textual description)
    - base → preset (base TTS without voice customization)
    """

    CUSTOM_VOICE = "custom_voice"
    VOICE_DESIGN = "voice_design"
    BASE = "base"


# ---------------------------------------------------------------------------
# Canonical set of supported model-size × profile combinations
# ---------------------------------------------------------------------------

_SUPPORTED_COMBINATIONS: FrozenSet[tuple[ModelSize, ModelProfile]] = frozenset({
    (ModelSize.S_0_6B, ModelProfile.CUSTOM_VOICE),
    (ModelSize.S_0_6B, ModelProfile.VOICE_DESIGN),
    (ModelSize.S_0_6B, ModelProfile.BASE),
    (ModelSize.S_1_7B, ModelProfile.CUSTOM_VOICE),
    (ModelSize.S_1_7B, ModelProfile.VOICE_DESIGN),
    (ModelSize.S_1_7B, ModelProfile.BASE),
})


# ---------------------------------------------------------------------------
# Required files per model directory
# ---------------------------------------------------------------------------

# Every model directory must contain these files for the registry to
# consider it complete.  The list is intentionally narrow — it checks
# for the minimal set of safetensors files known to be emitted by the
# official conversion scripts.
_REQUIRED_FILES: tuple[str, ...] = (
    "model.safetensors",
    "config.json",
)


# ---------------------------------------------------------------------------
# Model entry
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ModelEntry:
    """A single model size/profile combination in the registry.

    Instances are immutable — the registry is a declarative catalogue.
    """

    size: ModelSize
    profile: ModelProfile


# ---------------------------------------------------------------------------
# Installation readiness
# ---------------------------------------------------------------------------

class InstallStatus(str, Enum):
    """Readiness of a model directory."""

    NOT_INSTALLED = "not_installed"
    """No model directory exists for this size/profile."""
    PARTIAL = "partial"
    """Directory exists but is missing expected safetensors files."""
    COMPLETE = "complete"
    """Directory exists with all required safetensors files present."""
    CORRUPT = "corrupt"
    """Directory exists but a required file is unreadable or a hash mismatch is detected."""


@dataclass(frozen=True)
class ModelStatusReport:
    """Full readiness report for one model entry."""

    size: ModelSize
    profile: ModelProfile
    status: InstallStatus
    path: Path
    missing_files: tuple[str, ...] = ()
    installed_size_bytes: int | None = None
    detail: str | None = None


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

class ModelRegistry:
    """Catalogue of known Qwen3-TTS MLX models and their installation state.

    The registry is a pure-function validator: it inspects a models
    directory and reports which of the *supported* size/proﬁle
    combinations are present, partial, or missing.  It never invents
    combinations and never downloads anything — downloads are handled
    by the separate ``download`` CLI command.

    Usage::

        registry = ModelRegistry(models_root=Path("models"))
        reports = registry.scan()
        for r in reports:
            print(r.size, r.profile, r.status)
    """

    def __init__(self, models_root: Path) -> None:
        """Create a registry rooted at *models_root*.

        Args:
            models_root: Directory under which model sub-directories
                are expected.  Created if it does not exist.
        """
        self._root = models_root

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def root(self) -> Path:
        """The models root directory this registry scans."""
        return self._root

    def known_entries(self) -> tuple[ModelEntry, ...]:
        """Return every supported size/proﬁle combination."""
        return tuple(
            ModelEntry(size=s, profile=p)
            for s, p in _SUPPORTED_COMBINATIONS
        )

    def scan(self) -> tuple[ModelStatusReport, ...]:
        """Scan the models directory and return a report for every supported entry."""
        return tuple(self._scan_entry(e) for e in self.known_entries())

    def is_supported(self, size: ModelSize, profile: ModelProfile) -> bool:
        """Return ``True`` iﬀ the size/proﬁle combination is known."""
        return (size, profile) in _SUPPORTED_COMBINATIONS

    def validate_directory(self, entry: ModelEntry) -> ModelStatusReport:
        """Validate a single model directory without scanning every entry.

        Args:
            entry: The model size/proﬁle to validate.

        Returns:
            A ``ModelStatusReport`` with the current installation status.
        """
        return self._scan_entry(entry)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _dir_for(self, entry: ModelEntry) -> Path:
        """Return the expected directory path for *entry*."""
        return self._root / f"qwen3-tts-{entry.size.value}" / entry.profile.value

    def _scan_entry(self, entry: ModelEntry) -> ModelStatusReport:
        d = self._dir_for(entry)
        if not d.exists():
            return ModelStatusReport(
                size=entry.size,
                profile=entry.profile,
                status=InstallStatus.NOT_INSTALLED,
                path=d,
                detail="Directory does not exist.",
            )

        if not d.is_dir():
            return ModelStatusReport(
                size=entry.size,
                profile=entry.profile,
                status=InstallStatus.CORRUPT,
                path=d,
                detail="Path exists but is not a directory.",
            )

        missing: list[str] = []
        corrupt: list[str] = []
        total_size: int = 0
        for fname in _REQUIRED_FILES:
            fp = d / fname
            if not fp.exists():
                missing.append(fname)
                continue
            try:
                total_size += fp.stat().st_size
            except OSError:
                corrupt.append(fname)

        if corrupt:
            return ModelStatusReport(
                size=entry.size,
                profile=entry.profile,
                status=InstallStatus.CORRUPT,
                path=d,
                missing_files=tuple(corrupt),
                detail=_corrupt_detail(corrupt),
            )

        if missing:
            return ModelStatusReport(
                size=entry.size,
                profile=entry.profile,
                status=InstallStatus.PARTIAL,
                path=d,
                missing_files=tuple(missing),
                installed_size_bytes=total_size if total_size > 0 else None,
                detail=f"Missing required files: {', '.join(missing)}",
            )

        return ModelStatusReport(
            size=entry.size,
            profile=entry.profile,
            status=InstallStatus.COMPLETE,
            path=d,
            installed_size_bytes=total_size,
            detail="All required files present.",
        )


def _corrupt_detail(files: list[str]) -> str:
    return f"Required files exist but cannot be read: {', '.join(files)}"
