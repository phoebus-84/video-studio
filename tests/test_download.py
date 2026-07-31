"""Tests for the model download command.

Covers:
- Disk space preflight (insufficient → DownloadError).
- Unknown model size → DownloadError.
- Cancellation handling.
- Hash verification.
- No real network access — all external calls are mocked.
"""

from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path
from unittest import mock

import pytest

from qwen_tts_worker.cli import (
    DownloadError,
    check_disk_space,
    download_model,
)


# ---------------------------------------------------------------------------
# Disk space checks
# ---------------------------------------------------------------------------

class TestCheckDiskSpace:
    def test_sufficient_space(self, tmp_path: Path) -> None:
        """When disk space exceeds 2× expected, no error raised."""
        # Mock disk_usage to report 10 GB free (plenty for any model).
        with mock.patch("shutil.disk_usage") as m_du:
            m_du.return_value = mock.Mock(free=10_000_000_000)
            free = check_disk_space(tmp_path, "0.6B")
        assert free == 10_000_000_000

    def test_insufficient_space_raises(self, tmp_path: Path) -> None:
        """When disk space < 2× expected, raise DownloadError."""
        # 0.6B expects ~1.3 GB, so 2× = 2.6 GB. Report only 1 GB free.
        with mock.patch("shutil.disk_usage") as m_du:
            m_du.return_value = mock.Mock(free=1_000_000_000)
            with pytest.raises(DownloadError, match="Insufficient disk space"):
                check_disk_space(tmp_path, "0.6B")

    def test_unknown_model_size(self, tmp_path: Path) -> None:
        """Unknown model size must raise DownloadError."""
        with pytest.raises(DownloadError, match="Unknown model size"):
            check_disk_space(tmp_path, "999B")


# ---------------------------------------------------------------------------
# Download preflight errors (before any network call)
# ---------------------------------------------------------------------------

class TestDownloadPreflight:
    def test_unknown_size_raises(self, tmp_path: Path) -> None:
        """Downloading an unknown size must raise immediately."""
        with pytest.raises(DownloadError, match="Unknown model size"):
            download_model(tmp_path, "999B")

    def test_insufficient_disk_before_any_network(self, tmp_path: Path) -> None:
        """Disk check must happen before any download attempt."""
        with mock.patch("shutil.disk_usage") as m_du:
            m_du.return_value = mock.Mock(free=1)
            with pytest.raises(DownloadError, match="Insufficient disk space"):
                download_model(tmp_path, "0.6B")


# ---------------------------------------------------------------------------
# Cancellation
# ---------------------------------------------------------------------------

class TestDownloadCancellation:
    def test_cancel_before_download(self, tmp_path: Path) -> None:
        """Cancellation checked between phases must abort cleanly."""
        with mock.patch("shutil.disk_usage") as m_du:
            m_du.return_value = mock.Mock(free=10_000_000_000)
            # Cancel immediately
            cancel = mock.Mock(return_value=True)
            with pytest.raises(DownloadError, match="cancelled"):
                download_model(tmp_path, "0.6B", cancel_event=cancel)
            # Cancel callback must have been consulted
            cancel.assert_called()

    def test_cancel_not_called_for_success_path(self, tmp_path: Path) -> None:
        """When not cancelled, cancel_event must still be callable but return False."""
        with mock.patch("shutil.disk_usage") as m_du:
            m_du.return_value = mock.Mock(free=10_000_000_000)
            cancel = mock.Mock(return_value=False)
            # Will fail later because we mock the download function,
            # but the cancel path should be exercised.
            with mock.patch(
                "qwen_tts_worker.cli._download_single",
                side_effect=DownloadError("mock — cannot actually download in tests"),
            ):
                with pytest.raises(DownloadError, match="mock"):
                    download_model(tmp_path, "0.6B", cancel_event=cancel)
            # Cancel was consulted (at least once for each file in the model)
            assert cancel.call_count >= 1


# ---------------------------------------------------------------------------
# Metadata integrity
# ---------------------------------------------------------------------------

class TestModelMetadata:
    def test_metadata_has_expected_keys(self) -> None:
        """Every known model must have repo, disk bytes, and file hashes."""
        from qwen_tts_worker.cli import _MODEL_METADATA

        for size, meta in _MODEL_METADATA.items():
            assert meta["huggingface_repo"].startswith("mlx-community/Qwen3-TTS-12Hz-")
            assert re.fullmatch(r"[0-9a-f]{40}", meta["revision"])
            assert "expected_disk_bytes" in meta
            assert "files" in meta
            assert isinstance(meta["files"], dict)
            assert len(meta["files"]) >= 2  # model.safetensors + config.json
            for fname, finfo in meta["files"].items():
                assert re.fullmatch(r"[0-9a-f]{64}", finfo["sha256"]), (
                    f"{size}/{fname} has an unverified sha256"
                )
                assert finfo["size_bytes"] > 0
                assert "placeholder-" not in finfo["sha256"]

    def test_all_known_sizes_are_in_model_size_enum(self) -> None:
        """Every key in _MODEL_METADATA must be a valid ModelSize."""
        from qwen_tts_worker.cli import _MODEL_METADATA
        from qwen_tts_worker.models.registry import ModelSize

        for size in _MODEL_METADATA:
            ModelSize(size)  # must not raise


