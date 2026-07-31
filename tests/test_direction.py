"""Stable CustomVoice identity and bounded delivery-direction tests."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from qwen_tts_worker.direction import (
    CustomVoiceDirectionProfile,
    DirectionError,
    compose_direction,
    direct_segment,
    discover_customvoice_capabilities,
    validate_continuity,
    validate_direction_profile,
)
from qwen_tts_worker.models.quality import DeliveryDelta, SourceSpan, SpeechRole
from qwen_tts_worker.segmentation import SegmentationInput, segment_speech


ROOT = Path(__file__).resolve().parent.parent
MODEL = ROOT / "models" / "qwen3-tts-1.7b-customvoice-8bit"
DIRECTION_FIXTURE = ROOT / "evaluation" / "fixtures" / "direction-continuity-v1.json"
QUALITY_FIXTURE = ROOT / "evaluation" / "fixtures" / "quality-v1.json"


def profile(**changes: object) -> CustomVoiceDirectionProfile:
    values: dict[str, object] = {
        "profile_id": "narrator-serena-v1",
        "profile_revision": "1",
        "character_id": "narrator-under-test",
        "continuity_group": "narrator-serena",
        "backend_speaker": "serena",
        "source_language": "en-US",
        "backend_language": "english",
        "base_direction_id": "warm-clear-v1",
        "base_instruction": "Speak clearly and naturally while maintaining consistent delivery",
    }
    values.update(changes)
    return CustomVoiceDirectionProfile(**values)


def semantic_segment(*, speaker: str = "narrator-under-test", language: str = "en-US"):
    text = "Morning light warmed the wooden floor."
    digest = hashlib.sha256(text.encode()).hexdigest()
    item = SegmentationInput(
        source_anchor_id="scene-morning",
        source_document_sha256=digest,
        source_block_ids=("morning-block",),
        source_spans=(SourceSpan(start=0, end=len(text)),),
        source_spans_exact=True,
        display_text=text,
        spoken_text=text,
        language=language,
        role=SpeechRole.NARRATOR,
        speaker_profile_id=speaker,
        pause_after_ms=300,
    )
    return segment_speech((item,)).segments[0]


def test_capabilities_are_discovered_from_installed_config() -> None:
    capabilities = discover_customvoice_capabilities(MODEL)
    assert capabilities.config_sha256 == hashlib.sha256((MODEL / "config.json").read_bytes()).hexdigest()
    assert capabilities.speakers == tuple(sorted(capabilities.speakers))
    assert {"serena", "vivian", "uncle_fu", "ryan"}.issubset(capabilities.speakers)
    assert {"auto", "english", "french", "japanese"}.issubset(capabilities.backend_languages)
    validate_direction_profile(profile(), capabilities)


def test_unknown_speaker_and_language_fail_before_synthesis() -> None:
    capabilities = discover_customvoice_capabilities(MODEL)
    with pytest.raises(DirectionError, match="unsupported CustomVoice speaker"):
        validate_direction_profile(profile(backend_speaker="invented"), capabilities)
    with pytest.raises(DirectionError, match="unsupported backend language"):
        validate_direction_profile(profile(backend_language="klingon"), capabilities)


def test_neutral_delta_is_exact_stable_base_instruction() -> None:
    selected = profile()
    first = compose_direction(selected)
    second = compose_direction(selected, DeliveryDelta())
    assert first == second
    assert first.composed_instruction == selected.base_instruction
    assert first.delta == DeliveryDelta()


def test_bounded_delta_composes_in_schema_order() -> None:
    direction = compose_direction(
        profile(),
        DeliveryDelta(
            pace="steady",
            articulation="crisp",
            emotion="warm",
            intent="narrate",
            distance="conversational",
        ),
    )
    assert direction.composed_instruction == (
        "Speak clearly and naturally while maintaining consistent delivery. "
        "Use a steady pace; Use crisp articulation; Add gentle warmth; "
        "Deliver as narration; Use conversational distance."
    )
    assert len(direction.composed_instruction) <= 768


def test_identity_redefinition_is_rejected() -> None:
    for instruction in (
        "Use a female voice",
        "Sound young and clear",
        "Use a low pitch",
        "Adopt a French accent",
        "Change vocal timbre",
    ):
        with pytest.raises(ValidationError, match="cannot redefine"):
            profile(base_instruction=instruction)


def test_delta_contradictions_fail_actionably() -> None:
    selected = profile(base_instruction="Speak slowly with clear diction")
    with pytest.raises(DirectionError, match="quicker pace conflicts"):
        compose_direction(selected, DeliveryDelta(pace="quicker"))


def test_direct_segment_builds_final_plan_without_changing_identity() -> None:
    capabilities = discover_customvoice_capabilities(MODEL)
    segment = semantic_segment()
    directed = direct_segment(
        segment,
        profile(),
        delta=DeliveryDelta(emotion="warm", intent="narrate"),
        capabilities=capabilities,
    )
    plan = directed.segment_plan
    assert plan.segment_id == segment.segment_id
    assert plan.spoken_text == segment.spoken_text
    assert plan.speaker_profile_id == "narrator-serena-v1"
    assert plan.preprocessing_version == segment.policy_fingerprint
    assert plan.pause_after_ms == 300
    assert plan.direction == directed.direction


def test_speaker_and_language_mismatch_never_remap_silently() -> None:
    with pytest.raises(DirectionError, match="does not match profile character"):
        direct_segment(semantic_segment(speaker="other"), profile())
    with pytest.raises(DirectionError, match="does not match profile language"):
        direct_segment(semantic_segment(language="fr-FR"), profile())


def test_continuity_group_rejects_profile_or_base_drift() -> None:
    first = direct_segment(semantic_segment(), profile())
    stable_second = direct_segment(
        semantic_segment(), profile(), delta=DeliveryDelta(emotion="warm")
    )
    validate_continuity((first, stable_second))

    drifted = direct_segment(
        semantic_segment(),
        profile(
            profile_id="narrator-serena-v2",
            profile_revision="2",
            base_direction_id="different-base",
        ),
    )
    with pytest.raises(DirectionError, match="changes stable"):
        validate_continuity((first, drifted))


def test_complete_taxonomy_has_a_phrase_and_is_length_bounded() -> None:
    fields = {
        "pace": ("slower", "steady", "quicker"),
        "articulation": ("soft", "natural", "crisp"),
        "energy": ("low", "medium", "high"),
        "emotion": ("neutral", "warm", "joyful", "curious", "somber", "tense", "urgent"),
        "intensity": ("restrained", "moderate", "strong"),
        "intent": ("narrate", "explain", "reassure", "wonder", "warn", "question", "exclaim"),
        "distance": ("intimate", "conversational", "projected"),
    }
    for field, values in fields.items():
        for value in values:
            direction = compose_direction(profile(), DeliveryDelta(**{field: value}))
            assert direction.composed_instruction != profile().base_instruction
            assert len(direction.composed_instruction) <= 768


def test_base_and_composed_instructions_are_length_bounded() -> None:
    with pytest.raises(ValidationError, match="at most 512"):
        profile(base_instruction="x" * 513)
    selected = profile(base_instruction="Maintain clarity " + "and consistency " * 29)
    direction = compose_direction(
        selected,
        DeliveryDelta(
            pace="steady", articulation="crisp", energy="medium", emotion="warm",
            intensity="moderate", intent="narrate", distance="conversational",
        ),
    )
    assert len(direction.composed_instruction) <= 768


def test_continuity_fixture_references_reviewed_segments_and_valid_profiles() -> None:
    fixture = json.loads(DIRECTION_FIXTURE.read_text(encoding="utf-8"))
    quality = json.loads(QUALITY_FIXTURE.read_text(encoding="utf-8"))
    known_segments = {
        segment["segment_id"]
        for case in quality["cases"]
        for segment in case["expected_segments"]
    }
    profiles = {
        item["profile_id"]: CustomVoiceDirectionProfile.model_validate(item)
        for item in fixture["profiles"]
    }
    assert len(fixture["adjacent_sequences"]) >= 2
    for sequence in fixture["adjacent_sequences"]:
        selected = profiles[sequence["profile_id"]]
        assert len(sequence["segments"]) >= 2
        for item in sequence["segments"]:
            assert item["source_segment_id"] in known_segments
            direction = compose_direction(selected, DeliveryDelta.model_validate(item["delta"]))
            assert direction.base_direction_id == selected.base_direction_id
