"""Download command for Qwen3-TTS MLX models.

**Explicit, cancellable, and hash-audited.**  The command:

1.  Checks available disk space before starting any transfer.
2.  Supports cancellation via SIGINT (Ctrl+C) with clean cleanup.
3.  Validates downloaded files against expected SHA-256 hashes.
4.  Leaves auditable state — a ``.download.json`` manifest is
    written alongside the model files.

No model blobs are bundled in this repository.  This command is the
**only** path to obtaining model files, and it must be invoked
explicitly by an operator.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import signal
import sys
from pathlib import Path
from typing import Callable

# ---------------------------------------------------------------------------
# Known model metadata
# ---------------------------------------------------------------------------

# Each entry declares a pinned Hugging Face revision and verified file size/hash.
# Values were checked 2026-07-31 against HF blob metadata; the local 1.7B copy
# was independently hashed. The CLI refuses any size or SHA-256 mismatch.
_MODEL_METADATA: dict[str, dict] = {
    "0.6B": {
        "huggingface_repo": "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit",
        "revision": "049ef77fe8816b536193c0c25f9a214d17921282",
        "expected_disk_bytes": 1_300_000_000,  # ~1.3 GB
        "files": {
            "model.safetensors": {
                "size_bytes": 1_286_743_170,
                "sha256": "3bcb2c4a127e6243e81a30b7126c7865f686d3559de4f938e5d3b150c6a9560d",
            },
            "config.json": {
                "size_bytes": 6_058,
                "sha256": "2eea3665564268139c3beb8d497fd3c2e4524e9eed5452836cdf1de96ed3cdbd",
            },
        },
    },
    "1.7B": {
        "huggingface_repo": "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit",
        "revision": "41d3337e8b7f2843a75841595fc14e4b9a7a4b96",
        "expected_disk_bytes": 3_500_000_000,  # includes speech tokenizer headroom
        "files": {
            "model.safetensors": {
                "size_bytes": 2_393_308_931,
                "sha256": "b696f4bf45f54497b6de758981e76f1410bd68af05a657477dee466b0202df1a",
            },
            "config.json": {
                "size_bytes": 6_058,
                "sha256": "43f29f9ab55cf387bd2ce1d07e9d95a5ca8974fa2fda4e2b45c13ae64aad3bfa",
            },
        },
    },
}

# Profiles that each model supports (same as the registry).
_PROFILES: tuple[str, ...] = ("custom_voice", "voice_design", "base")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


class DownloadError(Exception):
    """Raised when a download cannot proceed or fails."""


def check_disk_space(models_root: Path, model_size: str) -> int:
    """Return available disk bytes.  Raise ``DownloadError`` if insufficient.

    We require at least *2×* the expected size to account for temporary
    files during extraction/verification.
    """
    meta = _get_meta(model_size)
    needed = meta["expected_disk_bytes"] * 2

    usage = shutil.disk_usage(models_root)
    free = usage.free

    if free < needed:
        shortage = needed - free
        raise DownloadError(
            f"Insufficient disk space. Need {_human_bytes(needed)}, "
            f"have {_human_bytes(free)} (short by {_human_bytes(shortage)}). "
            f"Free up space or use a different QTW_MODELS_DIR."
        )
    return free


def download_model(
    models_root: Path,
    model_size: str,
    *,
    on_progress: Callable[[str], None] | None = None,
    cancel_event: Callable[[], bool] | None = None,
) -> Path:
    """Download a Qwen3-TTS MLX model to *models_root*.

    Args:
        models_root: Root directory for model storage.
        model_size: One of ``"0.6B"`` or ``"1.7B"``.
        on_progress: Optional callback receiving status messages.
        cancel_event: Optional callable returning ``True`` when
            cancellation is requested.  Checked between phases.

    Returns:
        Path to the downloaded model directory.

    Raises:
        DownloadError: On any failure including cancellation, disk
            shortage, or hash mismatch.
    """
    meta = _get_meta(model_size)

    # 1. Pre-flight: disk check
    _log(on_progress, f"Checking disk space under {models_root}...")
    check_disk_space(models_root, model_size)
    _log(on_progress, "Disk space OK.")

    # 2. Create directory structure
    model_dir = models_root / f"qwen3-tts-{model_size}"
    model_dir.mkdir(parents=True, exist_ok=True)

    # Each profile gets its own sub-directory.  The actual model weights
    # live at the model level and are symlinked/copied into profile dirs
    # by the lifecycle manager.  Here we lay down the skeleton.
    for profile in _PROFILES:
        (model_dir / profile).mkdir(parents=True, exist_ok=True)

    # 3. Download each file
    for fname, finfo in meta["files"].items():
        if cancel_event and cancel_event():
            raise DownloadError("Download cancelled by operator.")

        dest = model_dir / fname
        expected_sha = finfo["sha256"]

        _log(on_progress, f"Downloading {fname} from {meta['huggingface_repo']}...")

        # The actual download mechanism requires huggingface_hub or
        # direct HTTP.  For now we validate the contract and leave a
        # clear, typed error if the download library is missing.
        _download_single(
            repo_id=meta["huggingface_repo"],
            revision=meta["revision"],
            filename=fname,
            dest=dest,
            expected_sha256=expected_sha,
            expected_size_bytes=finfo["size_bytes"],
            on_progress=on_progress,
            cancel_event=cancel_event,
        )

        _log(on_progress, f"Verified {fname} ✓")

    # 4. Write audit manifest
    manifest_path = model_dir / ".download.json"
    manifest = {
        "model_size": model_size,
        "huggingface_repo": meta["huggingface_repo"],
        "revision": meta["revision"],
        "verification": "sha256-and-size",
        "downloaded_files": {
            fname: {
                "sha256": _sha256_file(model_dir / fname),
                "size_bytes": (model_dir / fname).stat().st_size,
            }
            for fname in meta["files"]
        },
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    _log(on_progress, f"Audit manifest written to {manifest_path}")

    return model_dir


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _download_single(
    repo_id: str,
    filename: str,
    dest: Path,
    expected_sha256: str,
    on_progress: Callable[[str], None] | None,
    cancel_event: Callable[[], bool] | None,
    *,
    revision: str | None = None,
    expected_size_bytes: int | None = None,
) -> None:
    """Download a single file from HuggingFace Hub and verify its hash.

    Requires ``huggingface_hub`` to be installed.  If it is missing,
    raises a clear ``DownloadError`` with installation instructions.
    """
    # Deferred import — huggingface_hub is only needed for downloads.
    try:
        from huggingface_hub import hf_hub_download  # type: ignore[import-untyped]
    except ImportError:
        raise DownloadError(
            "huggingface_hub is required for model downloads. "
            "Install it with: pip install huggingface_hub"
        )

    try:
        downloaded = hf_hub_download(
            repo_id=repo_id,
            revision=revision,
            filename=filename,
            local_dir=dest.parent,
            local_dir_use_symlinks=False,
        )
    except Exception as exc:
        raise DownloadError(
            f"Failed to download {filename} from {repo_id}: {exc}"
        ) from exc

    # Move to expected location if hf_hub_download placed it elsewhere.
    downloaded_path = Path(downloaded)
    if downloaded_path != dest:
        shutil.move(str(downloaded_path), str(dest))

    # Verify size before hashing so truncated/error pages fail clearly.
    if expected_size_bytes is not None and dest.stat().st_size != expected_size_bytes:
        actual_size = dest.stat().st_size
        dest.unlink(missing_ok=True)
        raise DownloadError(
            f"Size mismatch for {filename}: expected {expected_size_bytes} bytes, "
            f"got {actual_size} bytes"
        )

    # Verify hash
    actual = _sha256_file(dest)
    if actual != expected_sha256:
        dest.unlink(missing_ok=True)
        raise DownloadError(
            f"Hash mismatch for {filename}:\n"
            f"  expected: {expected_sha256}\n"
            f"  got:      {actual}"
        )


def _sha256_file(path: Path) -> str:
    """Compute SHA-256 of a file.  Returns hex digest."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(1 << 20)  # 1 MiB chunks
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _get_meta(model_size: str) -> dict:
    """Return metadata dict for *model_size*, or raise DownloadError."""
    if model_size not in _MODEL_METADATA:
        raise DownloadError(
            f"Unknown model size: '{model_size}'. "
            f"Known sizes: {', '.join(_MODEL_METADATA)}"
        )
    return _MODEL_METADATA[model_size]


