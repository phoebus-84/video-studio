"""Tests for the settings/configuration system.

Covers:
- Default values.
- Environment variable overrides.
- Unix socket binding.
- Validation (port range, timeout minimums).
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from qwen_tts_worker.config import Settings


class TestSettingsDefaults:
    """Default values must match the spec."""

    def test_default_host_localhost(self) -> None:
        s = Settings()
        assert s.host == "127.0.0.1"

    def test_default_port_8000(self) -> None:
        s = Settings()
        assert s.port == 8000

    def test_default_unix_socket_none(self) -> None:
        s = Settings()
        assert s.unix_socket is None

    def test_default_log_level_info(self) -> None:
        s = Settings()
        assert s.log_level == "info"

    def test_default_log_format_json(self) -> None:
        s = Settings()
        assert s.log_format == "json"

    def test_default_tts_mode_is_live(self) -> None:
        s = Settings()
        assert s.tts_mode == "live"

    def test_default_workers_1(self) -> None:
        s = Settings()
        assert s.workers == 1

    def test_default_graceful_timeout_30(self) -> None:
        s = Settings()
        assert s.graceful_timeout == 30.0


class TestSettingsEnvOverrides:
    """Environment variables with the QTW_ prefix must override defaults."""

    def test_env_override_host(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("QTW_HOST", "0.0.0.0")
        s = Settings()
        assert s.host == "0.0.0.0"

    def test_env_override_port(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("QTW_PORT", "9090")
        s = Settings()
        assert s.port == 9090

    def test_env_override_unix_socket(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("QTW_UNIX_SOCKET", "/tmp/qtw.sock")
        s = Settings()
        assert s.unix_socket == "/tmp/qtw.sock"

    def test_env_override_log_level(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("QTW_LOG_LEVEL", "debug")
        s = Settings()
        assert s.log_level == "debug"

    def test_env_override_graceful_timeout(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("QTW_GRACEFUL_TIMEOUT", "15.5")
        s = Settings()
        assert s.graceful_timeout == 15.5

    def test_fake_tts_requires_explicit_mode(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("QTW_TTS_MODE", "fake")
        s = Settings()
        assert s.tts_mode == "fake"


class TestSettingsValidation:
    """Invalid settings must be rejected at construction time."""

    def test_port_must_be_positive(self) -> None:
        with pytest.raises(Exception):  # pydantic ValidationError
            Settings(port=0)

    def test_port_must_not_exceed_65535(self) -> None:
        with pytest.raises(Exception):
            Settings(port=99999)

    def test_graceful_timeout_must_be_at_least_1(self) -> None:
        with pytest.raises(Exception):
            Settings(graceful_timeout=0.0)

    def test_tts_mode_rejects_implicit_fallback_values(self) -> None:
        with pytest.raises(Exception):
            Settings(tts_mode="auto")


class TestSettingsDirectoryCreation:
    """Directories specified in settings must be created automatically."""

    def test_models_dir_created(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        d = tmp_path / "test_models"
        monkeypatch.chdir(tmp_path)
        monkeypatch.setenv("QTW_MODELS_DIR", str(d))
        Settings()
        assert d.exists()
        assert d.is_dir()

    def test_voices_dir_created(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        d = tmp_path / "test_voices"
        monkeypatch.chdir(tmp_path)
        monkeypatch.setenv("QTW_VOICES_DIR", str(d))
        Settings()
        assert d.exists()
        assert d.is_dir()

    def test_outputs_dir_created(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        d = tmp_path / "test_outputs"
        monkeypatch.chdir(tmp_path)
        monkeypatch.setenv("QTW_OUTPUTS_DIR", str(d))
        Settings()
        assert d.exists()
        assert d.is_dir()
