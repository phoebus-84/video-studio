"""Seeded property and end-to-end conservation checks for preprocessing."""

from __future__ import annotations

import hashlib
import random
import string

from qwen_tts_worker.dialogue import SpeakerDirectory, SpeakerEntry, analyze_dialogue
from qwen_tts_worker.models.quality import SourceDocument, SourceFormat, SourceSpan, SpeechRole, SpokenBlock
from qwen_tts_worker.normalization import normalize_block
from qwen_tts_worker.segmentation import RoleLimits, SegmentationInput, SegmentationPolicy, segment_speech


def block_and_document(text: str) -> tuple[SpokenBlock, SourceDocument]:
    digest = hashlib.sha256(text.encode()).hexdigest()
    document = SourceDocument(
        source_id="properties/source",
        revision="seeded",
        content_sha256=digest,
        format=SourceFormat.PLAIN_TEXT,
        language="en-US",
        text=text,
    )
    return (
        SpokenBlock(
            block_id="property-block",
            source_document_sha256=digest,
            source_spans=(SourceSpan(start=0, end=len(text)),),
            role=SpeechRole.NARRATOR,
            speaker="unresolved",
            display_text=text,
            spoken_text=text,
            language="en-US",
        ),
        document,
    )


def apply_changes(original: str, changes) -> str:
    cursor = 0
    pieces: list[str] = []
    for change in sorted(changes, key=lambda item: item.block_span.start):
        assert change.block_span.start >= cursor
        pieces.append(original[cursor : change.block_span.start])
        pieces.append(change.replacement)
        cursor = change.block_span.end
    pieces.append(original[cursor:])
    return "".join(pieces)


def compact_policy() -> SegmentationPolicy:
    limits = RoleLimits(
        min_words=3,
        target_words=7,
        max_words=12,
        target_duration_seconds=3,
        max_duration_seconds=6,
    )
    return SegmentationPolicy(
        policy_id="seeded-properties",
        narration=limits,
        dialogue=limits,
        max_backend_tokens=40,
        max_characters=160,
    )


def test_seeded_normalization_is_deterministic_nonoverlapping_and_reconstructable() -> None:
    rng = random.Random(48132)
    months = ("January", "March", "July", "October")
    for _ in range(150):
        value = rng.randint(0, 999_999)
        day = rng.randint(1, 28)
        hour = rng.randint(1, 12)
        minute = rng.randint(0, 59)
        dollars = rng.randint(1, 999)
        cents = rng.randint(0, 99)
        text = (
            f"Dr. {rng.choice(string.ascii_uppercase)} recorded {value:,} samples on "
            f"{rng.choice(months)} {day}, 2026 at {hour}:{minute:02d} p.m. "
            f"The calibrated 5 km sensor cost ${dollars}.{cents:02d}."
        )
        block, document = block_and_document(text)
        first = normalize_block(block, document)
        second = normalize_block(block, document)
        assert first == second
        assert apply_changes(text, first.changes) == first.spoken_text
        assert not first.diagnostics
        for left, right in zip(first.changes, first.changes[1:]):
            assert left.block_span.end <= right.block_span.start
        assert all(
            document.text[change.source_span.start : change.source_span.end] == change.original
            for change in first.changes
        )


def test_seeded_dialogue_partition_covers_every_character_once_and_preserves_order() -> None:
    rng = random.Random(3301)
    directory = SpeakerDirectory(
        speakers=tuple(
            SpeakerEntry(profile_id=name.lower(), aliases=(name,))
            for name in ("Mira", "Tom", "Asha")
        )
    )
    verbs = ("said", "asked", "whispered", "replied")
    for index in range(100):
        name = rng.choice(("Mira", "Tom", "Asha"))
        text = (
            f"The lamp flickered {index} times. “Keep step {index} safe,” "
            f"{name} {rng.choice(verbs)}. The others nodded."
        )
        block, document = block_and_document(text)
        first = analyze_dialogue(block, document, speakers=directory)
        second = analyze_dialogue(block, document, speakers=directory)
        assert first == second
        assert not first.diagnostics
        assert next(turn for turn in first.turns if turn.role == SpeechRole.DIALOGUE).speaker_profile_id == name.lower()
        spans = sorted(
            [(turn.block_span.start, turn.block_span.end, turn.display_text) for turn in first.turns]
            + [(token.block_span.start, token.block_span.end, token.text) for token in first.structural_tokens]
        )
        assert spans[0][0] == 0 and spans[-1][1] == len(text)
        assert all(left[1] == right[0] for left, right in zip(spans, spans[1:]))
        assert "".join(piece for _, _, piece in spans) == text


def test_seeded_segmentation_conserves_both_forms_and_stable_ids() -> None:
    rng = random.Random(3405)
    active_policy = compact_policy()
    for case in range(100):
        sentence_count = rng.randint(2, 8)
        sentences = [
            " ".join(f"token{case}x{part}x{word}" for word in range(rng.randint(3, 9))) + "."
            for part in range(sentence_count)
        ]
        text = " ".join(sentences)
        digest = hashlib.sha256(text.encode()).hexdigest()
        item = SegmentationInput(
            source_anchor_id=f"property-{case}",
            source_document_sha256=digest,
            source_block_ids=(f"block-{case}",),
            source_spans=(SourceSpan(start=0, end=len(text)),),
            source_spans_exact=True,
            display_text=text,
            spoken_text=text,
            language="en-US",
            role=SpeechRole.NARRATOR,
            speaker_profile_id="narrator",
        )
        first = segment_speech((item,), policy=active_policy)
        second = segment_speech((item,), policy=active_policy)
        assert first == second
        assert "".join(s.spoken_text + s.spoken_separator_after for s in first.segments) == text
        assert "".join(s.display_text + s.display_separator_after for s in first.segments) == text
        assert len({segment.segment_id for segment in first.segments}) == len(first.segments)
        assert all(segment.word_count <= 12 for segment in first.segments)


def test_malformed_failures_and_diagnostics_are_repeatably_identical() -> None:
    cases = (
        'Mira said, "Never closed.',
        "Meet on 03/04/2026 at 09:30.",
        "Email person@example.com about qtw-48r.",
    )
    for text in cases:
        block, document = block_and_document(text)
        assert analyze_dialogue(block, document) == analyze_dialogue(block, document)
        assert normalize_block(block, document) == normalize_block(block, document)
