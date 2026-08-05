"""Profile-aware registry for pinned Qwen3-TTS MLX model installations."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import FrozenSet

from qwen_tts_worker.models.catalog import MODEL_SPECS, ModelSpec, get_model_spec


class ModelSize(str, Enum):
    S_0_6B = "0.6B"
    S_1_7B = "1.7B"


class ModelProfile(str, Enum):
    """Actual Qwen checkpoint type, not an interchangeable runtime mode."""

    CUSTOM_VOICE = "custom_voice"
    VOICE_DESIGN = "voice_design"
    BASE = "base"


_SUPPORTED_COMBINATIONS: FrozenSet[tuple[ModelSize, ModelProfile]] = frozenset(
    (ModelSize(spec.size), ModelProfile(spec.profile)) for spec in MODEL_SPECS
)
_REQUIRED_FILES: tuple[str, ...] = (
    "model.safetensors", "config.json", "generation_config.json", "merges.txt",
    "tokenizer_config.json", "vocab.json", "speech_tokenizer/model.safetensors",
    "speech_tokenizer/config.json",
)


@dataclass(frozen=True)
class ModelEntry:
    size: ModelSize
    profile: ModelProfile

    @property
    def spec(self) -> ModelSpec:
        return get_model_spec(self.size.value, self.profile.value)


class InstallStatus(str, Enum):
    NOT_INSTALLED = "not_installed"
    PARTIAL = "partial"
    COMPLETE = "complete"
    CORRUPT = "corrupt"


@dataclass(frozen=True)
class ModelStatusReport:
    size: ModelSize
    profile: ModelProfile
    status: InstallStatus
    path: Path
    missing_files: tuple[str, ...] = ()
    installed_size_bytes: int | None = None
    detail: str | None = None
    repository: str | None = None
    revision: str | None = None
    verified: bool = False


class ModelRegistry:
    """Inspect immutable profile-specific directories from the shared catalogue."""

    def __init__(self, models_root: Path) -> None:
        self._root = models_root

    @property
    def root(self) -> Path:
        return self._root

    def known_entries(self) -> tuple[ModelEntry, ...]:
        return tuple(
            ModelEntry(ModelSize(spec.size), ModelProfile(spec.profile))
            for spec in MODEL_SPECS
        )

    def scan(self) -> tuple[ModelStatusReport, ...]:
        return tuple(self._scan_entry(entry) for entry in self.known_entries())

    def is_supported(self, size: ModelSize, profile: ModelProfile) -> bool:
        return (size, profile) in _SUPPORTED_COMBINATIONS

    def validate_directory(self, entry: ModelEntry) -> ModelStatusReport:
        return self._scan_entry(entry)

    def _dir_for(self, entry: ModelEntry) -> Path:
        return entry.spec.path_under(self._root)

    def _scan_entry(self, entry: ModelEntry) -> ModelStatusReport:
        spec = entry.spec; directory = self._dir_for(entry)
        common = {"size": entry.size, "profile": entry.profile, "path": directory,
                  "repository": spec.repository, "revision": spec.revision}
        if not directory.exists():
            return ModelStatusReport(**common, status=InstallStatus.NOT_INSTALLED,
                                     detail="Profile-specific directory does not exist.")
        if not directory.is_dir():
            return ModelStatusReport(**common, status=InstallStatus.CORRUPT,
                                     detail="Installation path is not a directory.")
        try:
            missing = tuple(name for name in _REQUIRED_FILES if not (directory / name).is_file())
            size = sum(path.stat().st_size for path in directory.rglob("*") if path.is_file())
        except OSError as exc:
            return ModelStatusReport(**common, status=InstallStatus.CORRUPT,
                                     detail=f"Cannot inspect installation files: {exc}")
        if missing:
            return ModelStatusReport(**common, status=InstallStatus.PARTIAL,
                                     missing_files=missing, installed_size_bytes=size,
                                     detail=f"Missing required files: {', '.join(missing)}")
        try:
            config = json.loads((directory / "config.json").read_text())
        except (OSError, json.JSONDecodeError) as exc:
            return ModelStatusReport(**common, status=InstallStatus.CORRUPT,
                                     installed_size_bytes=size, detail=f"Unreadable config.json: {exc}")
        if config.get("model_type") != "qwen3_tts" or config.get("tts_model_type") != spec.profile:
            return ModelStatusReport(**common, status=InstallStatus.CORRUPT,
                                     installed_size_bytes=size,
                                     detail=f"Checkpoint type {config.get('tts_model_type')!r} does not match {spec.profile!r}.")
        manifest_path = directory / ".download.json"
        verified = False
        if manifest_path.is_file():
            try:
                manifest = json.loads(manifest_path.read_text())
                if manifest.get("repository") != spec.repository or manifest.get("revision") != spec.revision:
                    raise ValueError("download manifest source identity differs from catalogue")
                for expected in spec.verified_files:
                    path = directory / expected.path
                    if path.stat().st_size != expected.size_bytes or _sha256(path) != expected.sha256:
                        raise ValueError(f"verified file mismatch: {expected.path}")
                verified = True
            except (OSError, ValueError, json.JSONDecodeError) as exc:
                return ModelStatusReport(**common, status=InstallStatus.CORRUPT,
                                         installed_size_bytes=size, detail=str(exc))
        return ModelStatusReport(**common, status=InstallStatus.COMPLETE,
                                 installed_size_bytes=size, verified=verified,
                                 detail="Complete and catalogue-verified." if verified else
                                        "Complete legacy installation; run verified installer to pin provenance.")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()
