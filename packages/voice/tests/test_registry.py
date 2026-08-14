"""Profile-aware model catalogue and installation diagnostics tests."""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import pytest

from qwen_tts_worker.models.registry import (
    _REQUIRED_FILES, _SUPPORTED_COMBINATIONS, InstallStatus, ModelEntry,
    ModelProfile, ModelRegistry, ModelSize,
)


def entry(size: ModelSize = ModelSize.S_0_6B, profile: ModelProfile = ModelProfile.BASE) -> ModelEntry:
    return ModelEntry(size=size, profile=profile)


def complete_directory(registry: ModelRegistry, selected: ModelEntry) -> Path:
    directory = registry._dir_for(selected); directory.mkdir(parents=True)
    for name in _REQUIRED_FILES:
        path = directory / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(b"x")
    (directory / "config.json").write_text(json.dumps({
        "model_type": "qwen3_tts", "tts_model_type": selected.profile.value,
    }))
    return directory


def test_catalog_exposes_five_real_combinations() -> None:
    expected = {
        (ModelSize.S_0_6B, ModelProfile.CUSTOM_VOICE),
        (ModelSize.S_0_6B, ModelProfile.BASE),
        (ModelSize.S_1_7B, ModelProfile.CUSTOM_VOICE),
        (ModelSize.S_1_7B, ModelProfile.BASE),
        (ModelSize.S_1_7B, ModelProfile.VOICE_DESIGN),
    }
    assert set(_SUPPORTED_COMBINATIONS) == expected
    registry = ModelRegistry(Path("/tmp/models"))
    assert {(item.size, item.profile) for item in registry.known_entries()} == expected
    assert not registry.is_supported(ModelSize.S_0_6B, ModelProfile.VOICE_DESIGN)


def test_not_installed_partial_complete_and_wrong_profile(tmp_path: Path) -> None:
    registry = ModelRegistry(tmp_path); selected = entry()
    missing = registry.validate_directory(selected)
    assert missing.status == InstallStatus.NOT_INSTALLED
    directory = registry._dir_for(selected); directory.mkdir(parents=True); (directory / "config.json").write_text("{}")
    partial = registry.validate_directory(selected)
    assert partial.status == InstallStatus.PARTIAL and "model.safetensors" in partial.missing_files
    for name in _REQUIRED_FILES:
        path = directory / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(b"x")
    (directory / "config.json").write_text('{"model_type":"qwen3_tts","tts_model_type":"base"}')
    complete = registry.validate_directory(selected)
    assert complete.status == InstallStatus.COMPLETE and complete.verified is False
    assert "legacy" in (complete.detail or "").casefold()
    (directory / "config.json").write_text('{"model_type":"qwen3_tts","tts_model_type":"custom_voice"}')
    corrupt = registry.validate_directory(selected)
    assert corrupt.status == InstallStatus.CORRUPT and "does not match" in (corrupt.detail or "")


def test_manifest_source_or_verified_hash_mismatch_is_corrupt(tmp_path: Path) -> None:
    registry = ModelRegistry(tmp_path); selected = entry(); directory = complete_directory(registry, selected)
    (directory / ".download.json").write_text(json.dumps({
        "repository": "wrong/repository", "revision": selected.spec.revision,
    }))
    report = registry.validate_directory(selected)
    assert report.status == InstallStatus.CORRUPT
    assert "source identity" in (report.detail or "")


def test_non_directory_scan_and_frozen_report(tmp_path: Path) -> None:
    registry = ModelRegistry(tmp_path); selected = entry(); path = registry._dir_for(selected)
    path.parent.mkdir(parents=True, exist_ok=True); path.write_text("not a directory")
    report = registry.validate_directory(selected)
    assert report.status == InstallStatus.CORRUPT
    assert len(registry.scan()) == 5
    with pytest.raises(dataclasses.FrozenInstanceError):
        report.status = InstallStatus.COMPLETE  # type: ignore[misc]
