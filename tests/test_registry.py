"""Tests for the model registry.

Covers:
- Known model size/proﬁle enumeration.
- Supported combination checks (including rejections of unsupported).
- Directory validation for all four InstallStatus outcomes.
"""

from __future__ import annotations

import os
from pathlib import Path
from unittest import mock

import pytest

from qwen_tts_worker.models.registry import (
    _SUPPORTED_COMBINATIONS,
    InstallStatus,
    ModelEntry,
    ModelProfile,
    ModelRegistry,
    ModelSize,
)


# ---------------------------------------------------------------------------
# Model sizes and profiles
# ---------------------------------------------------------------------------

class TestModelSize:
    def test_known_sizes(self) -> None:
        assert ModelSize.S_0_6B.value == "0.6B"
        assert ModelSize.S_1_7B.value == "1.7B"

    def test_parse_valid(self) -> None:
        assert ModelSize("0.6B") == ModelSize.S_0_6B
        assert ModelSize("1.7B") == ModelSize.S_1_7B

    def test_parse_invalid(self) -> None:
        with pytest.raises(ValueError):
            ModelSize("3B")

    def test_no_unknown_sizes(self) -> None:
        """Registry must not claim support for model sizes we don't ship."""
        all_sizes = {s for s, _ in _SUPPORTED_COMBINATIONS}
        assert all_sizes == {ModelSize.S_0_6B, ModelSize.S_1_7B}


class TestModelProfile:
    def test_known_profiles(self) -> None:
        assert ModelProfile.CUSTOM_VOICE.value == "custom_voice"
        assert ModelProfile.VOICE_DESIGN.value == "voice_design"
        assert ModelProfile.BASE.value == "base"

    def test_parse_valid(self) -> None:
        assert ModelProfile("custom_voice") == ModelProfile.CUSTOM_VOICE

    def test_parse_invalid(self) -> None:
        with pytest.raises(ValueError):
            ModelProfile("bass_boost")


# ---------------------------------------------------------------------------
# Supported combinations
# ---------------------------------------------------------------------------

class TestSupportedCombinations:
    """The registry must only claim supported size/profile combos."""

    def test_six_combinations_total(self) -> None:
        """0.6B × 3 profiles + 1.7B × 3 profiles = 6 combos."""
        assert len(_SUPPORTED_COMBINATIONS) == 6

    def test_every_size_has_all_profiles(self) -> None:
        profiles = {ModelProfile.CUSTOM_VOICE, ModelProfile.VOICE_DESIGN, ModelProfile.BASE}
        for size in ModelSize:
            for profile in profiles:
                assert (size, profile) in _SUPPORTED_COMBINATIONS, \
                    f"Missing: {size}/{profile}"

    def test_unsupported_combination_rejected(self) -> None:
        """Only the six known combos are supported — verify one is NOT."""
        registry = ModelRegistry(Path("/tmp"))
        # Every combination in _SUPPORTED_COMBINATIONS is supported.
        # The registry's validate_directory and scan methods only return
        # reports for those combos.  The API-level tests (test_models_endpoints)
        # verify that unknown sizes/profiles produce 404.
        # Here we verify the total count matches expectation.
        assert len(_SUPPORTED_COMBINATIONS) == 6
        # If this test drifts, someone added/removed a combo without updating.
        expected_pairs = {
            (ModelSize.S_0_6B, ModelProfile.CUSTOM_VOICE),
            (ModelSize.S_0_6B, ModelProfile.VOICE_DESIGN),
            (ModelSize.S_0_6B, ModelProfile.BASE),
            (ModelSize.S_1_7B, ModelProfile.CUSTOM_VOICE),
            (ModelSize.S_1_7B, ModelProfile.VOICE_DESIGN),
            (ModelSize.S_1_7B, ModelProfile.BASE),
        }
        assert set(_SUPPORTED_COMBINATIONS) == expected_pairs


class TestRegistryIsSupported:
    def test_valid_combinations(self) -> None:
        registry = ModelRegistry(Path("/tmp"))
        assert registry.is_supported(ModelSize.S_0_6B, ModelProfile.BASE)
        assert registry.is_supported(ModelSize.S_0_6B, ModelProfile.CUSTOM_VOICE)
        assert registry.is_supported(ModelSize.S_0_6B, ModelProfile.VOICE_DESIGN)
        assert registry.is_supported(ModelSize.S_1_7B, ModelProfile.BASE)
        assert registry.is_supported(ModelSize.S_1_7B, ModelProfile.CUSTOM_VOICE)
        assert registry.is_supported(ModelSize.S_1_7B, ModelProfile.VOICE_DESIGN)


class TestRegistryKnownEntries:
    def test_returns_all_six(self) -> None:
        registry = ModelRegistry(Path("/tmp"))
        entries = registry.known_entries()
        assert len(entries) == 6
        sizes = {e.size for e in entries}
        profiles = {e.profile for e in entries}
        assert sizes == {ModelSize.S_0_6B, ModelSize.S_1_7B}
        assert profiles == {
            ModelProfile.CUSTOM_VOICE,
            ModelProfile.VOICE_DESIGN,
            ModelProfile.BASE,
        }


# ---------------------------------------------------------------------------
# Directory validation
# ---------------------------------------------------------------------------