# ---------------------------------------------------------------------------
# Progress callback
# ---------------------------------------------------------------------------

class TestProgressCallback:
    def test_on_progress_called(self, tmp_path: Path) -> None:
        """Progress messages must be emitted via callback."""
        progress_msgs: list[str] = []

        with mock.patch("shutil.disk_usage") as m_du:
            m_du.return_value = mock.Mock(free=10_000_000_000)
            with mock.patch(
                "qwen_tts_worker.cli._download_single",
                side_effect=DownloadError("mock"),
            ):
                try:
                    download_model(tmp_path, "0.6B", on_progress=progress_msgs.append)
                except DownloadError:
                    pass

        # Should have at least the disk check message
        assert any("disk space" in m.lower() for m in progress_msgs)


# ---------------------------------------------------------------------------
# Hash verification
# ---------------------------------------------------------------------------

class TestHashVerification:
    def test_sha256_file(self, tmp_path: Path) -> None:
        """_sha256_file must compute the correct hash."""
        from qwen_tts_worker.cli import _sha256_file

        content = b"test content for hashing"
        f = tmp_path / "test.bin"
        f.write_bytes(content)

        expected = hashlib.sha256(content).hexdigest()
        actual = _sha256_file(f)
        assert actual == expected

    def test_download_single_matching_hash_and_size_passes(self, tmp_path: Path) -> None:
        from qwen_tts_worker.cli import _download_single

        content = b"verified model bytes"
        dest = tmp_path / "model.safetensors"
        dest.write_bytes(content)
        fake_hf_hub = mock.MagicMock()
        fake_hf_hub.hf_hub_download.return_value = str(dest)

        with mock.patch.dict("sys.modules", {"huggingface_hub": fake_hf_hub}):
            _download_single(
                repo_id="mlx-community/model",
                revision="a" * 40,
                filename=dest.name,
                dest=dest,
                expected_sha256=hashlib.sha256(content).hexdigest(),
                expected_size_bytes=len(content),
                on_progress=None,
                cancel_event=None,
            )

        assert dest.read_bytes() == content
        fake_hf_hub.hf_hub_download.assert_called_once_with(
            repo_id="mlx-community/model",
            revision="a" * 40,
            filename=dest.name,
            local_dir=dest.parent,
            local_dir_use_symlinks=False,
        )

    def test_download_single_size_mismatch_refuses_and_removes_file(
        self, tmp_path: Path
    ) -> None:
        from qwen_tts_worker.cli import _download_single

        dest = tmp_path / "model.safetensors"
        dest.write_bytes(b"truncated")
        fake_hf_hub = mock.MagicMock()
        fake_hf_hub.hf_hub_download.return_value = str(dest)
        with mock.patch.dict("sys.modules", {"huggingface_hub": fake_hf_hub}):
            with pytest.raises(DownloadError, match="Size mismatch"):
                _download_single(
                    repo_id="test/repo",
                    filename=dest.name,
                    dest=dest,
                    expected_sha256="a" * 64,
                    expected_size_bytes=10_000,
                    on_progress=None,
                    cancel_event=None,
                )
        assert not dest.exists()

    def test_download_single_hash_mismatch(self, tmp_path: Path) -> None:
        """When downloaded file doesn't match expected hash, raise DownloadError."""
        from qwen_tts_worker.cli import _download_single

        dest = tmp_path / "model.safetensors"
        dest.write_text("wrong content")

        fake_hf_hub = mock.MagicMock()
        fake_hf_hub.hf_hub_download.return_value = str(dest)

        with mock.patch.dict("sys.modules", {"huggingface_hub": fake_hf_hub}):
            with pytest.raises(DownloadError, match="Hash mismatch"):
                _download_single(
                    repo_id="test/repo",
                    filename="model.safetensors",
                    dest=dest,
                    expected_sha256="abcdef1234567890",
                    on_progress=None,
                    cancel_event=None,
                )

    def test_download_single_requires_huggingface_hub(self, tmp_path: Path) -> None:
        """If huggingface_hub is not installed, raise clear error."""
        from qwen_tts_worker.cli import _download_single

        dest = tmp_path / "model.safetensors"

        with mock.patch.dict("sys.modules", {"huggingface_hub": None}):
            import builtins
            orig_import = builtins.__import__

            def fake_import(name, *args, **kwargs):
                if name == "huggingface_hub":
                    raise ImportError("No module named 'huggingface_hub'")
                return orig_import(name, *args, **kwargs)

            with mock.patch("builtins.__import__", side_effect=fake_import):
                with pytest.raises(DownloadError, match="huggingface_hub"):
                    _download_single(
                        repo_id="test/repo",
                        filename="model.safetensors",
                        dest=dest,
                        expected_sha256="abc",
                        on_progress=None,
                        cancel_event=None,
                    )
