"""Create and verify a blinded, key-free GitHub Pages review package."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import shutil
import tarfile
import tempfile
import wave
from pathlib import Path, PurePosixPath


ITEM_COUNT = 55
AUDIO_COUNT = ITEM_COUNT * 2
AUDIO_PATTERN = re.compile(r"listening-audio/(item-\d{3}-[AB]\.wav)")
FORBIDDEN_NAMES = ("key", "unblind", "objective", "comparison")


class ReviewPackageError(RuntimeError):
    pass


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""): digest.update(chunk)
    return digest.hexdigest()


def _validate_html(path: Path) -> tuple[str, ...]:
    document = path.read_text(encoding="utf-8")
    if document.count("data-item=") != ITEM_COUNT:
        raise ReviewPackageError(f"review must contain exactly {ITEM_COUNT} items")
    references = tuple(AUDIO_PATTERN.findall(document))
    expected = tuple(f"item-{item:03d}-{side}.wav" for item in range(1, ITEM_COUNT + 1) for side in "AB")
    if references != expected: raise ReviewPackageError("review audio references are incomplete or out of order")
    if ".join('\\n')+'\\n'" not in document:
        raise ReviewPackageError("CSV export JavaScript does not contain escaped newline literals")
    return references


def _validate_wav(path: Path) -> None:
    try:
        with wave.open(str(path), "rb") as audio:
            properties = (audio.getnchannels(), audio.getsampwidth(), audio.getframerate())
            frames = audio.getnframes()
    except (EOFError, wave.Error) as exc:
        raise ReviewPackageError(f"invalid review WAV {path.name}: {exc}") from exc
    if properties != (1, 2, 24_000) or frames <= 0:
        raise ReviewPackageError(f"review WAV is not non-empty mono PCM16/24k: {path.name}")


def create_package(source: Path, output: Path) -> Path:
    source = source.resolve(); html = source / "listening-review.html"
    references = _validate_html(html)
    files = [html, *(source / "listening-audio" / name for name in references)]
    missing = [str(path) for path in files if not path.is_file()]
    if missing: raise ReviewPackageError(f"missing review files: {', '.join(missing)}")
    for path in files[1:]: _validate_wav(path)
    manifest = {
        "schema_version": "1.0.0", "review_id": "candidate-qtw-v1",
        "item_count": ITEM_COUNT, "audio_count": AUDIO_COUNT,
        "files": {"index.html": _sha256(html), **{
            f"listening-audio/{path.name}": _sha256(path) for path in files[1:]
        }},
    }
    output = output.expanduser().resolve(); output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    with temporary.open("wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode="w") as archive:
            for relative, data in [("manifest.json", (json.dumps(manifest, indent=2) + "\n").encode()), ("index.html", html.read_bytes())]:
                info = tarfile.TarInfo(f"review/{relative}"); info.size = len(data); info.mode = 0o644; info.mtime = 0
                archive.addfile(info, __import__("io").BytesIO(data))
            for path in files[1:]:
                data = path.read_bytes(); info = tarfile.TarInfo(f"review/listening-audio/{path.name}")
                info.size = len(data); info.mode = 0o644; info.mtime = 0; archive.addfile(info, __import__("io").BytesIO(data))
    os.replace(temporary, output)
    return output


def verify_and_extract(archive_path: Path, destination: Path) -> None:
    destination = destination.resolve(); destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix="qtw-pages-", dir=destination.parent))
    try:
        with tarfile.open(archive_path, "r:gz") as archive:
            members = archive.getmembers()
            if len(members) != AUDIO_COUNT + 2: raise ReviewPackageError("package has unexpected file count")
            for member in members:
                path = PurePosixPath(member.name)
                if not member.isfile() or path.is_absolute() or ".." in path.parts or path.parts[0] != "review":
                    raise ReviewPackageError(f"unsafe package member: {member.name}")
                if any(term in path.name.lower() for term in FORBIDDEN_NAMES):
                    raise ReviewPackageError(f"forbidden unblinding filename: {member.name}")
                target = temporary.joinpath(*path.parts[1:]); target.parent.mkdir(parents=True, exist_ok=True)
                source = archive.extractfile(member)
                if source is None: raise ReviewPackageError(f"cannot read package member: {member.name}")
                target.write_bytes(source.read())
        manifest = json.loads((temporary / "manifest.json").read_text())
        if manifest.get("item_count") != ITEM_COUNT or manifest.get("audio_count") != AUDIO_COUNT:
            raise ReviewPackageError("manifest review dimensions differ from current protocol")
        declared = manifest.get("files")
        if not isinstance(declared, dict) or len(declared) != AUDIO_COUNT + 1:
            raise ReviewPackageError("manifest file set is invalid")
        for name, digest in declared.items():
            path = temporary / name
            if not path.is_file() or _sha256(path) != digest: raise ReviewPackageError(f"hash mismatch: {name}")
        _validate_html(temporary / "index.html")
        for path in sorted((temporary / "listening-audio").glob("*.wav")): _validate_wav(path)
        if destination.exists(): shutil.rmtree(destination)
        os.replace(temporary, destination)
    finally:
        shutil.rmtree(temporary, ignore_errors=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__); sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("create"); create.add_argument("--source", type=Path, required=True); create.add_argument("--output", type=Path, required=True)
    verify = sub.add_parser("verify"); verify.add_argument("--archive", type=Path, required=True); verify.add_argument("--destination", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "create": print(create_package(args.source, args.output))
        else: verify_and_extract(args.archive, args.destination); print(args.destination)
    except (OSError, json.JSONDecodeError, tarfile.TarError, ReviewPackageError) as exc: parser.exit(1, f"error: {exc}\n")


if __name__ == "__main__": main()
