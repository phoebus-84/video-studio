"""Blinded offline review package tests."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "evaluation" / "create_listening_review.py"
SPEC = importlib.util.spec_from_file_location("create_listening_review", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
review = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(review)


def test_review_page_uses_opaque_audio_and_complete_rubric(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(review, "ROOT", tmp_path)
    run = tmp_path / "run"
    results = run / "results"
    results.mkdir(parents=True)
    source = tmp_path / "private"
    source.mkdir()
    (source / "baseline.wav").write_bytes(b"baseline")
    (source / "candidate.wav").write_bytes(b"candidate")
    (source / "baseline-full.wav").write_bytes(b"baseline-full")
    (source / "candidate-full.wav").write_bytes(b"candidate-full")
    (results / "listening-items.json").write_text(json.dumps({
        "items": [{
            "item_id": "segment-1.repeat-1",
            "A": "private/candidate.wav",
            "B": "private/baseline.wav",
        }]
    }))
    (results / "continuity-items.json").write_text(json.dumps({
        "items": [{
            "item_id": "full-assembly.repeat-1",
            "A": "private/baseline-full.wav",
            "B": "private/candidate-full.wav",
        }]
    }))
    output = results / "review.html"
    review.create(run, output)
    document = output.read_text()
    assert "listening-audio/item-001-A.wav" in document
    assert "listening-audio/item-001-B.wav" in document
    assert "private/candidate" not in document
    assert "private/baseline" not in document
    assert "listening-audio/item-002-A.wav" in document
    for dimension in review.DIMENSIONS:
        assert f'{dimension}_A' in document
        assert f'{dimension}_B' in document
    assert (results / "listening-audio" / "item-001-A.wav").read_bytes() == b"candidate"
    assert (results / "listening-audio" / "item-002-A.wav").read_bytes() == b"baseline-full"
    assert "listening-key" not in document
    assert ".join('\\n')+'\\n'" in document
    assert ".join('\n')+'\n'" not in document
