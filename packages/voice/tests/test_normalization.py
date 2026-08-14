"""Golden and safety tests for source-mapped English normalization."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from qwen_tts_worker.ingestion import ingest_narration_json_bytes
from qwen_tts_worker.models.quality import (
    PronunciationEntry,
    SourceDocument,
    SourceFormat,
    SourceSpan,
    SpeechRole,
    SpokenBlock,
)
from qwen_tts_worker.normalization import (
    NormalizationError,
    PronunciationLexicon,
    cardinal,
    normalize_block,
    normalize_ingestion,
    ordinal,
)


FIXTURE = (
    Path(__file__).resolve().parent.parent
    / "evaluation"
    / "fixtures"
    / "quality-v1.json"
)


def make_block(text: str, *, language: str = "en-US") -> tuple[SpokenBlock, SourceDocument]:
    digest = hashlib.sha256(text.encode()).hexdigest()
    document = SourceDocument(
        source_id="test/source",
        revision="test-1",
        content_sha256=digest,
        format=SourceFormat.PLAIN_TEXT,
        language=language,
        text=text,
    )
    block = SpokenBlock(
        block_id="test.1",
        source_document_sha256=digest,
        source_spans=(SourceSpan(start=0, end=len(text)),),
        role=SpeechRole.NARRATOR,
        speaker="unresolved",
        display_text=text,
        spoken_text=text,
        language=language,
    )
    return block, document


def lexicon(*entries: tuple[str, str, str]) -> PronunciationLexicon:
    return PronunciationLexicon(
        entries=tuple(
            PronunciationEntry(
                entry_id=entry_id,
                display=display,
                spoken=spoken,
                language="en-US",
            )
            for entry_id, display, spoken in entries
        )
    )


def fixture_segment(case_id: str, number: int) -> dict:
    suite = json.loads(FIXTURE.read_text(encoding="utf-8"))
    case = next(item for item in suite["cases"] if item["case_id"] == case_id)
    return case["expected_segments"][number - 1]


@pytest.mark.parametrize(
    ("value", "spoken"),
    [
        (0, "zero"),
        (19, "nineteen"),
        (21, "twenty-one"),
        (105, "one hundred five"),
        (1_234, "one thousand two hundred thirty-four"),
        (-48, "minus forty-eight"),
        (2_000_001, "two million one"),
    ],
)
def test_cardinal_golden(value: int, spoken: str) -> None:
    assert cardinal(value) == spoken


@pytest.mark.parametrize(
    ("value", "spoken"),
    [(1, "first"), (3, "third"), (21, "twenty-first"), (31, "thirty-first"), (105, "one hundred fifth")],
)
def test_ordinal_golden(value: int, spoken: str) -> None:
    assert ordinal(value) == spoken


def test_numeric_fixture_matches_reviewed_spoken_targets() -> None:
    for number in (1, 2):
        segment = fixture_segment("numeric-normalization", number)
        block, document = make_block(segment["display_text"])
        result = normalize_block(block, document)
        assert result.spoken_text == segment["spoken_text"]
        assert not result.diagnostics
        assert result.display_text == segment["display_text"]
        assert result.changes
        for change in result.changes:
            assert change.source_span_exact is True
            assert document.text[change.source_span.start : change.source_span.end] == change.original


def test_names_and_foreign_words_use_explicit_lexicon() -> None:
    segment = fixture_segment("names-and-foreign-words", 1)
    block, document = make_block(segment["display_text"])
    names = lexicon(
        ("anais", "Anaïs", "Ah-nah-EES"),
        ("siobhan", "Siobhán", "Shi-VAWN"),
        ("lodz", "Łódź", "Woodge"),
        ("merci", "merci", "mare-SEE"),
    )
    result = normalize_block(block, document, lexicon=names)
    assert result.spoken_text == segment["spoken_text"]
    assert [change.rule_id for change in result.changes] == [
        "lexicon.anais", "lexicon.siobhan", "lexicon.lodz", "lexicon.merci"
    ]


def test_technical_fixture_uses_lexicon_and_generic_rules() -> None:
    terms = lexicon(
        ("jaromail", "JaroMail", "Jaro Mail"),
        ("imap", "IMAP", "eye-map"),
        ("qtw", "qtw-48r", "Q T W forty-eight R"),
        ("bd", "bd", "B D"),
    )
    for number in (1, 2):
        segment = fixture_segment("technical-explainer", number)
        block, document = make_block(segment["display_text"])
        result = normalize_block(block, document, lexicon=terms)
        assert result.spoken_text == segment["spoken_text"]
        assert not result.diagnostics


def test_all_evaluation_segments_match_reviewed_deterministic_targets() -> None:
    suite = json.loads(FIXTURE.read_text(encoding="utf-8"))
    reviewed = lexicon(
        ("anais", "Anaïs", "Ah-nah-EES"),
        ("siobhan", "Siobhán", "Shi-VAWN"),
        ("lodz", "Łódź", "Woodge"),
        ("merci", "merci", "mare-SEE"),
        ("jaromail", "JaroMail", "Jaro Mail"),
        ("imap", "IMAP", "eye-map"),
        ("qtw", "qtw-48r", "Q T W forty-eight R"),
        ("bd", "bd", "B D"),
    )
    for case in suite["cases"]:
        for segment in case["expected_segments"]:
            block, document = make_block(segment["display_text"])
            result = normalize_block(block, document, lexicon=reviewed)
            assert result.spoken_text == segment["spoken_text"], segment["segment_id"]
            assert not result.diagnostics, segment["segment_id"]


def test_version_initialism_abbreviation_symbols_and_whitespace() -> None:
    text = "  Dr. Xu tested v0.4.6 with CPU & GPU + DSP.\n"
    block, document = make_block(text)
    result = normalize_block(block, document)
    assert result.spoken_text == (
        "Doctor Xu tested version zero point four point six with "
        "C P U and G P U plus D S P."
    )
    rules = {change.rule_id for change in result.changes}
    assert {
        "whitespace.trim",
        "abbreviation.dr",
        "technical.version",
        "abbreviation.initialism",
        "symbol.ampersand",
        "symbol.plus",
    }.issubset(rules)


@pytest.mark.parametrize(
    ("text", "code"),
    [
        ("Meet on 03/04/2026.", "date.ambiguous-numeric"),
        ("The price is €12.50.", "currency.unsupported"),
        ("The price is $12.5.", "currency.invalid-precision"),
        ("The total is 12,34 items.", "number.invalid-grouping"),
        ("Return on February 31, 2026.", "date.invalid-calendar-date"),
        ("Start at 09:30.", "time.ambiguous"),
        ("Visit St. John.", "abbreviation.ambiguous-st"),
        ("Build qtw-48r now.", "technical.identifier"),
        ("Code 007 is reserved.", "number.leading-zero"),
        ("Use 1/2 cup.", "number.ambiguous-fraction"),
        ("Choose 3-5 items.", "number.ambiguous-range"),
        ("Visit https://example.com/v1.2 today.", "protected.url"),
        ("Email a12@example.com.", "protected.email"),
    ],
)
def test_ambiguous_or_protected_forms_are_preserved(text: str, code: str) -> None:
    block, document = make_block(text)
    result = normalize_block(block, document)
    diagnostic = next(item for item in result.diagnostics if item.code == code)
    assert diagnostic.token in result.spoken_text
    assert document.text[
        diagnostic.source_span.start : diagnostic.source_span.end
    ] == diagnostic.token


def test_lexicon_resolves_ambiguous_identifier_and_removes_diagnostic() -> None:
    text = "Inspect qtw-48r."
    block, document = make_block(text)
    result = normalize_block(
        block,
        document,
        lexicon=lexicon(("qtw", "qtw-48r", "Q T W forty-eight R")),
    )
    assert result.spoken_text == "Inspect Q T W forty-eight R."
    assert not result.diagnostics


def test_unicode_nfkc_and_space_changes_are_audited() -> None:
    text = "The ﬁrst   test used １２ V."
    block, document = make_block(text)
    result = normalize_block(block, document)
    assert result.spoken_text == "The first test used twelve volts."
    assert {change.rule_id for change in result.changes} >= {
        "unicode.nfkc", "whitespace.horizontal", "unit.si-context"
    }


def test_escaped_json_retains_exact_local_and_conservative_source_spans() -> None:
    ingested = ingest_narration_json_bytes(
        b'[{"id":"s1","text":"Caf\\u00e9 costs $2.00."}]',
        source_id="episode/narration-script.json",
    )
    normalized = normalize_ingestion(ingested)[0]
    assert normalized.spoken_text == "Café costs two dollars."
    currency = next(change for change in normalized.changes if change.rule_id == "currency.usd")
    assert currency.block_span == SourceSpan(start=11, end=16)
    assert currency.source_span == ingested.spoken_blocks[0].source_spans[0]
    assert currency.source_span_exact is False


def test_conflicting_lexicon_entries_are_rejected() -> None:
    with pytest.raises(ValidationError, match="conflicting pronunciation"):
        lexicon(("one", "IMAP", "eye-map"), ("two", "imap", "I M A P"))


def test_wrong_locale_and_source_identity_fail_actionably() -> None:
    block, document = make_block("Hello 12.")
    with pytest.raises(NormalizationError, match="only en-US"):
        normalize_block(block, document, locale="en-GB")
    wrong = block.model_copy(update={"source_document_sha256": "a" * 64})
    with pytest.raises(NormalizationError, match="source identity"):
        normalize_block(wrong, document)


def test_display_text_is_immutable_and_repeated_runs_are_identical() -> None:
    text = "Dr. Rivera paid $12.50 at 9:05 a.m."
    block, document = make_block(text)
    first = normalize_block(block, document)
    second = normalize_block(block, document)
    assert first == second
    assert first.display_text == text
    assert block.spoken_text == text
