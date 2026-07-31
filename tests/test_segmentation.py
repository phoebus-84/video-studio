"""Semantic segmentation golden, safety, stability, and distribution tests."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
from pydantic import ValidationError

from qwen_tts_worker.ingestion import ingest_script
from qwen_tts_worker.models.quality import SourceSpan, SpeechRole
from qwen_tts_worker.segmentation import (
    RoleLimits,
    SegmentationError,
    SegmentationInput,
    SegmentationPolicy,
    segment_speech,
)


LIBRARY = Path(__file__).resolve().parents[2] / "library"


def policy(
    *,
    min_words: int = 3,
    target_words: int = 5,
    max_words: int = 8,
    max_characters: int = 120,
) -> SegmentationPolicy:
    limits = RoleLimits(
        min_words=min_words,
        target_words=target_words,
        max_words=max_words,
        target_duration_seconds=max(target_words / 2.6, 0.5),
        max_duration_seconds=max(max_words / 2.0, 1.0),
    )
    return SegmentationPolicy(
        narration=limits,
        dialogue=limits,
        max_backend_tokens=max(max_words * 3, 16),
        max_characters=max_characters,
        context_characters=40,
    )


def make_input(
    spoken: str,
    *,
    display: str | None = None,
    anchor: str = "scene.alpha.turn.narrator",
    role: SpeechRole = SpeechRole.NARRATOR,
    speaker: str = "narrator",
    digest: str | None = None,
    protected: tuple[SourceSpan, ...] = (),
    pause_after_ms: int | None = None,
    source_start: int = 100,
    exact_source: bool = True,
) -> SegmentationInput:
    display_text = display if display is not None else spoken
    document_hash = digest or hashlib.sha256(spoken.encode()).hexdigest()
    source_length = len(display_text) if exact_source else len(display_text) + 20
    return SegmentationInput(
        source_anchor_id=anchor,
        source_document_sha256=document_hash,
        source_block_ids=("block-1",),
        source_spans=(SourceSpan(start=source_start, end=source_start + source_length),),
        source_spans_exact=exact_source,
        display_text=display_text,
        spoken_text=spoken,
        language="en-US",
        role=role,
        speaker_profile_id=speaker,
        protected_spoken_spans=protected,
        pause_after_ms=pause_after_ms,
    )


def reconstruct_spoken(result) -> str:
    return "".join(
        segment.spoken_text + segment.spoken_separator_after
        for segment in result.segments
    )


def reconstruct_display(result) -> str:
    return "".join(
        segment.display_text + segment.display_separator_after
        for segment in result.segments
    )


def test_prefers_complete_sentence_boundaries_and_conserves_content() -> None:
    text = "Lantern light filled the room. Mira opened the old map. Rain tapped softly outside."
    result = segment_speech((make_input(text),), policy=policy(max_words=7))
    assert [segment.spoken_text for segment in result.segments] == [
        "Lantern light filled the room.",
        "Mira opened the old map.",
        "Rain tapped softly outside.",
    ]
    assert [segment.boundary_reason for segment in result.segments] == [
        "sentence", "sentence", "turn-end"
    ]
    assert reconstruct_spoken(result) == text
    assert reconstruct_display(result) == text
    assert all(segment.word_count <= 7 for segment in result.segments)


def test_uses_clause_but_rejects_unsafe_word_fallback() -> None:
    clause_text = "We crossed the bridge, carried the lantern, followed the river, and reached home safely."
    clause_result = segment_speech(
        (make_input(clause_text),), policy=policy(max_words=6, target_words=5)
    )
    assert "clause" in [segment.boundary_reason for segment in clause_result.segments]
    assert reconstruct_spoken(clause_result) == clause_text

    fallback_text = "one two three four five six seven eight nine ten eleven twelve"
    with pytest.raises(SegmentationError, match="no syntactically safe boundary"):
        segment_speech(
            (make_input(fallback_text),), policy=policy(max_words=5, target_words=4)
        )


def test_normalized_replacement_is_atomic_and_display_is_conserved() -> None:
    display = "Mira paid $12.50 for the bright red lantern."
    spoken = "Mira paid twelve dollars and fifty cents for the bright red lantern."
    with pytest.raises(SegmentationError, match="no syntactically safe boundary"):
        segment_speech(
            (make_input(spoken, display=display),),
            policy=policy(min_words=2, target_words=3, max_words=4),
        )

    result = segment_speech(
        (make_input(spoken, display=display),),
        policy=policy(min_words=3, target_words=10, max_words=14),
    )
    assert reconstruct_spoken(result) == spoken
    assert reconstruct_display(result) == display
    assert "$12.50" in reconstruct_display(result)
    assert all("twelve dollars and" not in segment.spoken_text or "fifty cents" in segment.spoken_text for segment in result.segments)


def test_explicit_protected_and_parenthetical_spans_are_never_split() -> None:
    text = "alpha beta gamma delta epsilon zeta eta theta"
    protected = (SourceSpan(start=6, end=30),)
    with pytest.raises(SegmentationError, match="no syntactically safe boundary"):
        segment_speech(
            (make_input(text, protected=protected),),
            policy=policy(min_words=2, target_words=3, max_words=3),
        )

    parenthetical = "Start now (one two three four five six seven) and finish soon."
    with pytest.raises(SegmentationError, match="no syntactically safe boundary"):
        segment_speech(
            (make_input(parenthetical),),
            policy=policy(min_words=2, target_words=3, max_words=4),
        )


def test_nested_straight_quote_is_not_split_at_internal_sentence_end() -> None:
    text = 'He recalled "one two three. four five six." before dawn.'
    with pytest.raises(SegmentationError, match="no syntactically safe boundary"):
        segment_speech(
            (make_input(text),),
            policy=policy(min_words=2, target_words=4, max_words=5),
        )


def test_unrelated_edit_preserves_unaffected_content_id() -> None:
    original = "Cold rain tapped the window. Mira carried the lantern home. Stars appeared above."
    edited = "Warm rain tapped the window. Mira carried the lantern home. Stars appeared above."
    active = policy(min_words=3, target_words=5, max_words=6)
    first = segment_speech((make_input(original),), policy=active)
    second = segment_speech(
        (make_input(edited, digest="f" * 64),), policy=active
    )
    first_ids = {segment.spoken_text: segment.segment_id for segment in first.segments}
    second_ids = {segment.spoken_text: segment.segment_id for segment in second.segments}
    assert first_ids["Mira carried the lantern home."] == second_ids["Mira carried the lantern home."]
    assert first_ids["Stars appeared above."] == second_ids["Stars appeared above."]
    assert first.segments[0].segment_id != second.segments[0].segment_id


def test_source_spans_are_exact_only_when_input_slice_is_exact() -> None:
    text = "First sentence ends here. Second sentence follows now."
    exact = segment_speech(
        (make_input(text, source_start=200),), policy=policy(max_words=5)
    )
    assert exact.segments[0].source_spans_exact is True
    assert exact.segments[0].source_spans[0] == SourceSpan(start=200, end=225)

    encoded = segment_speech(
        (make_input(text, exact_source=False),), policy=policy(max_words=5)
    )
    assert all(not segment.source_spans_exact for segment in encoded.segments)
    assert all(segment.source_spans == encoded.segments[0].source_spans for segment in encoded.segments)


def test_speaker_transitions_explicit_pauses_and_adjacent_context() -> None:
    narrator = make_input("The door slowly opened.", anchor="narrator-1")
    mira = make_input(
        "Come inside at once!",
        anchor="mira-1",
        role=SpeechRole.DIALOGUE,
        speaker="mira",
        pause_after_ms=700,
    )
    result = segment_speech((narrator, mira), policy=policy(max_words=8))
    assert result.segments[0].pause.kind == "speaker-transition"
    assert result.segments[0].pause.duration_hint_ms == 350
    assert result.segments[1].pause.kind == "explicit"
    assert result.segments[1].pause.duration_hint_ms == 700
    assert result.segments[0].context.after == "Come inside at once!"
    assert result.segments[1].context.before == "The door slowly opened."


def test_complete_policy_is_fingerprinted_without_churning_content_ids() -> None:
    text = "A short complete sentence."
    first_policy = policy(max_words=8)
    second_policy = first_policy.model_copy(update={"sentence_pause_ms": 221})
    first = segment_speech((make_input(text),), policy=first_policy)
    second = segment_speech((make_input(text),), policy=second_policy)
    assert first.report.policy_fingerprint != second.report.policy_fingerprint
    assert first.segments[0].policy_fingerprint == first.report.policy_fingerprint
    assert second.segments[0].policy_fingerprint == second.report.policy_fingerprint
    assert first.segments[0].segment_id == second.segments[0].segment_id


def test_report_contains_distributions_and_boundary_reasons() -> None:
    text = "One two three four. Five six seven eight. Nine ten eleven twelve."
    result = segment_speech((make_input(text),), policy=policy(max_words=5))
    report = result.report
    assert report.input_turn_count == 1
    assert report.segment_count == len(result.segments)
    assert report.total_words == 12
    assert sum(report.boundary_reason_counts.values()) == report.segment_count
    assert report.min_words <= report.median_words <= report.max_words
    assert report.min_predicted_duration_seconds <= report.median_predicted_duration_seconds <= report.max_predicted_duration_seconds


def test_invalid_limits_and_outer_whitespace_fail_validation() -> None:
    with pytest.raises(ValidationError, match="min <= target <= max"):
        RoleLimits(
            min_words=10,
            target_words=5,
            max_words=8,
            target_duration_seconds=2,
            max_duration_seconds=4,
        )
    with pytest.raises(ValidationError, match="outer whitespace"):
        make_input(" leading text")


def test_default_policy_segments_every_repository_block_and_reports_limits() -> None:
    paths = sorted(
        path
        for path in LIBRARY.rglob("*")
        if path.name in {"script.md", "narration-script.json"}
    )
    assert paths
    for path in paths:
        ingested = ingest_script(path)
        for index, block in enumerate(ingested.spoken_blocks):
            item = SegmentationInput(
                source_anchor_id=f"{path.relative_to(LIBRARY)}:{hashlib.sha256(block.display_text.encode()).hexdigest()[:16]}",
                source_document_sha256=ingested.source.content_sha256,
                source_block_ids=(block.block_id,),
                source_spans=block.source_spans,
                source_spans_exact=(
                    len(block.source_spans) == 1
                    and ingested.source.text[
                        block.source_spans[0].start : block.source_spans[0].end
                    ] == block.display_text
                ),
                display_text=block.display_text,
                spoken_text=block.spoken_text,
                language=block.language,
                role=block.role,
                speaker_profile_id=block.speaker,
                pause_after_ms=block.pause_after_ms,
            )
            result = segment_speech((item,))
            assert reconstruct_spoken(result) == block.spoken_text
            assert reconstruct_display(result) == block.display_text
            assert all(segment.word_count <= 70 for segment in result.segments)
            assert all(segment.backend_token_count <= 180 for segment in result.segments)
            assert all(len(segment.spoken_text) <= 500 for segment in result.segments)
