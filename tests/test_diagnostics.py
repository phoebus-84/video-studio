"""Tests for dependency diagnostics (mlx-audio, FFmpeg probes).

Covers:
- FFmpeg probe with shutil.which mocking.
- mlx-audio probe with import mocking.
- probe_all returns results from both probes.
- Probe failures are isolated and reported.
"""

from __future__ import annotations

import subprocess
from unittest import mock

from qwen_tts_worker.models.diagnostics import (
    DepProbe,
    DepStatus,
    probe_all,
    probe_ffmpeg,
    probe_mlx_audio,
)


# ---------------------------------------------------------------------------
# FFmpeg probe
# ---------------------------------------------------------------------------

class TestFfmpegProbe:
    def test_not_found_on_path(self) -> None:
        """When ffmpeg is not on PATH, return MISSING."""
        with mock.patch("shutil.which", return_value=None):
            result = probe_ffmpeg()
        assert result.status == DepStatus.MISSING
        assert result.name == "ffmpeg"
        assert "not found" in (result.detail or "").lower()

    def test_found_and_returns_version(self) -> None:
        """When ffmpeg is found and runs successfully, return OK with version."""
        fake_stdout = "ffmpeg version 6.1.1 Copyright (c) 2000-2023 the FFmpeg developers\nbuilt with ..."

        with mock.patch("shutil.which", return_value="/usr/local/bin/ffmpeg"):
            with mock.patch("subprocess.run") as mock_run:
                mock_run.return_value = mock.Mock(
                    returncode=0,
                    stdout=fake_stdout,
                    stderr="",
                )
                result = probe_ffmpeg()

        assert result.status == DepStatus.OK
        assert result.version == "6.1.1"
        assert "/usr/local/bin/ffmpeg" in (result.detail or "")

    def test_exits_nonzero(self) -> None:
        """When ffmpeg --version returns non-zero, return ERROR."""
        with mock.patch("shutil.which", return_value="/usr/bin/ffmpeg"):
            with mock.patch("subprocess.run") as mock_run:
                mock_run.return_value = mock.Mock(
                    returncode=1,
                    stdout="",
                    stderr="segfault",
                )
                result = probe_ffmpeg()

        assert result.status == DepStatus.ERROR
        assert "exited with code 1" in (result.detail or "")

    def test_timeout(self) -> None:
        """When ffmpeg hangs, return ERROR after timeout."""
        with mock.patch("shutil.which", return_value="/usr/bin/ffmpeg"):
            with mock.patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd="ffmpeg", timeout=10)):
                result = probe_ffmpeg()

        assert result.status == DepStatus.ERROR
        assert "timed out" in (result.detail or "").lower()


# ---------------------------------------------------------------------------
# mlx-audio probe
# ---------------------------------------------------------------------------

class TestMlxAudioProbe:
    def test_not_installed(self) -> None:
        """When mlx_audio cannot be imported, return MISSING."""
        with mock.patch.dict("sys.modules", {"mlx_audio": None}):
            # Simulate ImportError by making the import fail
            import builtins
            orig_import = builtins.__import__

            def fake_import(name, *args, **kwargs):
                if name == "mlx_audio":
                    raise ImportError("No module named 'mlx_audio'")
                return orig_import(name, *args, **kwargs)

            with mock.patch("builtins.__import__", side_effect=fake_import):
                result = probe_mlx_audio()

        assert result.status == DepStatus.MISSING
        assert result.name == "mlx-audio"
        assert "not installed" in (result.detail or "").lower()

    def test_installed_with_version(self) -> None:
        """When mlx_audio is importable, return OK with version."""
        fake_module = mock.MagicMock()
        fake_module.__version__ = "0.1.0"

        with mock.patch.dict("sys.modules", {"mlx_audio": fake_module}):
            result = probe_mlx_audio()

        assert result.status == DepStatus.OK
        assert result.version == "0.1.0"

    def test_installed_without_version(self) -> None:
        """mlx_audio present but no __version__ attribute → OK with None version."""
        fake_module = mock.MagicMock(spec=[])
        # Remove __version__ from the spec

        with mock.patch.dict("sys.modules", {"mlx_audio": fake_module}):
            result = probe_mlx_audio()

        assert result.status == DepStatus.OK
        assert result.version is None


# ---------------------------------------------------------------------------
# Aggregate probe
# ---------------------------------------------------------------------------

class TestProbeAll:
    def test_returns_tuple_of_probes(self) -> None:
        """probe_all must return a tuple of DepProbe objects."""
        with mock.patch("qwen_tts_worker.models.diagnostics.probe_ffmpeg") as m_ff:
            with mock.patch("qwen_tts_worker.models.diagnostics.probe_mlx_audio") as m_mlx:
                m_ff.return_value = DepProbe(name="ffmpeg", status=DepStatus.OK)
                m_mlx.return_value = DepProbe(name="mlx-audio", status=DepStatus.OK)
                results = probe_all()

        assert len(results) == 2
        assert all(isinstance(r, DepProbe) for r in results)
        assert {r.name for r in results} == {"ffmpeg", "mlx-audio"}

    def test_one_probe_fails_other_succeeds(self) -> None:
        """A failure in one probe must not prevent the other from running."""
        with mock.patch("qwen_tts_worker.models.diagnostics.probe_ffmpeg") as m_ff:
            with mock.patch("qwen_tts_worker.models.diagnostics.probe_mlx_audio") as m_mlx:
                m_ff.side_effect = RuntimeError("boom")
                m_mlx.return_value = DepProbe(name="mlx-audio", status=DepStatus.OK)
                results = probe_all()

        assert len(results) == 2
        # ffmpeg probe should have error status
        ff_result = next(r for r in results if r.name == "ffmpeg")
        assert ff_result.status == DepStatus.ERROR
        assert "RuntimeError" in (ff_result.detail or "")

        # mlx-audio should be OK
        mlx_result = next(r for r in results if r.name == "mlx-audio")
        assert mlx_result.status == DepStatus.OK


# ---------------------------------------------------------------------------
# DepProbe dataclass
# ---------------------------------------------------------------------------

class TestDepProbe:
    def test_create_ok(self) -> None:
        p = DepProbe(name="test", status=DepStatus.OK, version="1.0", detail="ready")
        assert p.name == "test"
        assert p.status == DepStatus.OK
        assert p.version == "1.0"

    def test_create_missing(self) -> None:
        p = DepProbe(name="test", status=DepStatus.MISSING, detail="not found")
        assert p.status == DepStatus.MISSING
        assert p.version is None