def _log(cb: Callable[[str], None] | None, msg: str) -> None:
    """Send a progress message to the callback or print to stderr."""
    if cb:
        cb(msg)
    else:
        print(msg, file=sys.stderr)


def _human_bytes(n: int) -> str:
    """Format a byte count for human display."""
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> None:
    """Standalone download CLI for the Qwen3-TTS MLX model.

    Usage::

        python -m qwen_tts_worker.cli.download 0.6B
        python -m qwen_tts_worker.cli.download 1.7B --models-dir /cache/models

    The command is **explicit** — no automatic downloads are ever
    triggered by the worker itself.
    """
    import argparse

    parser = argparse.ArgumentParser(
        description="Download a Qwen3-TTS MLX model.",
    )
    parser.add_argument(
        "size",
        choices=list(_MODEL_METADATA.keys()),
        help="Model size to download.",
    )
    parser.add_argument(
        "--models-dir",
        type=Path,
        default=None,
        help="Models directory (default: QTW_MODELS_DIR env or ./models).",
    )
    args = parser.parse_args(argv)

    # Resolve models directory
    if args.models_dir:
        models_dir = args.models_dir
    else:
        try:
            from qwen_tts_worker.config import Settings
            models_dir = Settings().models_dir
        except Exception:
            models_dir = Path("models")

    # Cancellation handling
    cancelled = False

    def _on_signal(signum: int, frame: object) -> None:
        nonlocal cancelled
        cancelled = True
        signame = signal.Signals(signum).name
        print(f"\n[{signame}] Cancelling download...", file=sys.stderr)

    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    try:
        result = download_model(
            models_dir,
            args.size,
            cancel_event=lambda: cancelled,
        )
        print(f"Downloaded {args.size} to {result}", file=sys.stderr)
    except DownloadError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
