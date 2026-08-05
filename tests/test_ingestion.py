"""Deterministic, source-mapped legacy script ingestion tests."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from qwen_tts_worker.ingestion import (
    IngestionError,
    StructuralKind,
    ingest_markdown_bytes,
    ingest_narration_json_bytes,
    ingest_script,
)
from qwen_tts_worker.models.quality import SpeechRole


REPOSITORY = Path(__file__).resolve().parents[2]
LIBRARY = REPOSITORY / "library"


def test_markdown_separates_spoken_text_from_directions_and_metadata() -> None:
    raw = (
        b"# Episode\r\n"
        b"**Tone**: warm\r\n"
        b"\r\n"
        b"## Scene 1: Morning\r\n"
        b"**[Image]:** A bright kitchen.\r\n"
        b"**Narrator:** The kettle began to sing.\r\n"
        b"Mira: Is breakfast ready?\r\n"
        b"Unlabeled production thought.\r\n"
    )

    result = ingest_markdown_bytes(raw, source_id="episode/script.md")

    assert result.raw_bytes == raw
    assert result.line_ending == "crlf"
    assert [block.display_text for block in result.spoken_blocks] == [
        "The kettle began to sing.",
        "Is breakfast ready?",
    ]
    assert result.spoken_blocks[0].role == SpeechRole.NARRATOR
    assert result.spoken_blocks[0].speaker == "unresolved"
    assert result.spoken_blocks[1].role == SpeechRole.DIALOGUE
    assert result.spoken_blocks[1].speaker == "mira"
    assert any(block.kind == StructuralKind.DIRECTION for block in result.blocks)
    assert any(block.kind == StructuralKind.METADATA for block in result.blocks)
    assert any(block.kind == StructuralKind.UNLABELED for block in result.blocks)
    assert [diagnostic.code for diagnostic in result.diagnostics] == [
        "markdown.unlabeled-prose"
    ]

    for block in result.spoken_blocks:
        span = block.source_spans[0]
        assert result.source.text[span.start : span.end] == block.display_text
        structural = next(item for item in result.blocks if item.block_id == block.block_id)
        assert structural.kind == StructuralKind.SPOKEN
        assert structural.source_document_sha256 == result.source.content_sha256


def test_markdown_code_and_unclosed_fence_are_excluded_with_diagnostic() -> None:
    raw = b"## Scene 1\n**Narrator:** Spoken.\n```sh\necho never-speak\n"
    result = ingest_markdown_bytes(raw, source_id="script.md")
    assert [block.spoken_text for block in result.spoken_blocks] == ["Spoken."]
    assert all("echo" not in block.spoken_text for block in result.spoken_blocks)
    assert "markdown.unclosed-fence" in {
        diagnostic.code for diagnostic in result.diagnostics
    }
    assert any(block.kind == StructuralKind.CODE for block in result.blocks)


def test_markdown_bom_is_explicit_and_source_text_has_character_offsets() -> None:
    raw = b"\xef\xbb\xbf**Narration**: Hello.\n"
    result = ingest_markdown_bytes(raw, source_id="script.md")
    assert result.source.text == "**Narration**: Hello.\n"
    assert result.raw_bytes == raw
    assert result.diagnostics[0].code == "encoding.utf8-bom"
    span = result.spoken_blocks[0].source_spans[0]
    assert result.source.text[span.start : span.end] == "Hello."


def test_invalid_utf8_reports_exact_byte_offset() -> None:
    with pytest.raises(IngestionError, match=r"invalid UTF-8 at byte 3.*ff"):
        ingest_markdown_bytes(b"abc\xffdef", source_id="bad-script.md")


def test_narration_json_preserves_decoded_text_and_encoded_source_span() -> None:
    raw = json.dumps(
        [
            {"id": "s1", "text": "She said, \"hello\"."},
            {"id": "s2", "role": "wolf", "text": "Café moonlight."},
        ],
        ensure_ascii=True,
        separators=(",", ":"),
    ).encode()

    result = ingest_narration_json_bytes(raw, source_id="narration-script.json")

    assert [block.display_text for block in result.spoken_blocks] == [
        'She said, "hello".',
        "Café moonlight.",
    ]
    assert all(block.speaker == "unresolved" for block in result.spoken_blocks)
    for block in result.spoken_blocks:
        span = block.source_spans[0]
        encoded_content = result.source.text[span.start : span.end]
        assert json.loads(f'"{encoded_content}"') == block.display_text
        assert block.source_document_sha256 == result.source.content_sha256


def test_narration_json_is_deterministic() -> None:
    raw = b'[{"id":"s1","text":"Exact text."}]'
    first = ingest_narration_json_bytes(raw, source_id="episode/narration-script.json")
    second = ingest_narration_json_bytes(raw, source_id="episode/narration-script.json")
    assert first == second
    assert first.spoken_blocks[0].block_id == second.spoken_blocks[0].block_id


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        (b'{"id":"s1","text":"No array"}', "top-level array"),
        (b'[{"id":"s1","text":"One"},{"id":"s1","text":"Two"}]', "duplicate scene id"),
        (b'[{"id":"s1","text":""}]', "requires non-empty text"),
        (b'[{"id":"s1","text":}]', "line 1, column"),
    ],
)
def test_invalid_json_shapes_are_actionable(raw: bytes, message: str) -> None:
    with pytest.raises(IngestionError, match=message):
        ingest_narration_json_bytes(raw, source_id="bad/narration-script.json")


def test_all_supported_legacy_scripts_ingest_with_spoken_blocks() -> None:
    paths = sorted(
        path
        for path in LIBRARY.rglob("*")
        if path.name in {"script.md", "narration-script.json"}
    )
    assert len(paths) >= 11
    first_pass = [ingest_script(path) for path in paths]
    second_pass = [ingest_script(path) for path in paths]
    assert sum(bool(result.spoken_blocks) for result in first_pass) >= 11
    assert all(
        result.spoken_blocks or any(item.code == "source.no-spoken-blocks" for item in result.diagnostics)
        for result in first_pass
    )
    assert [result.model_dump() for result in first_pass] == [
        result.model_dump() for result in second_pass
    ]
    assert not [
        diagnostic
        for result in first_pass
        if result.spoken_blocks
        for diagnostic in result.diagnostics
        if diagnostic.severity == "error"
    ]


def test_script_dispatch_rejects_unknown_formats(tmp_path: Path) -> None:
    path = tmp_path / "script.yaml"
    path.write_text("text: hello", encoding="utf-8")
    with pytest.raises(IngestionError, match="unsupported script format"):
        ingest_script(path)