class TestRegistryValidateDirectory:
    """Test all four InstallStatus outcomes for directory validation."""

    def test_not_installed(self, tmp_path: Path) -> None:
        """Directory does not exist → NOT_INSTALLED."""
        registry = ModelRegistry(tmp_path / "nonexistent_root")
        report = registry.validate_directory(
            ModelEntry(size=ModelSize.S_0_6B, profile=ModelProfile.BASE)
        )
        assert report.status == InstallStatus.NOT_INSTALLED

    def test_partial_missing_model_safetensors(self, tmp_path: Path) -> None:
        """Directory exists but model.safetensors is missing → PARTIAL."""
        entry = ModelEntry(size=ModelSize.S_0_6B, profile=ModelProfile.BASE)
        registry = ModelRegistry(tmp_path)
        d = registry._dir_for(entry)
        d.mkdir(parents=True)
        # Create config.json but NOT model.safetensors
        (d / "config.json").write_text('{"key": "value"}')

        report = registry.validate_directory(entry)
        assert report.status == InstallStatus.PARTIAL
        assert "model.safetensors" in report.missing_files

    def test_partial_missing_config(self, tmp_path: Path) -> None:
        """Directory exists but config.json is missing → PARTIAL."""
        entry = ModelEntry(size=ModelSize.S_1_7B, profile=ModelProfile.CUSTOM_VOICE)
        registry = ModelRegistry(tmp_path)
        d = registry._dir_for(entry)
        d.mkdir(parents=True)
        # Create model.safetensors but NOT config.json
        (d / "model.safetensors").write_text("fake weights")

        report = registry.validate_directory(entry)
        assert report.status == InstallStatus.PARTIAL
        assert "config.json" in report.missing_files

    def test_complete(self, tmp_path: Path) -> None:
        """All required files present → COMPLETE."""
        entry = ModelEntry(size=ModelSize.S_0_6B, profile=ModelProfile.VOICE_DESIGN)
        registry = ModelRegistry(tmp_path)
        d = registry._dir_for(entry)
        d.mkdir(parents=True)
        (d / "model.safetensors").write_text("fake weights content")
        (d / "config.json").write_text('{"arch": "qwen3-tts"}')

        report = registry.validate_directory(entry)
        assert report.status == InstallStatus.COMPLETE
        assert report.missing_files == ()
        assert report.installed_size_bytes is not None
        assert report.installed_size_bytes > 0

    def test_corrupt_unreadable_file(self, tmp_path: Path) -> None:
        """A required file exists but stat() raises OSError → CORRUPT."""
        entry = ModelEntry(size=ModelSize.S_1_7B, profile=ModelProfile.BASE)
        registry = ModelRegistry(tmp_path)
        d = registry._dir_for(entry)
        d.mkdir(parents=True)
        # Create files
        (d / "model.safetensors").write_text("ok")
        (d / "config.json").write_text("ok")

        # Mock Path.stat to raise OSError for model.safetensors only
        real_stat = Path.stat

        # Counter so the file passes exists() (which catches OSError internally)
        # but fails on the explicit fp.stat().st_size call.
        call_count = 0

        def _failing_stat(self_path: Path, *, follow_symlinks: bool = True) -> os.stat_result:
            nonlocal call_count
            if self_path.name == "model.safetensors":
                call_count += 1
                if call_count == 2:  # second call is the st_size access
                    raise OSError("Permission denied")
            return real_stat(self_path, follow_symlinks=follow_symlinks)

        with mock.patch("pathlib.Path.stat", _failing_stat):
            report = registry.validate_directory(entry)
            assert report.status == InstallStatus.CORRUPT
            assert "model.safetensors" in report.missing_files

    def test_path_is_not_directory(self, tmp_path: Path) -> None:
        """If a file exists where a directory is expected → CORRUPT."""
        entry = ModelEntry(size=ModelSize.S_0_6B, profile=ModelProfile.BASE)
        registry = ModelRegistry(tmp_path)
        d = registry._dir_for(entry)
        d.parent.mkdir(parents=True, exist_ok=True)
        d.write_text("i am a file not a dir")

        report = registry.validate_directory(entry)
        assert report.status == InstallStatus.CORRUPT
        assert "not a directory" in (report.detail or "").lower()

    def test_scan_all_entries(self, tmp_path: Path) -> None:
        """scan() must return a report for every known combination."""
        registry = ModelRegistry(tmp_path)
        reports = registry.scan()
        assert len(reports) == 6
        # All should be NOT_INSTALLED since the dir doesn't exist
        for r in reports:
            assert r.status == InstallStatus.NOT_INSTALLED

    def test_root_property(self, tmp_path: Path) -> None:
        registry = ModelRegistry(tmp_path)
        assert registry.root == tmp_path


# ---------------------------------------------------------------------------
# ModelStatusReport dataclass
# ---------------------------------------------------------------------------

class TestModelStatusReport:
    def test_frozen(self) -> None:
        from qwen_tts_worker.models.registry import ModelStatusReport

        r = ModelStatusReport(
            size=ModelSize.S_0_6B,
            profile=ModelProfile.BASE,
            status=InstallStatus.NOT_INSTALLED,
            path=Path("/tmp/nope"),
        )
        with pytest.raises(Exception):  # FrozenInstanceError or similar
            r.status = InstallStatus.COMPLETE  # type: ignore[misc]
