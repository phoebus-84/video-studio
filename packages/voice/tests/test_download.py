"""Atomic profile-aware model installer tests without network access."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from unittest import mock

import pytest

from qwen_tts_worker.cli import DownloadError, _sha256_file, check_disk_space, download_model
from qwen_tts_worker.models.catalog import MODEL_SPECS, ModelSpec, VerifiedFile


def tiny_spec() -> tuple[ModelSpec, dict[str, bytes]]:
    files = {
        "model.safetensors": b"model",
        "config.json": json.dumps({"model_type": "qwen3_tts", "tts_model_type": "base"}).encode(),
        "generation_config.json": b"{}", "merges.txt": b"m", "tokenizer_config.json": b"{}",
        "vocab.json": b"{}", "speech_tokenizer/model.safetensors": b"tokenizer",
        "speech_tokenizer/config.json": b"{}",
    }
    verified = tuple(
        VerifiedFile(path, len(files[path]), hashlib.sha256(files[path]).hexdigest())
        for path in ("model.safetensors", "config.json", "speech_tokenizer/model.safetensors")
    )
    return ModelSpec("0.6B", "base", "test/base", "a" * 40, 1000, verified), files


def fake_hub(files: dict[str, bytes]):
    def snapshot_download(*, local_dir, **kwargs):
        root = Path(local_dir)
        for name, data in files.items():
            path = root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
        return str(root)
    module = mock.MagicMock(); module.snapshot_download.side_effect = snapshot_download
    return module


def test_catalog_has_only_real_profile_combinations_and_verified_critical_files() -> None:
    assert {(x.size, x.profile) for x in MODEL_SPECS} == {
        ("0.6B", "custom_voice"), ("0.6B", "base"),
        ("1.7B", "custom_voice"), ("1.7B", "base"), ("1.7B", "voice_design"),
    }
    for spec in MODEL_SPECS:
        assert spec.repository.startswith("mlx-community/Qwen3-TTS-12Hz-")
        assert len(spec.revision) == 40
        assert {x.path for x in spec.verified_files} == {
            "model.safetensors", "config.json", "speech_tokenizer/model.safetensors"
        }
        assert all(len(x.sha256) == 64 and x.size_bytes > 0 for x in spec.verified_files)


def test_disk_preflight_and_unknown_profile(tmp_path: Path) -> None:
    with mock.patch("shutil.disk_usage", return_value=mock.Mock(free=10_000_000_000)):
        assert check_disk_space(tmp_path, "0.6B", "base") == 10_000_000_000
    with mock.patch("shutil.disk_usage", return_value=mock.Mock(free=1)):
        with pytest.raises(DownloadError, match="Insufficient"):
            check_disk_space(tmp_path, "0.6B", "base")
    with pytest.raises(DownloadError, match="unsupported model"):
        check_disk_space(tmp_path, "0.6B", "voice_design")


def test_atomic_snapshot_install_manifest_and_idempotence(tmp_path: Path) -> None:
    spec, files = tiny_spec(); progress = []
    with mock.patch("qwen_tts_worker.cli.get_model_spec", return_value=spec), \
         mock.patch("shutil.disk_usage", return_value=mock.Mock(free=100_000)), \
         mock.patch.dict("sys.modules", {"huggingface_hub": fake_hub(files)}):
        target = download_model(tmp_path, "0.6B", profile="base", on_progress=progress.append)
        again = download_model(tmp_path, "0.6B", profile="base")
    assert target == again == tmp_path / spec.directory_name
    manifest = json.loads((target / ".download.json").read_text())
    assert manifest["repository"] == spec.repository and manifest["revision"] == spec.revision
    assert manifest["files"]["model.safetensors"]["sha256"] == hashlib.sha256(b"model").hexdigest()
    assert any("Installed and verified" in item for item in progress)
    assert not list(tmp_path.glob(f".{spec.directory_name}.*"))


def test_cancel_and_failed_verification_leave_no_published_directory(tmp_path: Path) -> None:
    spec, files = tiny_spec()
    with mock.patch("qwen_tts_worker.cli.get_model_spec", return_value=spec), \
         mock.patch("shutil.disk_usage", return_value=mock.Mock(free=100_000)):
        with pytest.raises(DownloadError, match="cancelled"):
            download_model(tmp_path, "0.6B", profile="base", cancel_event=lambda: True)
    broken = dict(files); broken["model.safetensors"] = b"wrong"
    with mock.patch("qwen_tts_worker.cli.get_model_spec", return_value=spec), \
         mock.patch("shutil.disk_usage", return_value=mock.Mock(free=100_000)), \
         mock.patch.dict("sys.modules", {"huggingface_hub": fake_hub(broken)}):
        with pytest.raises(DownloadError, match="size mismatch|SHA-256 mismatch"):
            download_model(tmp_path, "0.6B", profile="base")
    assert not spec.path_under(tmp_path).exists()
    assert not list(tmp_path.glob(f".{spec.directory_name}.*"))


def test_existing_unverified_directory_requires_explicit_replace(tmp_path: Path) -> None:
    spec, files = tiny_spec(); target = spec.path_under(tmp_path); target.mkdir(); (target / "junk").write_text("x")
    with mock.patch("qwen_tts_worker.cli.get_model_spec", return_value=spec), \
         mock.patch("shutil.disk_usage", return_value=mock.Mock(free=100_000)):
        with pytest.raises(DownloadError, match="--replace"):
            download_model(tmp_path, "0.6B", profile="base")
    with mock.patch("qwen_tts_worker.cli.get_model_spec", return_value=spec), \
         mock.patch("shutil.disk_usage", return_value=mock.Mock(free=100_000)), \
         mock.patch.dict("sys.modules", {"huggingface_hub": fake_hub(files)}):
        replaced = download_model(tmp_path, "0.6B", profile="base", replace=True)
    assert not (replaced / "junk").exists()


def test_hash_helper(tmp_path: Path) -> None:
    path = tmp_path / "value"; path.write_bytes(b"value")
    assert _sha256_file(path) == hashlib.sha256(b"value").hexdigest()
