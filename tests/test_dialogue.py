"""Golden, ambiguity, nesting, and conservation tests for speech turns."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
from pydantic import ValidationError

from qwen_tts_worker.dialogue import (
    DialogueError,
    SpeakerDirectory,
    SpeakerEntry,
    analyze_dialogue,
)
from qwen_tts_worker.ingestion import ingest_script
from qwen_tts_worker.models.quality import (
    SourceDocument,
    SourceFormat,
    SourceSpan,
    SpeechRole,
    SpokenBlock,
)


LIBRARY = Path(__file__).resolve().parents[2] / "library"


def make_block(
    text: str,
    *,
    role: SpeechRole = SpeechRole.NARRATOR,
    speaker: str = "unresolved",
) -> tuple[SpokenBlock, SourceDocument]:
    digest = hashlib.sha256(text.encode()).hexdigest()
    document = SourceDocument(
        source_id="test/dialogue",
        revision="test-1",
        content_sha256=digest,
        format=SourceFormat.PLAIN_TEXT,
        language="en-US",
        text=text,
    )
    block = SpokenBlock(
        block_id="scene-1",
        source_document_sha256=digest,
        source_spans=(SourceSpan(start=0, end=len(text)),),
        role=role,
        speaker=speaker,
        display_text=text,
        spoken_text=text,
        language="en-US",
    )
    return block, document


def directory() -> SpeakerDirectory:
    return SpeakerDirectory(
        speakers=(
            SpeakerEntry(profile_id="mira", aliases=("Mira",)),
            SpeakerEntry(profile_id="tom", aliases=("Tom",)),
            SpeakerEntry(profile_id="mother-goat", aliases=("Mother Goat", "Mama")),
        )
    )


def assert_exact_conservation(text: str, analysis) -> None:
    covered: list[tuple[int, int, str]] = []
    for turn in analysis.turns:
        covered.append((turn.block_span.start, turn.block_span.end, turn.display_text))
    for token in analysis.structural_tokens:
        covered.append((token.block_span.start, token.block_span.end, token.text))
    covered.sort(key=lambda item: item[0])
    assert covered[0][0] == 0
    assert covered[-1][1] == len(text)
    assert all(left[1] == right[0] for left, right in zip(covered, covered[1:]))
    assert "".join(value for _, _, value in covered) == text


def test_plain_narration_remains_one_narrator_turn() -> None:
    text = "Morning light warmed the wooden floor."
    block, document = make_block(text)
    result = analyze_dialogue(block, document)
    assert len(result.turns) == 1
    assert result.turns[0].role == SpeechRole.NARRATOR
    assert result.turns[0].speaker_profile_id == "narrator"
    assert result.turns[0].display_text == text
    assert not result.diagnostics
    assert_exact_conservation(text, result)


def test_explicit_character_labeled_block_remains_character_dialogue() -> None:
    text = "Is breakfast ready?"
    block, document = make_block(
        text, role=SpeechRole.DIALOGUE, speaker="mira"
    )
    result = analyze_dialogue(block, document)
    assert [(turn.role, turn.speaker_profile_id, turn.display_text) for turn in result.turns] == [
        (SpeechRole.DIALOGUE, "mira", text)
    ]
    assert not result.diagnostics


def test_unlabeled_dialogue_block_requires_review_instead_of_using_narrator() -> None:
    text = "Is breakfast ready?"
    block, document = make_block(text, role=SpeechRole.DIALOGUE)
    result = analyze_dialogue(block, document)
    assert result.turns[0].speaker_profile_id == "review-required"
    assert result.diagnostics[0].code == "dialogue.speaker-unresolved"


def test_mixed_dialogue_keeps_attribution_in_narrator_voice() -> None:
    text = "“Is anyone there?” Mira asked. “I brought the lantern!”"
    block, document = make_block(text)
    result = analyze_dialogue(block, document, speakers=directory())
    assert [(turn.role, turn.speaker_profile_id, turn.display_text) for turn in result.turns] == [
        (SpeechRole.DIALOGUE, "mira", "Is anyone there?"),
        (SpeechRole.NARRATOR, "narrator", "Mira asked."),
        (SpeechRole.DIALOGUE, "mira", "I brought the lantern!"),
    ]
    assert not result.diagnostics
    assert len([token for token in result.structural_tokens if token.kind == "quote-mark"]) == 4
    assert_exact_conservation(text, result)


def test_attribution_before_quote_resolves_character() -> None:
    text = "Mira whispered, “Keep the lantern close.” Then the room grew quiet."
    block, document = make_block(text)
    result = analyze_dialogue(block, document, speakers=directory())
    assert [(turn.role, turn.speaker_profile_id) for turn in result.turns] == [
        (SpeechRole.NARRATOR, "narrator"),
        (SpeechRole.DIALOGUE, "mira"),
        (SpeechRole.NARRATOR, "narrator"),
    ]
    assert result.turns[0].display_text == "Mira whispered,"
    assert result.turns[2].display_text == "Then the room grew quiet."
    assert not result.diagnostics
    assert_exact_conservation(text, result)


def test_nested_quotation_tracks_depth_and_each_explicit_speaker() -> None:
    text = "Mira said, “I heard Tom shout, ‘Run!’ before the bell.”"
    block, document = make_block(text)
    result = analyze_dialogue(block, document, speakers=directory())
    assert [(turn.speaker_profile_id, turn.display_text, turn.quote_depth) for turn in result.turns] == [
        ("narrator", "Mira said,", 0),
        ("mira", "I heard Tom shout,", 1),
        ("tom", "Run!", 2),
        ("mira", "before the bell.", 1),
    ]
    assert not result.diagnostics
    assert_exact_conservation(text, result)


def test_unattributed_quote_is_review_required_not_guessed() -> None:
    text = "The door opened. “Come inside.”"
    block, document = make_block(text)
    result = analyze_dialogue(block, document, speakers=directory())
    dialogue = next(turn for turn in result.turns if turn.role == SpeechRole.DIALOGUE)
    assert dialogue.speaker_profile_id == "review-required"
    assert [diagnostic.code for diagnostic in result.diagnostics] == [
        "dialogue.speaker-unresolved"
    ]
    assert_exact_conservation(text, result)


def test_multiple_explicit_attributions_are_ambiguous() -> None:
    text = "“Go now,” Mira said while Tom shouted."
    block, document = make_block(text)
    result = analyze_dialogue(block, document, speakers=directory())
    assert result.turns[0].speaker_profile_id == "review-required"
    assert result.diagnostics[0].code == "dialogue.speaker-ambiguous"
    assert "mira" in result.diagnostics[0].message
    assert "tom" in result.diagnostics[0].message


def test_unclosed_quote_is_not_partially_interpreted() -> None:
    text = 'Mira said, "Do not split this.'
    block, document = make_block(text)
    result = analyze_dialogue(block, document, speakers=directory())
    assert len(result.turns) == 1
    assert result.turns[0].role == SpeechRole.NARRATOR
    assert result.turns[0].display_text == text
    assert result.diagnostics[0].code == "dialogue.unclosed-quote"
    assert not result.structural_tokens
    assert_exact_conservation(text, result)


def test_typographic_apostrophes_are_not_mistaken_for_quotes() -> None:
    text = "Cinderella’s kindness warmed James’ heart."
    block, document = make_block(text)
    result = analyze_dialogue(block, document)
    assert result.turns[0].display_text == text
    assert not result.diagnostics


def test_straight_double_quotes_are_supported() -> None:
    text = 'Mira said, "Ready?"'
    block, document = make_block(text)
    result = analyze_dialogue(block, document, speakers=directory())
    assert result.turns[-1].display_text == "Ready?"
    assert result.turns[-1].speaker_profile_id == "mira"
    assert not result.diagnostics


def test_duplicate_aliases_for_different_profiles_are_rejected() -> None:
    with pytest.raises(ValidationError, match="maps to both"):
        SpeakerDirectory(
            speakers=(
                SpeakerEntry(profile_id="one", aliases=("Mira",)),
                SpeakerEntry(profile_id="two", aliases=("mira",)),
            )
        )


def test_source_identity_mismatch_fails_actionably() -> None:
    block, document = make_block("Hello.")
    wrong = block.model_copy(update={"source_document_sha256": "a" * 64})
    with pytest.raises(DialogueError, match="source identity"):
        analyze_dialogue(wrong, document)


def test_escaped_json_uses_conservative_encoded_source_span(tmp_path: Path) -> None:
    path = tmp_path / "narration-script.json"
    path.write_bytes(
        b'[{"id":"s1","text":"Mira said, \\u201cCaf\\u00e9?\\u201d"}]'
    )
    ingested = ingest_script(path)
    result = analyze_dialogue(
        ingested.spoken_blocks[0], ingested.source, speakers=directory()
    )
    assert result.turns[-1].display_text == "Café?"
    assert result.turns[-1].source_span_exact is False
    assert result.turns[-1].source_span == ingested.spoken_blocks[0].source_spans[0]


def test_all_repository_blocks_are_deterministic_and_conserved() -> None:
    paths = sorted(
        path
        for path in LIBRARY.rglob("*")
        if path.name in {"script.md", "narration-script.json"}
    )
    for path in paths:
        ingested = ingest_script(path)
        for block in ingested.spoken_blocks:
            first = analyze_dialogue(block, ingested.source, speakers=directory())
            second = analyze_dialogue(block, ingested.source, speakers=directory())
            assert first == second
            assert_exact_conservation(block.display_text, first)
            assert all(turn.source_document_sha256 == ingested.source.content_sha256 for turn in first.turns)
