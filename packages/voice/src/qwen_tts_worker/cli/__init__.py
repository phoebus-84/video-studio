"""Atomic, pinned, profile-aware Qwen3-TTS model installer."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import signal
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from qwen_tts_worker.models.catalog import MODEL_SPECS, ModelSpec, get_model_spec


class DownloadError(RuntimeError):
    pass


def check_disk_space(models_root: Path, model_size: str, profile: str = "custom_voice") -> int:
    try:
        spec = get_model_spec(model_size, profile)
    except KeyError as exc:
        raise DownloadError(str(exc)) from exc
    models_root.mkdir(parents=True, exist_ok=True)
    free = shutil.disk_usage(models_root).free
    needed = spec.expected_disk_bytes * 2
    if free < needed:
        raise DownloadError(
            f"Insufficient disk space. Need {_human_bytes(needed)}, have {_human_bytes(free)}."
        )
    return free


def download_model(
    models_root: Path,
    model_size: str,
    *,
    profile: str = "custom_voice",
    on_progress: Callable[[str], None] | None = None,
    cancel_event: Callable[[], bool] | None = None,
    replace: bool = False,
) -> Path:
    """Download one exact checkpoint snapshot, verify it, and publish atomically."""

    try:
        spec = get_model_spec(model_size, profile)
    except KeyError as exc:
        raise DownloadError(str(exc)) from exc
    models_root = models_root.expanduser().resolve()
    _log(on_progress, f"Checking disk space for {spec.size}/{spec.profile}...")
    check_disk_space(models_root, model_size, profile)
    if cancel_event and cancel_event():
        raise DownloadError("Download cancelled by operator.")
    target = spec.path_under(models_root)
    if target.exists() and not replace:
        if _verify_directory(target, spec, require_manifest=True):
            _log(on_progress, f"Already installed and verified: {target}")
            return target
        if _verify_directory(target, spec, require_manifest=False):
            _write_manifest(target, spec)
            _log(on_progress, f"Adopted matching legacy snapshot and wrote verified manifest: {target}")
            return target
        raise DownloadError(
            f"Installation already exists but does not match the pinned catalogue: {target}. "
            "Inspect it, then rerun with --replace to remove it explicitly."
        )
    try:
        from huggingface_hub import snapshot_download  # type: ignore[import-untyped]
    except ImportError as exc:
        raise DownloadError(
            "huggingface_hub is required. Install qwen-tts-worker with its selected 'mlx' or 'torch' extra."
        ) from exc
    temporary = Path(tempfile.mkdtemp(prefix=f".{spec.directory_name}.", dir=models_root))
    try:
        _log(on_progress, f"Downloading {spec.repository}@{spec.revision}...")
        snapshot_download(
            repo_id=spec.repository,
            revision=spec.revision,
            local_dir=temporary,
            local_dir_use_symlinks=False,
        )
        shutil.rmtree(temporary / ".cache", ignore_errors=True)
        if cancel_event and cancel_event():
            raise DownloadError("Download cancelled by operator.")
        _verify_directory(temporary, spec, require_manifest=False, raise_error=True)
        _write_manifest(temporary, spec)
        if not _verify_directory(temporary, spec, require_manifest=True):
            raise DownloadError("post-manifest verification failed")
        if target.exists():
            if not replace:
                raise DownloadError(f"target appeared during download: {target}")
            shutil.rmtree(target)
        os.replace(temporary, target)
        _log(on_progress, f"Installed and verified {target}")
        return target
    except DownloadError:
        raise
    except Exception as exc:
        raise DownloadError(f"Failed to install {spec.repository}: {exc}") from exc
    finally:
        shutil.rmtree(temporary, ignore_errors=True)


def _verify_directory(
    directory: Path,
    spec: ModelSpec,
    *,
    require_manifest: bool,
    raise_error: bool = False,
) -> bool:
    try:
        required = (
            "model.safetensors", "config.json", "generation_config.json", "merges.txt",
            "tokenizer_config.json", "vocab.json", "speech_tokenizer/model.safetensors",
            "speech_tokenizer/config.json",
        )
        missing = [name for name in required if not (directory / name).is_file()]
        if missing: raise DownloadError(f"snapshot is missing: {', '.join(missing)}")
        config = json.loads((directory / "config.json").read_text())
        if config.get("model_type") != "qwen3_tts" or config.get("tts_model_type") != spec.profile:
            raise DownloadError(
                f"checkpoint type {config.get('tts_model_type')!r} does not match {spec.profile!r}"
            )
        for expected in spec.verified_files:
            path = directory / expected.path
            if path.stat().st_size != expected.size_bytes:
                raise DownloadError(f"size mismatch for {expected.path}")
            if _sha256_file(path) != expected.sha256:
                raise DownloadError(f"SHA-256 mismatch for {expected.path}")
        if require_manifest:
            manifest = json.loads((directory / ".download.json").read_text())
            if manifest.get("repository") != spec.repository or manifest.get("revision") != spec.revision:
                raise DownloadError("download manifest source identity mismatch")
        return True
    except (OSError, json.JSONDecodeError, DownloadError) as exc:
        if raise_error:
            if isinstance(exc, DownloadError): raise
            raise DownloadError(f"cannot verify model snapshot: {exc}") from exc
        return False


def _write_manifest(directory: Path, spec: ModelSpec) -> None:
    files = {
        str(path.relative_to(directory)): {
            "size_bytes": path.stat().st_size,
            "sha256": _sha256_file(path),
        }
        for path in sorted(directory.rglob("*"))
        if path.is_file() and path.name != ".download.json"
    }
    manifest = {
        "schema_version": "1.0.0", "size": spec.size, "profile": spec.profile,
        "repository": spec.repository, "revision": spec.revision,
        "verification": "pinned-revision-critical-sha256-and-complete-file-manifest",
        "installed_at": datetime.now(timezone.utc).isoformat(), "files": files,
    }
    temporary = directory / ".download.json.tmp"
    temporary.write_text(json.dumps(manifest, indent=2) + "\n")
    os.replace(temporary, directory / ".download.json")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _log(callback: Callable[[str], None] | None, message: str) -> None:
    (callback or (lambda value: print(value, file=sys.stderr)))(message)


def _human_bytes(value: int) -> str:
    amount = float(value)
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if amount < 1024: return f"{amount:.1f} {unit}"
        amount /= 1024
    return f"{amount:.1f} PiB"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Install a pinned Qwen3-TTS checkpoint for QTW_BACKEND.")
    parser.add_argument("size", choices=sorted({spec.size for spec in MODEL_SPECS}))
    parser.add_argument("--profile", choices=sorted({spec.profile for spec in MODEL_SPECS}), default="custom_voice")
    parser.add_argument("--models-dir", type=Path)
    parser.add_argument("--replace", action="store_true", help="Explicitly replace an unverified existing directory")
    args = parser.parse_args(argv)
    from qwen_tts_worker.config import Settings
    models_dir = args.models_dir or Settings().models_dir
    cancelled = False
    def cancel(signum: int, frame: object) -> None:
        nonlocal cancelled; cancelled = True
        print(f"\n[{signal.Signals(signum).name}] Cancelling after the current Hub operation...", file=sys.stderr)
    signal.signal(signal.SIGINT, cancel); signal.signal(signal.SIGTERM, cancel)
    try:
        download_model(models_dir, args.size, profile=args.profile,
                       cancel_event=lambda: cancelled, replace=args.replace)
    except DownloadError as exc:
        parser.exit(1, f"error: {exc}\n")


if __name__ == "__main__": main()
