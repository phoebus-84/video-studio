"""Key-free deterministic Pages package tests."""

from __future__ import annotations

import gzip
import importlib.util
import io
import tarfile
import wave
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "evaluation" / "package_listening_review.py"
SPEC = importlib.util.spec_from_file_location("package_listening_review", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
package = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(package)
ReviewPackageError = package.ReviewPackageError
create_package = package.create_package
verify_and_extract = package.verify_and_extract


def wav(path: Path) -> None:
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1); output.setsampwidth(2); output.setframerate(24_000); output.writeframes(b"\x01\x00" * 10)


def review_source(root: Path) -> Path:
    audio = root / "listening-audio"; audio.mkdir(parents=True)
    sections = []
    for item in range(1, 56):
        sections.append(f'<section data-item="item-{item}"><audio src="listening-audio/item-{item:03d}-A.wav"></audio><audio src="listening-audio/item-{item:03d}-B.wav"></audio></section>')
        wav(audio / f"item-{item:03d}-A.wav"); wav(audio / f"item-{item:03d}-B.wav")
    (root / "listening-review.html").write_text("".join(sections) + "<script>const csv=rows.join('\\n')+'\\n';</script>")
    return root


def test_package_is_deterministic_verified_and_key_free(tmp_path: Path) -> None:
    source = review_source(tmp_path / "source")
    first = create_package(source, tmp_path / "first.tar.gz")
    second = create_package(source, tmp_path / "second.tar.gz")
    assert first.read_bytes() == second.read_bytes()
    destination = tmp_path / "site" / "listening" / "candidate-qtw-v1"
    verify_and_extract(first, destination)
    assert (destination / "index.html").is_file()
    assert len(list((destination / "listening-audio").glob("*.wav"))) == 110
    assert not any("key" in path.name for path in destination.rglob("*"))


def test_verifier_rejects_extra_unblinding_member(tmp_path: Path) -> None:
    archive = tmp_path / "unsafe.tar.gz"
    with archive.open("wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode="w") as tar:
            data = b"secret"; info = tarfile.TarInfo("review/listening-key.json"); info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    with pytest.raises(ReviewPackageError):
        verify_and_extract(archive, tmp_path / "site")
